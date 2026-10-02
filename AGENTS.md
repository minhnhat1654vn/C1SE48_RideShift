# RideShift Development Rules

## Frontend

- React
- JavaScript ES2022
- Vite
- Do not use TypeScript unless the team explicitly changes the project standard.

## Backend

- Python
- FastAPI
- SQLAlchemy
- GeoAlchemy2
- Alembic

## Database

- PostgreSQL
- PostGIS

## Git

Main branch:
- Demoable / stable branch

Develop branch:
- Integration branch

Feature branch:
- feature/US-xx-short-name

## Commit

Use:

<type>(US-xx): <description>

Types:

- feat
- fix
- docs
- style
- refactor
- test
- chore

## GIS Coordinates

Database/API/GeoJSON:
- longitude, latitude

Leaflet:
- latitude, longitude

Coordinate conversion should be centralized.

## Security

- Never commit .env
- Never commit passwords or API keys
- Never commit OSM/OSRM data