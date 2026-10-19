-- ============================================================================
-- RideShift – Smart Transport Transition Advisor (C1SE.48)
-- PostgreSQL schema — owned by the FastAPI backend (proposal technology stack)
--
-- Implements the team design document "DB FINAL" (6 logical schemas) with the
-- agreed Capstone adjustments (see the team ERD on dbdiagram.io):
--
--   * no core.users / core.vehicles — the system has only 2 roles (guest,
--     admin) and never stores regular-user accounts or personal vehicles.
--     Authentication data lives in core.admins + core.admin_sessions.
--   * decision.vehicle_survey_responses stores the cleaned rows of the
--     "Vehicle at Ha Noi" survey (raw layer feeding the trend analytics).
--   * core.dataset_runs + decision.dataset_trends are kept as the pipeline
--     audit log and the monthly mode-share aggregate (functions 34–35).
--
--   core            study_areas, admins, admin_sessions, system_logs,
--                   dataset_runs
--   gis             administrative_regions, road_segments, points_of_interest
--   transportation  transportation_modes, transportation_locations
--   policy          lez_zones, lez_rules, vehicle_types, vehicle_restrictions
--   trip            trips, trip_routes, trip_lez_analyses
--   decision        air_quality_observations, recommendation_criteria,
--                   recommendation_runs, recommendation_scores,
--                   impact_assessments, vehicle_survey_responses,
--                   dataset_trends
--
-- 24 tables total (21 per the adjusted DB FINAL + vehicle_survey_responses
-- from the ERD + the 2 dataset-pipeline tables). `public` stays free of
-- business tables: it only hosts PostGIS system objects (spatial_ref_sys).
--
-- Idempotent: safe to run on every boot. Legacy layouts (flat tables in
-- public, the old singular table names, the camelCase Prisma family) are
-- migrated/removed by app/seed.py::migrate_legacy(), NOT here — that keeps
-- the data copy before any DROP.
--
-- SPATIAL DESIGN (DB FINAL, exactly as specified in the document):
--   every shape column is a real PostGIS geometry with a type modifier:
--     core.study_areas.geometry                    GEOMETRY(MULTIPOLYGON,4326)
--     gis.administrative_regions.geometry          GEOMETRY(MULTIPOLYGON,4326)
--     gis.road_segments.geometry                   GEOMETRY(LINESTRING,4326)
--     gis.points_of_interest.geometry              GEOMETRY(POINT,4326)
--     transportation.transportation_locations.geometry GEOMETRY(POINT,4326)
--     policy.lez_zones.geometry                    GEOMETRY(MULTIPOLYGON,4326)
--     trip.trips.origin / trip.trips.destination   GEOMETRY(POINT,4326)
--     trip.trip_routes.geometry                    GEOMETRY(LINESTRING,4326)
--     decision.air_quality_observations.location   GEOMETRY(POINT,4326)
--   …each with a GIST spatial index (DB FINAL workflow step "Create spatial
--   indexes"). PostGIS is a HARD requirement: without the extension the
--   geometry type does not exist and this file refuses to run — deploy with
--   the postgis/postgis image from docker-compose.yml.
--
--   Canonical wire format stays GeoJSON: the backend writes GeoJSON text
--   through ST_SetSRID(ST_GeomFromGeoJSON(…),4326) (see app/db.py::geom_write)
--   and reads shapes back as GeoJSON through ST_AsGeoJSON (db.geom_read), so
--   the REST contract the frontend consumes is unchanged.
--
--   Upgrade path: volumes created by the interim layout (shape columns as
--   TEXT GeoJSON, policy.lez_zones.coordinates JSON) are converted in place
--   by the upgrade block at the end of this file — no data loss, no re-seed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Business schemas (per DB FINAL design document)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS gis;
CREATE SCHEMA IF NOT EXISTS transportation;
CREATE SCHEMA IF NOT EXISTS policy;
CREATE SCHEMA IF NOT EXISTS trip;
CREATE SCHEMA IF NOT EXISTS decision;

-- ---------------------------------------------------------------------------
-- 2) PostGIS is required: the GEOMETRY types below need the extension.
--    Fail loudly (searchable in `docker compose logs backend`) instead of
--    silently degrading to TEXT shapes.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
    RAISE EXCEPTION
      'RideShift requires PostGIS (DB FINAL defines GEOMETRY columns). '
      'Use the postgis/postgis image (docker-compose.yml) or install the '
      'PostGIS extension on this server.';
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- 3) One-time cleanup of legacy junk (no-op on healthy deployments)
--    a. PostGIS extras auto-created by older postgis/postgis images
--       (tiger geocoder + topology are not part of the RideShift design)
--    b. camelCase Prisma family + _prisma_migrations from the old `dbinit`
--       service (the frontend no longer owns any table)
--    NOTE: old snake_case business tables (public.admin_user, core.admin_user,
--    policy.lez_zone, trip.trip_record, …) are intentionally NOT dropped here:
--    app/seed.py migrates their rows into the tables below first.
-- ---------------------------------------------------------------------------
DROP EXTENSION IF EXISTS postgis_tiger_geocoder CASCADE;
DROP EXTENSION IF EXISTS postgis_topology CASCADE;
DROP SCHEMA IF EXISTS tiger CASCADE;
DROP SCHEMA IF EXISTS tiger_data CASCADE;
DROP SCHEMA IF EXISTS topology CASCADE;

