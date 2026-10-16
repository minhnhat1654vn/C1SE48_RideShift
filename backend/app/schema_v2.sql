-- =====================================================================
-- RideShift – Smart Transport Transition Advisor
-- Database v2 (cập nhật sau buổi họp) – PostgreSQL 14+ / PostGIS 3+
--
-- Quyết định đã chốt:
--   1. Chỉ có 2 vai trò: Guest (không đăng nhập, không có bảng) và Admin.
--      -> core.users đổi thành core.admins, bỏ core.vehicles.
--      -> Không lưu user_id / session / IP trên dữ liệu chuyến đi của Guest.
--   2. Giữ cấu trúc ~21 bảng của thầy (6 schema + schema survey).
--   3. Proposal vẫn có thể thay đổi -> các giá trị cấu hình nằm trong bảng,
--      không hard-code.
--   4. (06/10 bổ sung) trip.trips ghi nhận lựa chọn của Guest sau khi xem
--      khuyến nghị (chosen_vehicle_type_id + switched) -> chỉ số "ý định
--      chuyển đổi" cho dashboard (nếu thiếu, mất toàn bộ KPI chuyển đổi).
--
-- Đã verify: chạy sạch (exit 0, ON_ERROR_STOP) trên postgis/postgis:16-3.4,
-- đủ 21 bảng / 7 schema, CHECK constraints hoạt động. Xem docs/DB_V2_ANALYSIS.md.
--
-- Chạy: psql -U postgres -d rideshift -f 01_rideshift_schema_v2.sql
-- Chưa chạy thử trên PostgreSQL thật: hãy chạy trong Docker postgis/postgis
-- và báo lỗi (nếu có) để chỉnh.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS gis;
CREATE SCHEMA IF NOT EXISTS transportation;
CREATE SCHEMA IF NOT EXISTS policy;
CREATE SCHEMA IF NOT EXISTS trip;
CREATE SCHEMA IF NOT EXISTS decision;
CREATE SCHEMA IF NOT EXISTS survey;

-- Trigger dùng chung để tự cập nhật updated_at
CREATE OR REPLACE FUNCTION core.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

-- =====================================================================
-- SCHEMA core  (3 bảng)
-- =====================================================================

