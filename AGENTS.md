# AGENTS.md — Guidance for AI Coding Agents

This repository is **RideShift — Smart Transport Transition Advisor** (C1SE.48 capstone):
a Low-Emission-Zone (LEZ) trip advisor for Hanoi. UI language is **Vietnamese**.

## Repository map

```
frontend/     Next.js 16 + React 19 + TS + Tailwind 4 + shadcn/ui + Leaflet (port 3000)
  src/app/                       App Router — single page (page.tsx), layout, keepalive API route
  src/components/rideshift/      planner, results, map-view (3D wards), admin-dashboard, docs-viewer
  src/components/rideshift/admin/  zones-tab (map + wizard), rules-modes-tabs (tables + weights)
  src/lib/api.ts                 THE only place that resolves backend URLs
backend/      FastAPI (port 8000) — Python 3.12, pandas, Shapely, psycopg 3
  app/routers/                   public.py, trip.py, admin.py (all REST endpoints)
  app/services/                  geo.py, mcdm.py (TOPSIS), external.py, airquality.py, trend.py
  app/schema.sql                 canonical PostgreSQL schema (idempotent) — 6 DB FINAL schemas,
                                 10 PostGIS GEOMETRY(...) columns + GIST indexes
  app/db.py + app/seed.py        connection (+search_path), geom_write/geom_read helpers, idempotent seed
  app/geojson.py                 GeoJSON ⇄ [[lat,lng]] pair helpers (wire format stays GeoJSON)
  data/                          survey dataset CSVs (Deliverable #11)
postgres/     schema.reference.sql (mirror of backend schema, docs only) + snapshot/ (demo data)
osrm/         optional self-hosted OSRM setup (scripts + README)
docs/         architecture, ERD, DB docs, project documents, data sources
```

## Running / verification

```bash
# full stack
cp .env.example .env && docker compose up --build
# UI http://localhost:3000 · API http://localhost:8000/docs · PostGIS :5432

# manual
cd backend  && pip install -r requirements.txt && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rideshift python3 -m uvicorn main:app --port 8000
cd frontend && bun install && NEXT_PUBLIC_API_BASE=http://localhost:8000 bun run dev
```

Admin demo credentials: `admin` / `admin123`.

## Architecture rules — do NOT break

1. **Frontend is a pure React layer.** It owns NO database — no Prisma, no ORM. Every REST call
   goes through `frontend/src/lib/api.ts` (`apiUrl`/`apiFetch`, `credentials: 'include'` so the
   admin session cookie survives the cross-origin Docker setup): set `NEXT_PUBLIC_API_BASE` for
   normal deploys; empty value = sandbox gateway mode that appends the `XTransformPort` query
   parameter.
2. **Backend owns the schema.** Tables live in `backend/app/schema.sql`
   (`CREATE TABLE IF NOT EXISTS` — safe to re-run). **PostGIS is a hard
   requirement** (DB FINAL): all 10 shape columns are real `GEOMETRY(...)`
   types (MULTIPOLYGON / LINESTRING / POINT, SRID 4326) with GIST indexes.
   Writes go through `db.geom_write()` (GeoJSON → ST_SetSRID(ST_GeomFromGeoJSON…))
   and reads through `db.geom_read()` (ST_AsGeoJSON) — the REST wire format
   stays GeoJSON / `[[lat, lng], …]` so the frontend is untouched. Volumes
   created by the older TEXT-column layout are upgraded in place by the
   upgrade blocks at the end of schema.sql (idempotent, no data loss).
3. **Seed is idempotent** (`backend/app/seed.py` skips when data exists). On first boot the
   backend also runs the survey-dataset pipeline (`app/services/trend.py`) when empty.
4. **Error contract:** every non-2xx response is `{ "error": string }` (Vietnamese, user-facing).
   Handlers in `backend/main.py` enforce this — keep new endpoints compliant.
5. **Admin auth scheme:** `password_hash = SALT + "$" + sha256(SALT + ":" + password)` with
   `SALT = RIDESHIFT_SALT` env (default `rideshift-c1se48`); session cookie
   `rs_admin_session`, 8h TTL. Changing the scheme breaks existing credentials.
6. **Ranking integrity:** TOPSIS lives in `backend/app/services/mcdm.py`. The frontend may
   re-order *display* (e.g. pin the user's chosen vehicle on top, banned vehicles shown as
   warning cards without rank/score/buttons) but must never recompute or fake scores.
7. **LEZ compliance is tri-state:** `not_permitted` (banned — red) / `conditionally_restricted`
   (amber) / compliant (green). This state drives all warning UI.
8. **UI conventions:** Vietnamese copy, shadcn/ui + Tailwind, emerald/green palette (avoid
   blue/indigo), mobile-first, sticky footer (`min-h-screen flex flex-col` + `mt-auto`),
   long lists scroll inside `max-h-* overflow-y-auto` containers.
9. **Weights sum to 100.** `PUT /api/admin/weights` rejects otherwise; the UI validates live.

## Common change recipes

| Task | Files |
|---|---|
| New/changed API | `backend/app/routers/*.py` (+ DTO in `backend/app/dto.py`), then types in `frontend/src/lib/types.ts` |
| New result section | `frontend/src/components/rideshift/results.tsx` |
| Planner behaviour | `frontend/src/components/rideshift/planner.tsx` |
| Admin screens | `frontend/src/components/rideshift/admin-dashboard.tsx`, `admin/*.tsx` |
| Map layers / 3D wards | `frontend/src/components/rideshift/map-view.tsx` + `public/data/hanoi-wards.geojson` |
| Schema change | `backend/app/schema.sql` (business tables live in the 6 DB FINAL schemas: core/gis/transportation/policy/trip/decision) + `backend/app/db.py` if search_path/PostGIS touched + `backend/app/seed.py` for new default rows; mirror the DDL to `postgres/schema.reference.sql` |
| Seed/demo content | `backend/app/seed.py`, `backend/data/` |

## Gotchas

- `frontend/Dockerfile` builds with `NEXT_PUBLIC_API_BASE` as a **build arg** — it is baked into
  the client bundle; rebuild the image when it changes.
- The frontend `bun run dev` script logs to `dev.log` (sandbox habit); safe to ignore locally.
- `osrm/data/` is gitignored — OSRM extracts are downloaded via `osrm/scripts/download.sh`.
- The database has ONE owner: the FastAPI backend. Never add a second ORM/data owner (the old
  Prisma camelCase family + `dbinit` service were removed for exactly this reason). New DDL goes
  into `backend/app/schema.sql` (24 tables / 6 schemas per the team ERD — fully-qualified
  names such as `core.admins`, `policy.lez_zones`, `trip.trips`); app SQL uses fully-qualified
  names too. Legacy layouts are auto-migrated by `seed.py::migrate_legacy()`. See `postgres/README.md`.
- All backend external calls (Nominatim/OSRM/Open-Meteo) set a descriptive `User-Agent` and
  timeout; keep it that way or providers will return 403/timeouts.
