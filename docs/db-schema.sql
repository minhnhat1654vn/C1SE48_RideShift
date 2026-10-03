-- ============================================================================
-- RideShift – Smart Transport Transition Advisor (C1SE.48, CMU-SE 450)
-- Database Schema (PostgreSQL) — exported DDL
-- Source of truth : mini-services/fastapi-backend/app/schema.sql
--                 (applied idempotently at backend boot by app/db.py init_db())
-- Design doc      : docs/db.md      • ERD: docs/db-erd.png
--
-- Maps to the official documents:
--   Proposal v1.0 §10  → PostgreSQL + PostGIS
--   Proposal v1.0 NFR-02 → PostGIS indexes for spatial queries
--   Proposal v1.0 Deliverable #10 → PostgreSQL + PostGIS Database
--   Product Backlog v1.0 / User Story v1.0 data-source notes:
--     US-04/22 LezZone · US-06/17/23/24 PolicyRule + TransportMode ·
--     US-08/19 AirQualityCache · US-13 TransportationLocation ·
--     US-16/33 TransportMode · US-25..29/35 TripRecord ·
--     US-10/34 CriteriaWeight · US-21/30 AdminUser + AdminSession ·
--     US-25 dataset_trend + dataset_run (processed survey dataset,
--     Deliverable #11)
--
-- Spatial note: when PostGIS is available (docker-compose deploys
-- postgis/postgis:16-3.4), lez_zone gains a GIST-indexed geometry column
-- (see the optional block at the bottom). Without PostGIS the coordinates
-- JSON stays canonical and spatial analysis runs in Python (Shapely).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Administration & security (US-21 Admin Login, US-30 Admin Logout)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_user (
  id            text PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,               -- sha256(salt:password), salt stored in hash string
  full_name     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_session (
  id         text PRIMARY KEY,
  token      text NOT NULL UNIQUE,
  user_id    text NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,           -- 8-hour session TTL
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- LEZ policy model (US-04 View LEZ Boundaries, US-22 Manage LEZ Areas,
-- US-05/06/17 compliance checking, US-23/24 policy & restriction management)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lez_zone (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  -- canonical polygon storage: JSON array of [lat, lng] pairs (portable)
  coordinates text NOT NULL,
  active      boolean NOT NULL DEFAULT true, -- inactive zones are excluded from compliance (US-32)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- geom geometry(Polygon,4326) + GIST index are added by app/db.py when PostGIS exists

CREATE TABLE IF NOT EXISTS transport_mode (
  id                 text PRIMARY KEY,       -- e.g. 'gasoline_motorbike'
  name               text NOT NULL,
  description        text,
  icon               text NOT NULL,
  avg_speed_kmh      double precision NOT NULL,
  base_cost_vnd      double precision NOT NULL,
  cost_per_km_vnd    double precision NOT NULL,
  co2_per_km_g       double precision NOT NULL,
  base_accessibility double precision NOT NULL,
  base_convenience   double precision NOT NULL,
  wait_minutes       double precision NOT NULL DEFAULT 0,
  enabled            boolean NOT NULL DEFAULT true, -- disabled modes hidden from users (US-33)
  sort_order         integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS policy_rule (
  id               text PRIMARY KEY,
  zone_id          text NOT NULL REFERENCES lez_zone(id) ON DELETE CASCADE,
  mode_id          text NOT NULL REFERENCES transport_mode(id) ON DELETE CASCADE,
  restriction_type text NOT NULL,            -- 'banned' | 'conditional' (US-24 levels)
  condition        text,                     -- human-readable unmet-condition explanation (US-07)
  start_time       text NOT NULL,            -- '06:00' (US-23 applicable time period)
  end_time         text NOT NULL,            -- '22:00'
  days             text NOT NULL,            -- 'Mon,Tue,...'
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- MCDM configuration (US-10 Ranked Recommendations, US-34 Criteria Weights —
-- all rows must sum to 100%)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS criteria_weight (
  id        text PRIMARY KEY,
  criterion text NOT NULL UNIQUE,            -- travelTime|cost|lezCompliance|accessibility|convenience|environment|trend
  weight    double precision NOT NULL,       -- percentage, all rows sum to 100
  label     text NOT NULL
);

-- ---------------------------------------------------------------------------
-- Map facilities (US-13 Transportation Facilities — only active rows shown)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transportation_location (
  id     text PRIMARY KEY,
  name   text NOT NULL,
  type   text NOT NULL,                      -- bus_stop | metro | brt
  lat    double precision NOT NULL,
  lng    double precision NOT NULL,
  active boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------------
-- Trip history & analytics source (US-25..US-29, US-35 — dashboard KPIs,
-- trends by district / purpose / switching; TripRecord in the backlog)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_record (
  id              text PRIMARY KEY,
  origin_name     text NOT NULL,
  dest_name       text NOT NULL,
  origin_district text NOT NULL,             -- US-26 breakdown by geographic area
  origin_lat      double precision NOT NULL,
  origin_lng      double precision NOT NULL,
  dest_lat        double precision NOT NULL,
  dest_lng        double precision NOT NULL,
  distance_km     double precision NOT NULL,
  duration_min    double precision NOT NULL,
  vehicle_id      text NOT NULL,             -- user's current vehicle (US-12 baseline)
  purpose         text NOT NULL,             -- work|school|shopping|leisure|other (US-27)
  departure_hour  integer NOT NULL,
  lez_affected    boolean NOT NULL,          -- US-29 "% routes affected by LEZ"
  top_mode_id     text NOT NULL,             -- most recommended mode
  top_score       double precision NOT NULL,
  avg_cost_vnd    double precision NOT NULL,
  avg_time_min    double precision NOT NULL,
  chosen_mode_id  text,                      -- user's actual choice ("I'll use this")
  switched        boolean NOT NULL DEFAULT false, -- US-28 switching patterns
  created_at      timestamptz NOT NULL DEFAULT now()  -- US-35 date-range filter
);

CREATE INDEX IF NOT EXISTS trip_record_created_idx ON trip_record (created_at);
CREATE INDEX IF NOT EXISTS trip_record_purpose_idx ON trip_record (purpose);

-- ---------------------------------------------------------------------------
-- Air quality fallback cache (US-19 Cached Air Quality on API failure,
-- NFR-11/NFR-12 — 30-minute TTL, stale data served with a notice)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS air_quality_cache (
  id         text PRIMARY KEY,
  cache_key  text NOT NULL UNIQUE,           -- '{lat}:{lng}' rounded to 2 decimals
  payload    text NOT NULL,                  -- JSON AirQualityInfo
  fetched_at timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- Survey dataset pipeline outputs ("Vehicle at Ha Noi Dataset", Deliverable
-- #11 — processed with Python + pandas; consumed by the TOPSIS trend
-- criterion and the admin Survey dataset card, US-25)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dataset_trend (
  id           text PRIMARY KEY,
  mode_id      text NOT NULL,
  month        text NOT NULL,                -- 'YYYY-MM'
  share        double precision NOT NULL,    -- mode share within that month (0..1)
  trend_index  double precision NOT NULL,    -- 0..1, higher = growing/more adopted
  sample_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS dataset_trend_mode_idx ON dataset_trend (mode_id);

CREATE TABLE IF NOT EXISTS dataset_run (
  id          text PRIMARY KEY,
  ran_at      timestamptz NOT NULL DEFAULT now(),
  source_file text NOT NULL,
  rows_in     integer NOT NULL,
  rows_clean  integer NOT NULL,
  notes       text
);

-- ============================================================================
-- OPTIONAL — PostGIS spatial hardening (enabled automatically by app/db.py
-- when the extension exists; docker-compose deploys postgis/postgis:16-3.4).
-- Satisfies Proposal NFR-02 (PostGIS indexes for spatial queries).
-- ============================================================================
-- CREATE EXTENSION IF NOT EXISTS postgis;
-- ALTER TABLE lez_zone ADD COLUMN IF NOT EXISTS geom geometry(Polygon,4326);
-- UPDATE lez_zone SET geom = ST_MakePolygon(ST_GeomFromGeoJSON(...))  -- backfill handled in app/db.py
--   WHERE geom IS NULL;
-- CREATE INDEX IF NOT EXISTS lez_zone_geom_gist ON lez_zone USING gist (geom);