DROP TABLE IF EXISTS public."AdminSession" CASCADE;
DROP TABLE IF EXISTS public."AdminUser" CASCADE;
DROP TABLE IF EXISTS public."PolicyRule" CASCADE;
DROP TABLE IF EXISTS public."TransportMode" CASCADE;
DROP TABLE IF EXISTS public."CriteriaWeight" CASCADE;
DROP TABLE IF EXISTS public."TransportationLocation" CASCADE;
DROP TABLE IF EXISTS public."TripRecord" CASCADE;
DROP TABLE IF EXISTS public."AirQualityCache" CASCADE;
DROP TABLE IF EXISTS public."LezZone" CASCADE;
DROP TABLE IF EXISTS public."_prisma_migrations" CASCADE;

-- ---------------------------------------------------------------------------
-- 4) core — study areas, admin accounts, sessions, audit log, dataset runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.study_areas (
  study_area_id BIGSERIAL PRIMARY KEY,
  code          VARCHAR(30)  NOT NULL UNIQUE,      -- e.g. 'HN'
  name          VARCHAR(150) NOT NULL,
  area_type     VARCHAR(30)  NOT NULL DEFAULT 'CITY',
  country_code  VARCHAR(10)  DEFAULT 'VN',
  description   TEXT,
  geometry      GEOMETRY(MULTIPOLYGON,4326),        -- ranh giới khu vực (DB FINAL)
  status        VARCHAR(20)  NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.admins (
  admin_id      BIGSERIAL PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  email         VARCHAR(200),
  password_hash TEXT         NOT NULL,
  full_name     VARCHAR(150),
  role          VARCHAR(30)  NOT NULL DEFAULT 'admin',
  status        VARCHAR(20)  NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.admin_sessions (
  session_id BIGSERIAL PRIMARY KEY,
  admin_id   BIGINT      NOT NULL REFERENCES core.admins(admin_id) ON DELETE CASCADE,
  token      VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx ON core.admin_sessions (admin_id);

CREATE TABLE IF NOT EXISTS core.system_logs (
  log_id      BIGSERIAL PRIMARY KEY,
  admin_id    BIGINT       REFERENCES core.admins(admin_id) ON DELETE SET NULL,
  level       VARCHAR(10)  NOT NULL DEFAULT 'info',   -- info | warn | error
  action      VARCHAR(100) NOT NULL,                  -- LOGIN | ZONE_CREATE | …
  entity_type VARCHAR(100),
  entity_id   BIGINT,
  description TEXT,
  ip_address  VARCHAR(50),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS system_logs_created_idx ON core.system_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS core.dataset_runs (
  dataset_run_id BIGSERIAL PRIMARY KEY,
  ran_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  source_file    VARCHAR(255) NOT NULL,
  rows_in        INTEGER      NOT NULL,
  rows_clean     INTEGER      NOT NULL,
  notes          TEXT
);

-- ---------------------------------------------------------------------------
-- 5) transportation — modes + stops/stations
--    (column set = team ERD + the numeric attributes the MCDM engine needs:
--     avg_speed_kmh, co2_per_km_g, icon, sort_order; lat/lng are convenience
--     numerics derived from geometry — DB FINAL canonical position is the
--     GEOMETRY(POINT,4326) column)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transportation.transportation_modes (
  transportation_mode_id BIGSERIAL PRIMARY KEY,
  code                   VARCHAR(50)     NOT NULL UNIQUE,  -- 'gasoline_motorbike', …
  name                   VARCHAR(100)    NOT NULL,
  category               VARCHAR(30),                      -- motorbike|car|public|active
  description            TEXT,
  icon                   TEXT            NOT NULL DEFAULT 'circle-dot',
  routing_profile        VARCHAR(20)     NOT NULL DEFAULT 'driving', -- osrm: driving|bike|foot
  speed_factor           DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  avg_speed_kmh          DOUBLE PRECISION NOT NULL DEFAULT 20,
  base_fare              NUMERIC(12,2)   NOT NULL DEFAULT 0,
  cost_per_km            NUMERIC(12,2)   NOT NULL DEFAULT 0,
  co2_per_km_g           DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_wait_min           DOUBLE PRECISION NOT NULL DEFAULT 0,
  accessibility_score    DOUBLE PRECISION NOT NULL DEFAULT 0.7,  -- 0..1 (doc: 0..100)
  convenience_score      DOUBLE PRECISION NOT NULL DEFAULT 0.7,  -- 0..1 (doc: 0..100)
  is_active              BOOLEAN         NOT NULL DEFAULT true,
  sort_order             INTEGER         NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transportation.transportation_locations (
  transportation_location_id BIGSERIAL PRIMARY KEY,
  study_area_id              BIGINT      NOT NULL REFERENCES core.study_areas(study_area_id),
  transportation_mode_id     BIGINT      REFERENCES transportation.transportation_modes(transportation_mode_id),
  name                       VARCHAR(200) NOT NULL,
  location_type              VARCHAR(50) NOT NULL,   -- bus_stop | metro | brt
  address                    TEXT,
  lat                        DOUBLE PRECISION NOT NULL,
  lng                        DOUBLE PRECISION NOT NULL,
  geometry                   GEOMETRY(POINT,4326),    -- vị trí điểm (DB FINAL)
  source                     VARCHAR(100) DEFAULT 'manual',
  status                     VARCHAR(20)  NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS transportation_locations_study_idx
  ON transportation.transportation_locations (study_area_id);

-- ---------------------------------------------------------------------------
-- 6) gis — administrative boundaries + reserved GIS import tables
--    (road_segments / points_of_interest stay EMPTY by design: data is
--    imported from OpenStreetMap into PostGIS per the DB FINAL workflow,
--    not hand-written by the app)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gis.administrative_regions (
  region_id        BIGSERIAL PRIMARY KEY,
  study_area_id    BIGINT      NOT NULL REFERENCES core.study_areas(study_area_id),
  parent_region_id BIGINT      REFERENCES gis.administrative_regions(region_id),
  code             VARCHAR(30),
  name             VARCHAR(150) NOT NULL,
  region_type      VARCHAR(50) NOT NULL DEFAULT 'DISTRICT', -- CITY | DISTRICT | AREA
  geometry         GEOMETRY(MULTIPOLYGON,4326),  -- ranh giới vùng (DB FINAL)
  source           VARCHAR(100) DEFAULT 'manual',
  status           VARCHAR(20)  NOT NULL DEFAULT 'active'
);
CREATE UNIQUE INDEX IF NOT EXISTS administrative_regions_study_name_uq
  ON gis.administrative_regions (study_area_id, name);

CREATE TABLE IF NOT EXISTS gis.road_segments (
  road_segment_id BIGSERIAL PRIMARY KEY,
  study_area_id   BIGINT REFERENCES core.study_areas(study_area_id),
  osm_id          BIGINT,
  name            VARCHAR(200),
  highway_type    VARCHAR(50),
  oneway          BOOLEAN,
  max_speed       INTEGER,
  length_m        NUMERIC(12,2),
  geometry        GEOMETRY(LINESTRING,4326),  -- hình học đoạn đường (DB FINAL)
  source          VARCHAR(100),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gis.points_of_interest (
  poi_id        BIGSERIAL PRIMARY KEY,
  study_area_id BIGINT      NOT NULL REFERENCES core.study_areas(study_area_id),
  name          VARCHAR(200),
  category      VARCHAR(100),
  address       TEXT,
  source        VARCHAR(100),
  geometry      GEOMETRY(POINT,4326),         -- vị trí POI (DB FINAL)
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
);

-- ---------------------------------------------------------------------------
-- 7) policy — LEZ zones, rules, vehicle taxonomy + restrictions
--    (a LEZ rule carries the time window; vehicle_restrictions attach the
--     per-vehicle-type verdict — banned / conditional / min emission level)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS policy.vehicle_types (
  vehicle_type_id        BIGSERIAL PRIMARY KEY,
  code                   VARCHAR(50)  NOT NULL UNIQUE,
  name                   VARCHAR(100) NOT NULL,
  category               VARCHAR(50),
  fuel_type              VARCHAR(50),            -- PETROL | DIESEL | ELECTRIC | HUMAN
  emission_standard      VARCHAR(50),            -- 'EURO 3' | 'ZERO' | …
  emission_level         SMALLINT     NOT NULL DEFAULT 0, -- 0 = zero emission, 1..6 = Euro
  transportation_mode_id BIGINT       NOT NULL REFERENCES transportation.transportation_modes(transportation_mode_id),
  is_default             BOOLEAN      NOT NULL DEFAULT true,
  description            TEXT,
  status                 VARCHAR(20)  NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS policy.lez_zones (
  lez_zone_id    BIGSERIAL PRIMARY KEY,
  study_area_id  BIGINT       NOT NULL REFERENCES core.study_areas(study_area_id),
  name           VARCHAR(200) NOT NULL,
  description    TEXT,
  geometry       GEOMETRY(MULTIPOLYGON,4326) NOT NULL,  -- ranh giới LEZ (DB FINAL)
  effective_from DATE,
  effective_to   DATE,
  status         VARCHAR(30)  NOT NULL DEFAULT 'active',  -- active | inactive
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy.lez_rules (
  lez_rule_id    BIGSERIAL PRIMARY KEY,
  lez_zone_id    BIGINT       NOT NULL REFERENCES policy.lez_zones(lez_zone_id) ON DELETE CASCADE,
  rule_name      VARCHAR(200) NOT NULL,
  description    TEXT,
  start_time     TIME         NOT NULL DEFAULT '00:00',
  end_time       TIME         NOT NULL DEFAULT '23:59',
  days_of_week   VARCHAR(50)  NOT NULL DEFAULT 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
  effective_from DATE,
  effective_to   DATE,
  status         VARCHAR(30)  NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lez_rules_zone_idx ON policy.lez_rules (lez_zone_id);

CREATE TABLE IF NOT EXISTS policy.vehicle_restrictions (
  vehicle_restriction_id BIGSERIAL PRIMARY KEY,
  lez_rule_id            BIGINT      NOT NULL REFERENCES policy.lez_rules(lez_rule_id) ON DELETE CASCADE,
  vehicle_type_id        BIGINT      NOT NULL REFERENCES policy.vehicle_types(vehicle_type_id),
  restriction_type       VARCHAR(20) NOT NULL DEFAULT 'banned',  -- banned | conditional
  min_emission_level     SMALLINT    NOT NULL DEFAULT 0,
  restriction_reason     TEXT
);
CREATE INDEX IF NOT EXISTS vehicle_restrictions_rule_idx ON policy.vehicle_restrictions (lez_rule_id);

-- ---------------------------------------------------------------------------
-- 8) trip — trips, persisted OSRM routes + per-zone LEZ analyses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip.trips (
  trip_id                BIGSERIAL PRIMARY KEY,
  study_area_id          BIGINT      NOT NULL REFERENCES core.study_areas(study_area_id),
  origin_name            VARCHAR(255) NOT NULL,
  destination_name       VARCHAR(255) NOT NULL,
  origin                 GEOMETRY(POINT,4326),  -- tọa độ xuất phát (DB FINAL)
  destination            GEOMETRY(POINT,4326),  -- tọa độ điểm đến (DB FINAL)
  origin_lat             DOUBLE PRECISION NOT NULL,
  origin_lng             DOUBLE PRECISION NOT NULL,
  dest_lat               DOUBLE PRECISION NOT NULL,
  dest_lng               DOUBLE PRECISION NOT NULL,
  origin_region_id       BIGINT REFERENCES gis.administrative_regions(region_id),
  destination_region_id  BIGINT REFERENCES gis.administrative_regions(region_id),
  origin_district        VARCHAR(100) NOT NULL DEFAULT 'Central Hanoi',
  vehicle_type_id        BIGINT       NOT NULL REFERENCES policy.vehicle_types(vehicle_type_id),
  chosen_vehicle_type_id BIGINT       REFERENCES policy.vehicle_types(vehicle_type_id),
  switched               BOOLEAN      NOT NULL DEFAULT false,
  top_mode_id            BIGINT       NOT NULL REFERENCES transportation.transportation_modes(transportation_mode_id),
  top_score              DOUBLE PRECISION NOT NULL DEFAULT 0,
  travel_time            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  departure_hour         SMALLINT     NOT NULL DEFAULT 0,
  trip_purpose           VARCHAR(50)  NOT NULL DEFAULT 'other',
  preferences            JSONB        NOT NULL DEFAULT '{}',
  distance_km            DOUBLE PRECISION NOT NULL DEFAULT 0,
  duration_min           DOUBLE PRECISION NOT NULL DEFAULT 0,
  lez_affected           BOOLEAN      NOT NULL DEFAULT false,
  avg_cost_vnd           DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_time_min           DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trips_created_idx  ON trip.trips (created_at);
CREATE INDEX IF NOT EXISTS trips_purpose_idx  ON trip.trips (trip_purpose);
CREATE INDEX IF NOT EXISTS trips_district_idx ON trip.trips (origin_district);

CREATE TABLE IF NOT EXISTS trip.trip_routes (
  route_id        BIGSERIAL PRIMARY KEY,
  trip_id         BIGINT      NOT NULL REFERENCES trip.trips(trip_id) ON DELETE CASCADE,
  routing_profile VARCHAR(20) NOT NULL DEFAULT 'driving',
  route_index     SMALLINT    NOT NULL DEFAULT 0,
  provider        VARCHAR(30) NOT NULL DEFAULT 'osrm',
  distance_m      NUMERIC(12,2),
  duration_sec    INTEGER,
  geometry        GEOMETRY(LINESTRING,4326),  -- hình học tuyến đường (DB FINAL)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_routes_trip_idx ON trip.trip_routes (trip_id);

CREATE TABLE IF NOT EXISTS trip.trip_lez_analyses (
  trip_lez_analysis_id    BIGSERIAL PRIMARY KEY,
  route_id                BIGINT      NOT NULL REFERENCES trip.trip_routes(route_id) ON DELETE CASCADE,
  lez_zone_id             BIGINT      NOT NULL REFERENCES policy.lez_zones(lez_zone_id) ON DELETE CASCADE,
  vehicle_type_id         BIGINT      REFERENCES policy.vehicle_types(vehicle_type_id),
  applicable_lez_rule_id  BIGINT      REFERENCES policy.lez_rules(lez_rule_id) ON DELETE SET NULL,
  intersects              BOOLEAN     NOT NULL DEFAULT false,
  intersection_length_m   NUMERIC(12,2) NOT NULL DEFAULT 0,
  intersection_percentage NUMERIC(5,2)  NOT NULL DEFAULT 0,
  route_lez_status        VARCHAR(10) NOT NULL DEFAULT 'outside', -- outside|partial|within
  compliance_status       VARCHAR(30),
  compliance_reason       TEXT,
  analyzed_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_lez_analyses_route_idx ON trip.trip_lez_analyses (route_id);

-- ---------------------------------------------------------------------------
-- 9) decision — MCDM criteria/runs/scores, impact, air quality, survey data
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS decision.recommendation_criteria (
  criteria_id    BIGSERIAL PRIMARY KEY,
  code           VARCHAR(50)  NOT NULL UNIQUE,   -- travelTime|cost|lezCompliance|…
  name           VARCHAR(100) NOT NULL,
  criteria_type  VARCHAR(30)  NOT NULL DEFAULT 'BENEFIT' CHECK (criteria_type IN ('COST','BENEFIT')),
  default_weight NUMERIC(5,2) NOT NULL DEFAULT 0,  -- percentage, all rows sum to 100
  description    TEXT,
  status         VARCHAR(20)  NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS decision.recommendation_runs (
  recommendation_run_id BIGSERIAL PRIMARY KEY,
  trip_id               BIGINT      NOT NULL REFERENCES trip.trips(trip_id) ON DELETE CASCADE,
  algorithm             VARCHAR(30) NOT NULL DEFAULT 'TOPSIS',
  status                VARCHAR(30) NOT NULL DEFAULT 'completed',
  duration_ms           INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS recommendation_runs_trip_idx ON decision.recommendation_runs (trip_id);

CREATE TABLE IF NOT EXISTS decision.recommendation_scores (
  recommendation_score_id BIGSERIAL PRIMARY KEY,
  recommendation_run_id   BIGINT        NOT NULL REFERENCES decision.recommendation_runs(recommendation_run_id) ON DELETE CASCADE,
  transportation_mode_id  BIGINT        NOT NULL REFERENCES transportation.transportation_modes(transportation_mode_id),
  criteria_id             BIGINT        NOT NULL REFERENCES decision.recommendation_criteria(criteria_id),
  raw_value               NUMERIC,
  normalized_value        NUMERIC,
  weight                  NUMERIC(6,3),
  weighted_score          NUMERIC,
  final_score             NUMERIC,
  rank_position           SMALLINT,
  UNIQUE (recommendation_run_id, transportation_mode_id, criteria_id)
);

CREATE TABLE IF NOT EXISTS decision.impact_assessments (
  impact_assessment_id             BIGSERIAL PRIMARY KEY,
  trip_id                          BIGINT NOT NULL REFERENCES trip.trips(trip_id) ON DELETE CASCADE,
  recommendation_run_id            BIGINT REFERENCES decision.recommendation_runs(recommendation_run_id) ON DELETE SET NULL,
  current_transportation_mode_id   BIGINT NOT NULL REFERENCES transportation.transportation_modes(transportation_mode_id),
  alternative_transportation_mode_id BIGINT NOT NULL REFERENCES transportation.transportation_modes(transportation_mode_id),
  current_time_min                 NUMERIC(10,2),
  alternative_time_min             NUMERIC(10,2),
  current_cost                     NUMERIC(14,2),
  alternative_cost                 NUMERIC(14,2),
  current_compliance_status        VARCHAR(30),
  alternative_compliance_status    VARCHAR(30),
  current_score                    NUMERIC(6,4) DEFAULT 0,
  alternative_score                NUMERIC(6,4) DEFAULT 0,
  time_difference                  NUMERIC(10,2),
  cost_difference                  NUMERIC(14,2),
  score_difference                 NUMERIC(6,4),
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS impact_assessments_trip_idx ON decision.impact_assessments (trip_id);

CREATE TABLE IF NOT EXISTS decision.air_quality_observations (
  air_quality_observation_id BIGSERIAL PRIMARY KEY,
  cache_key                  VARCHAR(20) NOT NULL UNIQUE,  -- '{lat}:{lng}' rounded to 2 decimals
  study_area_id              BIGINT REFERENCES core.study_areas(study_area_id),
  source                     VARCHAR(50) NOT NULL DEFAULT 'open-meteo',
  lat                        DOUBLE PRECISION NOT NULL,
  lng                        DOUBLE PRECISION NOT NULL,
  location                   GEOMETRY(POINT,4326),  -- vị trí quan sát (DB FINAL)
  observed_at                TIMESTAMPTZ  NOT NULL,
  aqi                        INTEGER,
  pm25                       NUMERIC(6,1),
  pm10                       NUMERIC(6,1),
  no2                        NUMERIC,
  o3                         NUMERIC,
  raw_data                   JSONB        NOT NULL,   -- full upstream payload
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision.vehicle_survey_responses (
  response_id       BIGSERIAL PRIMARY KEY,
  source_dataset    VARCHAR(100) NOT NULL DEFAULT 'vehicle_at_hanoi.csv',
  source_row        VARCHAR(50),           -- respondent_id in the source CSV
  study_area_id     BIGINT REFERENCES core.study_areas(study_area_id),
  region_id         BIGINT REFERENCES gis.administrative_regions(region_id),
  area_label        VARCHAR(150),          -- district as recorded in the survey
  trip_purpose      VARCHAR(50),
  current_mode_id   BIGINT REFERENCES transportation.transportation_modes(transportation_mode_id),
  preferred_mode_id BIGINT REFERENCES transportation.transportation_modes(transportation_mode_id),
  willing_to_switch BOOLEAN,
  trip_distance_km  NUMERIC(8,2),
  trip_time_min     NUMERIC(8,2),
  is_valid          BOOLEAN     NOT NULL DEFAULT true,
  raw_data          JSONB       NOT NULL,  -- the original CSV row
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_survey_responses_region_idx ON decision.vehicle_survey_responses (region_id);
CREATE INDEX IF NOT EXISTS vehicle_survey_responses_mode_idx   ON decision.vehicle_survey_responses (current_mode_id);

CREATE TABLE IF NOT EXISTS decision.dataset_trends (
  trend_id               BIGSERIAL PRIMARY KEY,
  transportation_mode_id BIGINT        NOT NULL REFERENCES transportation.transportation_modes(transportation_mode_id) ON DELETE CASCADE,
  month                  VARCHAR(7)    NOT NULL,           -- 'YYYY-MM'
  share                  NUMERIC(7,4)  NOT NULL DEFAULT 0, -- mode share within that month (0..1)
  trend_index            NUMERIC(7,4)  NOT NULL DEFAULT 0, -- 0..1, higher = growing/more adopted
  sample_count           INTEGER       NOT NULL DEFAULT 0,
  UNIQUE (transportation_mode_id, month)
);
CREATE INDEX IF NOT EXISTS dataset_trends_month_idx ON decision.dataset_trends (month);

-- ---------------------------------------------------------------------------
-- 10) Upgrade path for volumes created by the INTERIM layout (shape columns
--     as TEXT GeoJSON / policy.lez_zones.coordinates JSON). No-op on fresh
--     databases (columns are already geometry) and idempotent on re-boots.
--     Runs after CREATE TABLE above so both fresh and legacy volumes end up
--     with the exact DB FINAL geometry columns before the GIST indexes.
-- ---------------------------------------------------------------------------

-- 10a) policy.lez_zones: interim `coordinates` JSON ([[lat,lng],…]) → geometry.
--      Per-zone conversion is exception-guarded so one corrupt ring cannot
--      abort the whole boot; the column only becomes NOT NULL when every row
--      was converted.
DO $$
DECLARE
  z record;
  pts jsonb;
  ring jsonb;
  remaining_nulls integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'policy' AND table_name = 'lez_zones'
      AND column_name = 'coordinates'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'policy' AND table_name = 'lez_zones'
        AND column_name = 'geometry'
    ) THEN
      ALTER TABLE policy.lez_zones ADD COLUMN geometry geometry(MultiPolygon,4326);
    END IF;
    FOR z IN
      SELECT lez_zone_id, coordinates
      FROM policy.lez_zones
      WHERE geometry IS NULL AND coordinates IS NOT NULL
    LOOP
      BEGIN
        pts := z.coordinates::jsonb;
        IF jsonb_typeof(pts) = 'array' AND jsonb_array_length(pts) >= 3 THEN
          SELECT jsonb_agg(jsonb_build_array(p -> 1, p -> 0) ORDER BY ord)
            INTO ring
            FROM jsonb_array_elements(pts) WITH ORDINALITY AS t(p, ord);
          ring := ring || jsonb_build_array(pts -> 0 -> 1, pts -> 0 -> 0);  -- close the ring
          UPDATE policy.lez_zones
             SET geometry = ST_SetSRID(
                   ST_Multi(ST_GeomFromGeoJSON(
                     json_build_object('type', 'Polygon',
                                       'coordinates', json_build_array(ring))::text)),
                   4326)
           WHERE lez_zone_id = z.lez_zone_id;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'lez_zones %: coordinates not convertible to geometry (%) — row kept, geometry NULL', z.lez_zone_id, SQLERRM;
      END;
    END LOOP;
    SELECT count(*) INTO remaining_nulls FROM policy.lez_zones WHERE geometry IS NULL;
    IF remaining_nulls = 0 THEN
      ALTER TABLE policy.lez_zones ALTER COLUMN geometry SET NOT NULL;
    ELSE
      RAISE WARNING 'lez_zones.geometry stays nullable: % row(s) without a convertible ring', remaining_nulls;
    END IF;
    ALTER TABLE policy.lez_zones DROP COLUMN coordinates;
  END IF;
END $$;

-- 10b) the 9 remaining shape columns: TEXT GeoJSON → geometry (in place),
--      plus the GIST spatial indexes for every geometry shape column
--      (DB FINAL workflow step "Create spatial indexes"). Conversion of each
--      column is exception-guarded; indexes are created for columns that are
--      geometry — fresh installs included.
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('core',         'study_areas',                'geometry',   'geometry(MultiPolygon,4326)', true,  'study_areas_geometry_gist'),
      ('gis',          'administrative_regions',     'geometry',   'geometry(MultiPolygon,4326)', true,  'admin_regions_geometry_gist'),
      ('gis',          'road_segments',              'geometry',   'geometry(LineString,4326)',   false, 'road_segments_geometry_gist'),
      ('gis',          'points_of_interest',         'geometry',   'geometry(Point,4326)',        false, 'poi_geometry_gist'),
      ('transportation','transportation_locations',  'geometry',   'geometry(Point,4326)',        false, 'locations_geometry_gist'),
      ('policy',       'lez_zones',                  'geometry',   'geometry(MultiPolygon,4326)', true,  'lez_zones_geometry_gist'),
      ('trip',         'trips',                      'origin',     'geometry(Point,4326)',        false, 'trips_origin_gist'),
      ('trip',         'trips',                      'destination','geometry(Point,4326)',        false, 'trips_destination_gist'),
      ('trip',         'trip_routes',                'geometry',   'geometry(LineString,4326)',   false, 'trip_routes_geometry_gist'),
      ('decision',     'air_quality_observations',   'location',   'geometry(Point,4326)',        false, 'aq_observations_location_gist')
    ) AS t(sch, tbl, col, typ, multi, idx)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = spec.sch AND table_name = spec.tbl
        AND column_name = spec.col AND data_type = 'text'
    ) THEN
      BEGIN
        EXECUTE format(
          'ALTER TABLE %I.%I ALTER COLUMN %I TYPE %s '
          'USING CASE WHEN %I IS NULL OR btrim(%I) IN ('''', ''null'') THEN NULL '
          'ELSE ST_SetSRID(%s(ST_GeomFromGeoJSON(%I)), 4326) END',
          spec.sch, spec.tbl, spec.col, spec.typ,
          spec.col, spec.col,
          CASE WHEN spec.multi THEN 'ST_Multi' ELSE '' END,
          spec.col);
        RAISE NOTICE 'upgraded %.% to %', spec.sch, spec.col, spec.typ;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'could not upgrade %.% to %: % — column kept as TEXT', spec.sch, spec.tbl, spec.typ, SQLERRM;
      END;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = spec.sch AND table_name = spec.tbl
        AND column_name = spec.col AND udt_name = 'geometry'
    ) THEN
      BEGIN
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I USING gist (%I)',
                       spec.idx, spec.sch, spec.tbl, spec.col);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'could not create GIST index %: %', spec.idx, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;

-- legacy mirror column from the interim hybrid layout (db.py::sync_zone_geom)
ALTER TABLE policy.lez_zones DROP COLUMN IF EXISTS geom;
