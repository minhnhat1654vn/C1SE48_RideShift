"""Row → DTO mappers (camelCase JSON contract shared with the frontend).

The database layout follows the "DB FINAL" document (BIGSERIAL ids, plural
table names); these mappers keep the exact JSON shapes the frontend has
always consumed, e.g. transportation_modes.code is exposed as `id`.
"""
import json
from datetime import datetime, time, timezone
from typing import Any, Dict, Optional

from .geojson import geojson_to_pairs


def iso_z(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _hhmm(t) -> str:
    """TIME column → 'HH:MM' (the wire format the frontend expects)."""
    if isinstance(t, time):
        return t.strftime("%H:%M")
    if isinstance(t, datetime):
        return t.strftime("%H:%M")
    return str(t or "00:00")[:5]


def mode_dto(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": r["code"],
        "name": r["name"],
        "description": r["description"],
        "icon": r["icon"],
        "avgSpeedKmh": float(r["avg_speed_kmh"]),
        "baseCostVnd": float(r["base_fare"]),
        "costPerKmVnd": float(r["cost_per_km"]),
        "co2PerKmG": float(r["co2_per_km_g"]),
        "baseAccessibility": float(r["accessibility_score"]),
        "baseConvenience": float(r["convenience_score"]),
        "waitMinutes": float(r["avg_wait_min"]),
        "enabled": r["is_active"],
        "sortOrder": r["sort_order"],
    }


def zone_dto(r: Dict[str, Any], parsed_coordinates: bool = False) -> Dict[str, Any]:
    """policy.lez_zones row → API shape.

    The DB stores the boundary as geometry(MultiPolygon,4326); rows are
    selected with db.geom_read('geometry', 'geometry_json') so the mapper
    receives GeoJSON text and derives the historical [[lat, lng], …]
    `coordinates` contract for the frontend:
      * parsed_coordinates=False → coordinates as a JSON STRING (admin list,
        the historical raw-string contract)
      * parsed_coordinates=True  → coordinates as a pair LIST (public map)
    """
    pairs = geojson_to_pairs(r.get("geometry_json"))
    coords = pairs if parsed_coordinates else json.dumps(pairs)
    return {
        "id": r["lez_zone_id"],
        "name": r["name"],
        "description": r["description"],
        "coordinates": coords,
        "active": r["status"] == "active",
        "createdAt": iso_z(r.get("created_at")),
        "updatedAt": iso_z(r.get("updated_at")),
    }


def location_dto(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": r["transportation_location_id"],
        "name": r["name"],
        "type": r["location_type"],
        "lat": float(r["lat"]),
        "lng": float(r["lng"]),
        "active": r["status"] == "active",
    }


def rule_dto(r: Dict[str, Any]) -> Dict[str, Any]:
    """Joined row: lez_rules + vehicle_restrictions + vehicle_types + modes."""
    status = r.get("status") or "active"
    return {
        "id": r["lez_rule_id"],
        "zoneId": r["lez_zone_id"],
        "modeId": r["mode_code"],
        "modeName": r.get("mode_name"),
        "restrictionType": r["restriction_type"],
        "condition": r.get("condition"),
        "startTime": _hhmm(r["start_time"]),
        "endTime": _hhmm(r["end_time"]),
        "days": r["days_of_week"],
        "active": status == "active",
    }


def trip_dto(r: Dict[str, Any]) -> Dict[str, Any]:
    """Analytics row from trip.trips joined with vehicle/mode code aliases
    (vehicle_id / top_mode_id / chosen_mode_id carry the mode CODE strings,
    matching the historical frontend contract)."""
    return {
        "id": r["trip_id"],
        "originName": r["origin_name"],
        "destName": r["destination_name"],
        "originDistrict": r["origin_district"],
        "originLat": r["origin_lat"],
        "originLng": r["origin_lng"],
        "destLat": r["dest_lat"],
        "destLng": r["dest_lng"],
        "distanceKm": r["distance_km"],
        "durationMin": r["duration_min"],
        "vehicleId": r["vehicle_id"],
        "purpose": r["trip_purpose"],
        "departureHour": r["departure_hour"],
        "lezAffected": r["lez_affected"],
        "topModeId": r["top_mode_id"],
        "topScore": r["top_score"],
        "avgCostVnd": r["avg_cost_vnd"],
        "avgTimeMin": r["avg_time_min"],
        "chosenModeId": r["chosen_mode_id"],
        "switched": r["switched"],
        "createdAt": iso_z(r.get("created_at")),
    }


def weight_dto(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": r["criteria_id"],
        "criterion": r["code"],
        "weight": float(r["default_weight"]),
        "label": r["name"],
    }
