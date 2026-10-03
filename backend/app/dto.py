"""Row → DTO mappers (camelCase JSON contract shared with the frontend)."""
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional


def iso_z(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def mode_dto(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": r["id"],
        "name": r["name"],
        "description": r["description"],
        "icon": r["icon"],
        "avgSpeedKmh": r["avg_speed_kmh"],
        "baseCostVnd": r["base_cost_vnd"],
        "costPerKmVnd": r["cost_per_km_vnd"],
        "co2PerKmG": r["co2_per_km_g"],
        "baseAccessibility": r["base_accessibility"],
        "baseConvenience": r["base_convenience"],
        "waitMinutes": r["wait_minutes"],
        "enabled": r["enabled"],
        "sortOrder": r["sort_order"],
    }


def zone_dto(r: Dict[str, Any], parsed_coordinates: bool = False) -> Dict[str, Any]:
    coords = r["coordinates"]
    if parsed_coordinates:
        try:
            coords = json.loads(coords)
        except Exception:
            coords = []
    return {
        "id": r["id"],
        "name": r["name"],
        "description": r["description"],
        "coordinates": coords,
        "active": r["active"],
        "createdAt": iso_z(r.get("created_at")),
        "updatedAt": iso_z(r.get("updated_at")),
    }


def location_dto(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": r["id"],
        "name": r["name"],
        "type": r["type"],
        "lat": r["lat"],
        "lng": r["lng"],
        "active": r["active"],
    }


def rule_dto(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": r["id"],
        "zoneId": r["zone_id"],
        "modeId": r["mode_id"],
        "restrictionType": r["restriction_type"],
        "condition": r["condition"],
        "startTime": r["start_time"],
        "endTime": r["end_time"],
        "days": r["days"],
        "active": r["active"],
    }


def trip_dto(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": r["id"],
        "originName": r["origin_name"],
        "destName": r["dest_name"],
        "originDistrict": r["origin_district"],
        "originLat": r["origin_lat"],
        "originLng": r["origin_lng"],
        "destLat": r["dest_lat"],
        "destLng": r["dest_lng"],
        "distanceKm": r["distance_km"],
        "durationMin": r["duration_min"],
        "vehicleId": r["vehicle_id"],
        "purpose": r["purpose"],
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
        "id": r["id"],
        "criterion": r["criterion"],
        "weight": r["weight"],
        "label": r["label"],
    }
