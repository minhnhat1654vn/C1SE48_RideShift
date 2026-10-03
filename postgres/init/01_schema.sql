-- ============================================================================
-- RideShift – Smart Transport Transition Advisor (C1SE.48)
-- PostgreSQL schema — owned by the FastAPI backend (proposal technology stack)
--
-- Spatial note: when PostGIS is available (docker-compose deploys
-- postgis/postgis), lez_zone gains a GIST-indexed geometry(Polygon,4326)
-- column managed by app/db.py. Without PostGIS the coordinates JSON remains
-- the canonical source and spatial analysis runs in the Python/Shapely layer.
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_user (
  id            text PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_session (
  id         text PRIMARY KEY,
  token      text NOT NULL UNIQUE,
  user_id    text NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lez_zone (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  -- canonical polygon storage: JSON array of [lat, lng] pairs (portable)
  coordinates text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- geom geometry(Polygon,4326) + GIST index are added by app/db.py when PostGIS exists

CREATE TABLE IF NOT EXISTS transport_mode (
  id                 text PRIMARY KEY,   -- e.g. 'gasoline_motorbike'
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
  enabled            boolean NOT NULL DEFAULT true,
  sort_order         integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS policy_rule (
  id               text PRIMARY KEY,
  zone_id          text NOT NULL REFERENCES lez_zone(id) ON DELETE CASCADE,
  mode_id          text NOT NULL REFERENCES transport_mode(id) ON DELETE CASCADE,
  restriction_type text NOT NULL,      -- 'banned' | 'conditional'
  condition        text,
  start_time       text NOT NULL,      -- '06:00'
  end_time         text NOT NULL,      -- '22:00'
  days             text NOT NULL,      -- 'Mon,Tue,...'
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS criteria_weight (
  id        text PRIMARY KEY,
  criterion text NOT NULL UNIQUE,      -- travelTime|cost|lezCompliance|accessibility|convenience|environment|trend
  weight    double precision NOT NULL, -- percentage, all rows sum to 100
  label     text NOT NULL
);

CREATE TABLE IF NOT EXISTS transportation_location (
  id     text PRIMARY KEY,
  name   text NOT NULL,
  type   text NOT NULL,                -- bus_stop | metro | brt
  lat    double precision NOT NULL,
  lng    double precision NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS trip_record (
  id              text PRIMARY KEY,
  origin_name     text NOT NULL,
  dest_name       text NOT NULL,
  origin_district text NOT NULL,
  origin_lat      double precision NOT NULL,
  origin_lng      double precision NOT NULL,
  dest_lat        double precision NOT NULL,
  dest_lng        double precision NOT NULL,
  distance_km     double precision NOT NULL,
  duration_min    double precision NOT NULL,
  vehicle_id      text NOT NULL,
  purpose         text NOT NULL,       -- work|school|shopping|leisure|other
  departure_hour  integer NOT NULL,
  lez_affected    boolean NOT NULL,
  top_mode_id     text NOT NULL,
  top_score       double precision NOT NULL,
  avg_cost_vnd    double precision NOT NULL,
  avg_time_min    double precision NOT NULL,
  chosen_mode_id  text,
  switched        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_record_created_idx ON trip_record (created_at);
CREATE INDEX IF NOT EXISTS trip_record_purpose_idx ON trip_record (purpose);

CREATE TABLE IF NOT EXISTS air_quality_cache (
  id         text PRIMARY KEY,
  cache_key  text NOT NULL UNIQUE,     -- '{lat}:{lng}' rounded to 2 decimals
  payload    text NOT NULL,            -- JSON AirQualityInfo
  fetched_at timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- Survey dataset pipeline outputs ("Vehicle at Ha Noi Dataset", Deliverable
-- #11 — processed with Python + pandas; consumed by the TOPSIS trend criterion)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dataset_trend (
  id          text PRIMARY KEY,
  mode_id     text NOT NULL,
  month       text NOT NULL,           -- 'YYYY-MM'
  share       double precision NOT NULL, -- mode share within that month (0..1)
  trend_index double precision NOT NULL, -- 0..1, higher = growing/more adopted
  sample_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS dataset_trend_mode_idx ON dataset_trend (mode_id);

CREATE TABLE IF NOT EXISTS dataset_run (
  id         text PRIMARY KEY,
  ran_at     timestamptz NOT NULL DEFAULT now(),
  source_file text NOT NULL,
  rows_in    integer NOT NULL,
  rows_clean integer NOT NULL,
  notes      text
);