CREATE TABLE core.study_areas (
    study_area_id  BIGSERIAL PRIMARY KEY,
    code           VARCHAR(30)  NOT NULL UNIQUE,            -- ví dụ HN
    name           VARCHAR(150) NOT NULL,
    area_type      VARCHAR(30)  NOT NULL
                   CHECK (area_type IN ('CITY','PROVINCE')),
    country_code   VARCHAR(10)  NOT NULL DEFAULT 'VN',
    description    TEXT,
    geometry       geometry(MultiPolygon, 4326),
    status         VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_study_areas_geom ON core.study_areas USING GIST (geometry);
CREATE TRIGGER trg_study_areas_updated BEFORE UPDATE ON core.study_areas
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- Chỉ lưu tài khoản quản trị. Guest không đăng nhập nên KHÔNG có bảng/ dữ liệu cá nhân.
CREATE TABLE core.admins (
    admin_id       BIGSERIAL PRIMARY KEY,
    full_name      VARCHAR(150) NOT NULL,
    email          VARCHAR(200) NOT NULL,
    password_hash  TEXT         NOT NULL,                   -- bcrypt/argon2, không lưu mật khẩu thô
    role           VARCHAR(30)  NOT NULL DEFAULT 'ADMIN'
                   CHECK (role IN ('ADMIN')),
    status         VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE','LOCKED','DISABLED')),
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_admins_email ON core.admins (lower(email));
CREATE TRIGGER trg_admins_updated BEFORE UPDATE ON core.admins
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- Nhật ký hệ thống: thao tác của Admin + lỗi hệ thống (OSRM, Air Quality API...).
-- admin_id = NULL nghĩa là hệ thống tự ghi. KHÔNG ghi hành vi/ vị trí của Guest.
CREATE TABLE core.system_logs (
    log_id       BIGSERIAL PRIMARY KEY,
    admin_id     BIGINT REFERENCES core.admins(admin_id) ON DELETE SET NULL,
    level        VARCHAR(10)  NOT NULL DEFAULT 'INFO'
                 CHECK (level IN ('INFO','WARNING','ERROR')),
    action       VARCHAR(100) NOT NULL,
    entity_type  VARCHAR(100),
    entity_id    BIGINT,
    description  TEXT,
    ip_address   INET,                                      -- chỉ điền cho thao tác của Admin
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_system_logs_created ON core.system_logs (created_at DESC);
CREATE INDEX idx_system_logs_admin   ON core.system_logs (admin_id);

-- =====================================================================
-- SCHEMA transportation  (bảng modes tạo trước vì policy.vehicle_types tham chiếu)
-- =====================================================================

-- Phương thức đi lại: GASOLINE_MOTORBIKE, ELECTRIC_MOTORBIKE, BUS, TAXI...
-- Các cột tham số bên dưới là đầu vào cho Recommendation Engine (MCDM),
-- đặt ở đây để đổi được mà không sửa code (NFR-15, NFR-16).
CREATE TABLE transportation.transportation_modes (
    transportation_mode_id BIGSERIAL PRIMARY KEY,
    code                   VARCHAR(50)  NOT NULL UNIQUE,
    name                   VARCHAR(100) NOT NULL,
    category               VARCHAR(30),                     -- PRIVATE / PUBLIC / TAXI ...
    description            TEXT,
    routing_profile        VARCHAR(20)  NOT NULL DEFAULT 'car'
                           CHECK (routing_profile IN ('car','bike','foot')),
    speed_factor           NUMERIC(4,2) NOT NULL DEFAULT 1.00
                           CHECK (speed_factor > 0),        -- thời gian = OSRM_duration * speed_factor + avg_wait_min
    avg_wait_min           NUMERIC(5,1) NOT NULL DEFAULT 0
                           CHECK (avg_wait_min >= 0),
    base_fare              NUMERIC(12,0) NOT NULL DEFAULT 0, -- VND
    cost_per_km            NUMERIC(12,0) NOT NULL DEFAULT 0, -- VND/km
    accessibility_score    SMALLINT CHECK (accessibility_score BETWEEN 1 AND 5),
    convenience_score      SMALLINT CHECK (convenience_score  BETWEEN 1 AND 5),
    is_active              BOOLEAN NOT NULL DEFAULT TRUE
);

-- =====================================================================
-- SCHEMA policy  (4 bảng)
-- =====================================================================

CREATE TABLE policy.lez_zones (
    lez_zone_id    BIGSERIAL PRIMARY KEY,
    study_area_id  BIGINT NOT NULL REFERENCES core.study_areas(study_area_id),
    name           VARCHAR(200) NOT NULL,
    description    TEXT,
    geometry       geometry(MultiPolygon, 4326) NOT NULL,
    effective_from DATE,
    effective_to   DATE,
    status         VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','EXPIRED')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_lez_zones_dates  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
    CONSTRAINT ck_lez_zones_valid  CHECK (ST_IsValid(geometry))
);
CREATE INDEX idx_lez_zones_geom  ON policy.lez_zones USING GIST (geometry);
CREATE INDEX idx_lez_zones_area  ON policy.lez_zones (study_area_id, status);
CREATE TRIGGER trg_lez_zones_updated BEFORE UPDATE ON policy.lez_zones
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TABLE policy.lez_rules (
    lez_rule_id    BIGSERIAL PRIMARY KEY,
    lez_zone_id    BIGINT NOT NULL REFERENCES policy.lez_zones(lez_zone_id) ON DELETE CASCADE,
    rule_name      VARCHAR(200) NOT NULL,
    description    TEXT,
    start_time     TIME NOT NULL DEFAULT '00:00',
    end_time       TIME NOT NULL DEFAULT '23:59:59',        -- end_time < start_time = khung giờ qua nửa đêm
    days_of_week   SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7]::SMALLINT[],  -- ISO: 1=Thứ Hai ... 7=Chủ Nhật
    effective_from DATE,
    effective_to   DATE,
    status         VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','EXPIRED')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_lez_rules_days  CHECK (cardinality(days_of_week) > 0
                                         AND days_of_week <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]),
    CONSTRAINT ck_lez_rules_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
CREATE INDEX idx_lez_rules_zone ON policy.lez_rules (lez_zone_id, status);
CREATE TRIGGER trg_lez_rules_updated BEFORE UPDATE ON policy.lez_rules
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- Danh mục loại phương tiện mà Guest chọn trên giao diện (thay cho core.vehicles).
-- Mỗi dòng là một lựa chọn cụ thể, ví dụ: "Xe máy xăng Euro 3", "Xe máy điện".
-- emission_level: số càng cao càng sạch -> so sánh được bằng >= / <
--   0 = chưa đạt/ không rõ tiêu chuẩn, 1..5 = Euro 1..5, 9 = không phát thải (EV)
CREATE TABLE policy.vehicle_types (
    vehicle_type_id        BIGSERIAL PRIMARY KEY,
    code                   VARCHAR(50)  NOT NULL UNIQUE,
    name                   VARCHAR(100) NOT NULL,
    category               VARCHAR(50)  NOT NULL,           -- MOTORCYCLE, CAR, BUS, TAXI...
    fuel_type              VARCHAR(50)  NOT NULL,           -- PETROL, DIESEL, ELECTRIC, HYBRID...
    emission_standard      VARCHAR(50),                     -- nhãn hiển thị: EURO_3, ZERO_EMISSION
    emission_level         SMALLINT     NOT NULL DEFAULT 0
                           CHECK (emission_level BETWEEN 0 AND 9),
    transportation_mode_id BIGINT NOT NULL
                           REFERENCES transportation.transportation_modes(transportation_mode_id),
    is_default             BOOLEAN NOT NULL DEFAULT FALSE,  -- loại đại diện của mode khi đánh giá phương án thay thế
    description            TEXT,
    status                 VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                           CHECK (status IN ('ACTIVE','INACTIVE'))
);
CREATE UNIQUE INDEX uq_vehicle_types_default_per_mode
    ON policy.vehicle_types (transportation_mode_id) WHERE is_default;

-- Quy tắc hạn chế theo (rule, loại phương tiện).
-- Cách đánh giá (thực hiện ở backend/ SQL):
--   Không có rule đang hiệu lực hoặc không có dòng restriction cho loại xe -> COMPLIANT
--   ALLOWED                                                              -> COMPLIANT
--   PROHIBITED                                                           -> NOT_COMPLIANT
--   CONDITIONAL + min_emission_level có giá trị: level xe >= min ? COMPLIANT : NOT_COMPLIANT
--   CONDITIONAL + min_emission_level NULL (điều kiện khác, hiển thị restriction_reason) -> CONDITIONAL
CREATE TABLE policy.vehicle_restrictions (
    vehicle_restriction_id BIGSERIAL PRIMARY KEY,
    lez_rule_id            BIGINT NOT NULL REFERENCES policy.lez_rules(lez_rule_id) ON DELETE CASCADE,
    vehicle_type_id        BIGINT NOT NULL REFERENCES policy.vehicle_types(vehicle_type_id),
    restriction_type       VARCHAR(20) NOT NULL
                           CHECK (restriction_type IN ('ALLOWED','CONDITIONAL','PROHIBITED')),
    min_emission_level     SMALLINT CHECK (min_emission_level BETWEEN 0 AND 9),
    restriction_reason     TEXT,
    UNIQUE (lez_rule_id, vehicle_type_id)
);
CREATE INDEX idx_vehicle_restrictions_type ON policy.vehicle_restrictions (vehicle_type_id);

-- =====================================================================
-- SCHEMA gis  (3 bảng) – dữ liệu import từ nguồn GIS ngoài, không tự vẽ
-- =====================================================================

CREATE TABLE gis.administrative_regions (
    region_id        BIGSERIAL PRIMARY KEY,
    study_area_id    BIGINT NOT NULL REFERENCES core.study_areas(study_area_id),
    parent_region_id BIGINT REFERENCES gis.administrative_regions(region_id),  -- NULL nếu không có cấp cha
    code             VARCHAR(50)  NOT NULL,                 -- GeoJSON: ma_xa
    name             VARCHAR(150) NOT NULL,                 -- GeoJSON: ten_xa
    region_type      VARCHAR(50),                           -- GeoJSON: loai (Xã/Phường)
    geometry         geometry(MultiPolygon, 4326) NOT NULL,
    source           VARCHAR(100),
    status           VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE','INACTIVE')),
    UNIQUE (study_area_id, code),
    CONSTRAINT ck_admin_regions_valid CHECK (ST_IsValid(geometry))
);
CREATE INDEX idx_admin_regions_geom   ON gis.administrative_regions USING GIST (geometry);
CREATE INDEX idx_admin_regions_parent ON gis.administrative_regions (parent_region_id);

-- Lưu ý import OSM: nếu nguồn là MULTILINESTRING thì ST_Dump trước khi nạp.
-- Nên lọc highway_type khi import (bỏ footway/service...) để bảng không quá lớn.
CREATE TABLE gis.road_segments (
    road_segment_id BIGSERIAL PRIMARY KEY,
    study_area_id   BIGINT NOT NULL REFERENCES core.study_areas(study_area_id),
    osm_id          BIGINT,                                 -- không UNIQUE: một way OSM có thể bị cắt thành nhiều đoạn
    name            VARCHAR(200),
    highway_type    VARCHAR(50),
    oneway          BOOLEAN,
    max_speed       SMALLINT,
    length_m        NUMERIC(12,2),
    geometry        geometry(LineString, 4326) NOT NULL,
    source          VARCHAR(100),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_road_segments_geom ON gis.road_segments USING GIST (geometry);
CREATE INDEX idx_road_segments_area ON gis.road_segments (study_area_id, highway_type);
CREATE INDEX idx_road_segments_osm  ON gis.road_segments (osm_id);

-- POI: mức ưu tiên thấp (không nằm trong chức năng cốt lõi của proposal).
CREATE TABLE gis.points_of_interest (
    poi_id        BIGSERIAL PRIMARY KEY,
    study_area_id BIGINT NOT NULL REFERENCES core.study_areas(study_area_id),
    name          VARCHAR(200),
    category      VARCHAR(100),
    address       TEXT,
    source        VARCHAR(100),
    geometry      geometry(Point, 4326) NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','INACTIVE'))
);
CREATE INDEX idx_poi_geom     ON gis.points_of_interest USING GIST (geometry);
CREATE INDEX idx_poi_category ON gis.points_of_interest (study_area_id, category);

-- =====================================================================
-- SCHEMA transportation – bảng locations (cần study_areas + modes)
-- =====================================================================

CREATE TABLE transportation.transportation_locations (
    transportation_location_id BIGSERIAL PRIMARY KEY,
    study_area_id              BIGINT NOT NULL REFERENCES core.study_areas(study_area_id),
    transportation_mode_id     BIGINT NOT NULL REFERENCES transportation.transportation_modes(transportation_mode_id),
    name                       VARCHAR(200),
    location_type              VARCHAR(50),                 -- BUS_STOP, METRO_STATION, PARKING...
    address                    TEXT,
    geometry                   geometry(Point, 4326) NOT NULL,
    source                     VARCHAR(100),
    status                     VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                               CHECK (status IN ('ACTIVE','INACTIVE'))
);
CREATE INDEX idx_transport_loc_geom ON transportation.transportation_locations USING GIST (geometry);
CREATE INDEX idx_transport_loc_mode ON transportation.transportation_locations (study_area_id, transportation_mode_id);

-- =====================================================================
-- SCHEMA trip  (3 bảng) – dữ liệu CHUYẾN ĐI ẨN DANH của Guest
--
-- Nguyên tắc riêng tư (không lưu vị trí người dùng):
--   * Không có user_id / session_id / IP; không lưu tên/ địa chỉ điểm đi-đến.
--   * origin/destination: backend làm tròn lưới ~100 m trước khi lưu
--       ST_SnapToGrid(ST_SetSRID(ST_MakePoint(lon,lat),4326), 0.001)
--   * origin_region_id / destination_region_id (xã/phường) giữ lại để thống kê theo khu vực.
--   * Sau thời gian lưu giữ, trip.purge_location_data() xóa tọa độ + hình học tuyến;
--     các số liệu tổng hợp (khoảng cách, thời gian, kết quả LEZ) vẫn còn cho dashboard.
-- =====================================================================

CREATE TABLE trip.trips (
    trip_id               BIGSERIAL PRIMARY KEY,
    study_area_id         BIGINT NOT NULL REFERENCES core.study_areas(study_area_id),
    origin                geometry(Point, 4326),            -- NULL sau khi purge
    destination           geometry(Point, 4326),            -- NULL sau khi purge
    origin_region_id      BIGINT REFERENCES gis.administrative_regions(region_id) ON DELETE SET NULL,
    destination_region_id BIGINT REFERENCES gis.administrative_regions(region_id) ON DELETE SET NULL,
    vehicle_type_id       BIGINT NOT NULL REFERENCES policy.vehicle_types(vehicle_type_id),  -- xe hiện tại Guest chọn
    chosen_vehicle_type_id BIGINT REFERENCES policy.vehicle_types(vehicle_type_id),          -- lựa chọn SAU khi xem khuyến nghị (NULL = không chọn)
    switched              BOOLEAN NOT NULL DEFAULT FALSE,                                   -- TRUE = Guest đổi xe so với xe hiện tại -> KPI ý định chuyển đổi
    travel_time           TIMESTAMPTZ NOT NULL,
    trip_purpose          VARCHAR(50),                      -- thống nhất danh mục với dữ liệu survey
    preferences           JSONB NOT NULL DEFAULT '{}'::jsonb, -- ví dụ trọng số tiêu chí Guest ưu tiên
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trips_created  ON trip.trips (created_at);
CREATE INDEX idx_trips_origin_r ON trip.trips (origin_region_id);
CREATE INDEX idx_trips_dest_r   ON trip.trips (destination_region_id);
CREATE INDEX idx_trips_purpose  ON trip.trips (trip_purpose);
CREATE INDEX idx_trips_vehicle  ON trip.trips (vehicle_type_id);

-- Route thô trả về từ OSRM theo routing_profile (các mode cùng profile 'car' dùng chung route).
-- Thời gian/chi phí theo từng mode được tính ở decision.recommendation_scores.
CREATE TABLE trip.trip_routes (
    route_id        BIGSERIAL PRIMARY KEY,
    trip_id         BIGINT NOT NULL REFERENCES trip.trips(trip_id) ON DELETE CASCADE,
    routing_profile VARCHAR(20) NOT NULL DEFAULT 'car'
                    CHECK (routing_profile IN ('car','bike','foot')),
    route_index     SMALLINT NOT NULL DEFAULT 0,            -- 0 = tuyến chính, 1.. = tuyến thay thế
    provider        VARCHAR(50) NOT NULL DEFAULT 'OSRM',
    distance_m      NUMERIC(12,2),
    duration_sec    INTEGER,
    geometry        geometry(LineString, 4326),             -- NULL sau khi purge
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (trip_id, routing_profile, route_index)
);
CREATE INDEX idx_trip_routes_geom    ON trip.trip_routes USING GIST (geometry);
CREATE INDEX idx_trip_routes_created ON trip.trip_routes (created_at);

-- Kết quả phân tích Route × LEZ × loại phương tiện.
-- Độ dài tính bằng mét: dùng ::geography, ví dụ
--   ST_Length(ST_Intersection(r.geometry, z.geometry)::geography)
CREATE TABLE trip.trip_lez_analysis (
    trip_lez_analysis_id    BIGSERIAL PRIMARY KEY,
    route_id                BIGINT NOT NULL REFERENCES trip.trip_routes(route_id) ON DELETE CASCADE,
    lez_zone_id             BIGINT NOT NULL REFERENCES policy.lez_zones(lez_zone_id),
    vehicle_type_id         BIGINT NOT NULL REFERENCES policy.vehicle_types(vehicle_type_id),
    applicable_lez_rule_id  BIGINT REFERENCES policy.lez_rules(lez_rule_id),   -- NULL nếu không có rule áp dụng
    intersects              BOOLEAN NOT NULL,
    intersection_length_m   NUMERIC(12,2),
    intersection_percentage NUMERIC(5,2)
                            CHECK (intersection_percentage BETWEEN 0 AND 100),
    route_lez_status        VARCHAR(10) NOT NULL
                            CHECK (route_lez_status IN ('OUTSIDE','PARTIAL','INSIDE')),
    compliance_status       VARCHAR(20) NOT NULL
                            CHECK (compliance_status IN ('COMPLIANT','CONDITIONAL','NOT_COMPLIANT')),
    compliance_reason       TEXT,
    analyzed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (route_id, lez_zone_id, vehicle_type_id)
);
CREATE INDEX idx_trip_lez_zone   ON trip.trip_lez_analysis (lez_zone_id);
CREATE INDEX idx_trip_lez_status ON trip.trip_lez_analysis (compliance_status);

-- Xóa vị trí chi tiết sau thời gian lưu giữ. Lên lịch bằng pg_cron hoặc job của backend.
CREATE OR REPLACE FUNCTION trip.purge_location_data(p_retention INTERVAL DEFAULT INTERVAL '24 hours')
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    v_cutoff TIMESTAMPTZ := now() - p_retention;
    v_routes INTEGER;
    v_trips  INTEGER;
BEGIN
    UPDATE trip.trip_routes SET geometry = NULL
     WHERE geometry IS NOT NULL AND created_at < v_cutoff;
    GET DIAGNOSTICS v_routes = ROW_COUNT;

    UPDATE trip.trips SET origin = NULL, destination = NULL
     WHERE (origin IS NOT NULL OR destination IS NOT NULL) AND created_at < v_cutoff;
    GET DIAGNOSTICS v_trips = ROW_COUNT;

    RETURN v_routes + v_trips;
END $$;

-- =====================================================================
-- SCHEMA decision  (5 bảng)
-- =====================================================================

CREATE TABLE decision.air_quality_observations (
    air_quality_observation_id BIGSERIAL PRIMARY KEY,
    study_area_id              BIGINT NOT NULL REFERENCES core.study_areas(study_area_id),
    source                     VARCHAR(50) NOT NULL,        -- OPEN_METEO / OPENAQ
    observed_at                TIMESTAMPTZ NOT NULL,
    location                   geometry(Point, 4326),
    aqi                        NUMERIC(6,1),
    pm25                       NUMERIC(8,2),
    pm10                       NUMERIC(8,2),
    no2                        NUMERIC(8,2),
    o3                         NUMERIC(8,2),
    raw_data                   JSONB,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()   -- thời điểm hệ thống lấy về (dùng cho fallback/cache)
);
CREATE INDEX idx_aq_area_time ON decision.air_quality_observations (study_area_id, observed_at DESC);
CREATE INDEX idx_aq_location  ON decision.air_quality_observations USING GIST (location);

-- Tiêu chí MCDM. default_weight là trọng số mặc định; Guest có thể ghi đè qua trip.preferences.
-- Tổng default_weight của các tiêu chí ACTIVE nên = 1 (kiểm ở backend).
CREATE TABLE decision.recommendation_criteria (
    criteria_id    BIGSERIAL PRIMARY KEY,
    code           VARCHAR(50)  NOT NULL UNIQUE,            -- TRAVEL_TIME, COST, LEZ_COMPLIANCE, ACCESSIBILITY, SURVEY_TREND...
    name           VARCHAR(100) NOT NULL,
    criteria_type  VARCHAR(30)  NOT NULL
                   CHECK (criteria_type IN ('COST','BENEFIT')),
    default_weight NUMERIC(5,4) NOT NULL DEFAULT 0
                   CHECK (default_weight BETWEEN 0 AND 1),
    description    TEXT,
    status         VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE decision.recommendation_runs (
    recommendation_run_id BIGSERIAL PRIMARY KEY,
    trip_id               BIGINT NOT NULL REFERENCES trip.trips(trip_id) ON DELETE CASCADE,
    algorithm             VARCHAR(50) NOT NULL DEFAULT 'TOPSIS',
    status                VARCHAR(30) NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','COMPLETED','FAILED')),
    duration_ms           INTEGER,                          -- phục vụ đánh giá hiệu năng (Phase 7)
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at          TIMESTAMPTZ
);
CREATE INDEX idx_reco_runs_trip ON decision.recommendation_runs (trip_id);

-- Một dòng = (lần chạy, mode, tiêu chí). final_score và rank_position là giá trị CỦA MODE,
-- lặp lại trên mọi dòng tiêu chí của mode đó (chủ ý, để truy vấn xếp hạng đơn giản).
CREATE TABLE decision.recommendation_scores (
    recommendation_score_id BIGSERIAL PRIMARY KEY,
    recommendation_run_id   BIGINT NOT NULL REFERENCES decision.recommendation_runs(recommendation_run_id) ON DELETE CASCADE,
    transportation_mode_id  BIGINT NOT NULL REFERENCES transportation.transportation_modes(transportation_mode_id),
    criteria_id             BIGINT NOT NULL REFERENCES decision.recommendation_criteria(criteria_id),
    raw_value               NUMERIC,
    normalized_value        NUMERIC,
    weight                  NUMERIC(5,4),
    weighted_score          NUMERIC,
    final_score             NUMERIC,
    rank_position           SMALLINT,
    UNIQUE (recommendation_run_id, transportation_mode_id, criteria_id)
);
CREATE INDEX idx_reco_scores_rank ON decision.recommendation_scores (recommendation_run_id, rank_position);

CREATE TABLE decision.impact_assessments (
    impact_assessment_id           BIGSERIAL PRIMARY KEY,
    trip_id                        BIGINT NOT NULL REFERENCES trip.trips(trip_id) ON DELETE CASCADE,
    recommendation_run_id          BIGINT REFERENCES decision.recommendation_runs(recommendation_run_id) ON DELETE SET NULL,
    current_transportation_mode_id BIGINT NOT NULL REFERENCES transportation.transportation_modes(transportation_mode_id),
    alternative_transportation_mode_id BIGINT NOT NULL REFERENCES transportation.transportation_modes(transportation_mode_id),
    current_time_min               NUMERIC(8,2),
    alternative_time_min           NUMERIC(8,2),
    current_cost                   NUMERIC(14,0),
    alternative_cost               NUMERIC(14,0),
    current_compliance_status      VARCHAR(20)
                                   CHECK (current_compliance_status IN ('COMPLIANT','CONDITIONAL','NOT_COMPLIANT')),
    alternative_compliance_status  VARCHAR(20)
                                   CHECK (alternative_compliance_status IN ('COMPLIANT','CONDITIONAL','NOT_COMPLIANT')),
    current_score                  NUMERIC,
    alternative_score              NUMERIC,
    -- Chênh lệch tự tính để không thể lệch với dữ liệu gốc
    time_difference                NUMERIC GENERATED ALWAYS AS (alternative_time_min - current_time_min) STORED,
    cost_difference                NUMERIC GENERATED ALWAYS AS (alternative_cost - current_cost) STORED,
    score_difference               NUMERIC GENERATED ALWAYS AS (alternative_score - current_score) STORED,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_impact_diff_modes CHECK (current_transportation_mode_id <> alternative_transportation_mode_id)
);
CREATE INDEX idx_impact_trip ON decision.impact_assessments (trip_id);

-- =====================================================================
-- SCHEMA survey  (1 bảng) – dataset "Vehicle at Ha Noi" (>25.000 mẫu, Kaggle)
-- Proposal dùng dataset này cho: xu hướng chọn phương tiện, ý định chuyển đổi,
-- phân tích theo khu vực/ mục đích, và tiêu chí SURVEY_TREND của MCDM.
--
-- LƯU Ý: các cột bên dưới là thiết kế theo MỤC TIÊU của proposal, chưa đối chiếu
-- với cột thật của file Kaggle. Sau khi inspect dataset (Phase 3) hãy đổi tên/ thêm bớt;
-- toàn bộ cột gốc luôn được giữ trong raw_data nên không mất thông tin.
-- =====================================================================

CREATE TABLE survey.vehicle_survey_responses (
    response_id        BIGSERIAL PRIMARY KEY,
    source_dataset     VARCHAR(100) NOT NULL DEFAULT 'Kaggle: Vehicle at Ha Noi',
    source_row_id      VARCHAR(50),                         -- ID/ số dòng trong file gốc
    study_area_id      BIGINT NOT NULL REFERENCES core.study_areas(study_area_id),
    region_id          BIGINT REFERENCES gis.administrative_regions(region_id) ON DELETE SET NULL,
    area_label         VARCHAR(150),                        -- tên khu vực nguyên bản trong survey
    trip_purpose       VARCHAR(50),
    current_mode_id    BIGINT REFERENCES transportation.transportation_modes(transportation_mode_id),
    preferred_mode_id  BIGINT REFERENCES transportation.transportation_modes(transportation_mode_id),
    willing_to_switch  BOOLEAN,
    trip_distance_km   NUMERIC(8,2),
    trip_time_min      NUMERIC(8,2),
    is_valid           BOOLEAN NOT NULL DEFAULT TRUE,       -- FALSE = bản ghi bị loại khi làm sạch
    raw_data           JSONB NOT NULL,
    imported_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_dataset, source_row_id)
);
CREATE INDEX idx_survey_region  ON survey.vehicle_survey_responses (region_id);
CREATE INDEX idx_survey_purpose ON survey.vehicle_survey_responses (trip_purpose);
CREATE INDEX idx_survey_current ON survey.vehicle_survey_responses (current_mode_id, preferred_mode_id);

COMMIT;

-- Kiểm tra nhanh sau khi chạy (kỳ vọng 21):
--   SELECT count(*) FROM information_schema.tables
--   WHERE table_schema IN ('core','gis','transportation','policy','trip','decision','survey')
--     AND table_type = 'BASE TABLE';
-- Phiên đăng nhập admin (rules.md §7: đăng xuất phải thu hồi được -> cần bảng phiên)
CREATE TABLE IF NOT EXISTS core.admin_sessions (
    session_id  BIGSERIAL PRIMARY KEY,
    admin_id    BIGINT NOT NULL REFERENCES core.admins(admin_id) ON DELETE CASCADE,
    token       VARCHAR(64) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON core.admin_sessions (admin_id);
