"""Spatial computation for RideShift — Python + Shapely layer.

Per proposal Objective 3 the system classifies each route against every LEZ
zone as outside / partial / within. When PostGIS is available the zone
geometry is mirrored into the DB for DB-level queries (see app/db.py); the
authoritative computation here uses Shapely so the pipeline behaves
identically with or without PostGIS.
"""
import math
from typing import List, Literal, Sequence, Tuple

from shapely.geometry import LineString, Point, Polygon, shape

LatLng = Tuple[float, float]  # [lat, lng]

EARTH_RADIUS_KM = 6371.0


def to_rad(deg: float) -> float:
    return deg * math.pi / 180.0


def haversine_km(a: LatLng, b: LatLng) -> float:
    dlat = to_rad(b[0] - a[0])
    dlng = to_rad(b[1] - a[1])
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(to_rad(a[0])) * math.cos(to_rad(b[0])) * math.sin(dlng / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def route_length_km(coords: Sequence[LatLng]) -> float:
    total = 0.0
    for i in range(1, len(coords)):
        total += haversine_km(coords[i - 1], coords[i])
    return total


def sample_route_points(coords: Sequence[LatLng], n: int) -> List[LatLng]:
    """Sample n points evenly along a polyline (distance-parameterized)."""
    if not coords:
        return []
    if len(coords) == 1:
        return [tuple(coords[0])]  # type: ignore
    segments = [0.0]
    for i in range(1, len(coords)):
        segments.append(segments[i - 1] + haversine_km(coords[i - 1], coords[i]))
    total = segments[-1]
    if total == 0:
        return [tuple(coords[0])]  # type: ignore
    samples: List[LatLng] = []
    for s in range(n):
        target = (s / (n - 1)) * total
        seg = 1
        while seg < len(segments) - 1 and segments[seg] < target:
            seg += 1
        seg_start = segments[seg - 1]
        seg_len = segments[seg] - seg_start
        t = 0.0 if seg_len == 0 else (target - seg_start) / seg_len
        lat1, lng1 = coords[seg - 1]
        lat2, lng2 = coords[seg]
        samples.append((lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t))
    return samples


def polygon_from_pairs(pairs: Sequence[Sequence[float]]) -> Polygon:
    """Shapely polygon from [[lat, lng], ...] (lng/lat order for Shapely)."""
    ring = [(float(p[1]), float(p[0])) for p in pairs]
    return Polygon(ring)


def point_in_polygon(pt: LatLng, polygon_pairs: Sequence[Sequence[float]]) -> bool:
    return polygon_from_pairs(polygon_pairs).contains(Point(pt[1], pt[0]))


def nearest_distance_km(pt: LatLng, locations: Sequence[dict]) -> float:
    if not locations:
        return float("inf")
    return min(haversine_km(pt, (l["lat"], l["lng"])) for l in locations)


def analyze_route_vs_zones(
    route_coords: Sequence[LatLng],
    zones: Sequence[dict],  # {id, name, polygon: [[lat,lng],...]}
    sample_count: int = 200,
) -> List[dict]:
    """outside / partial / within per zone (Objective 3, Shapely-based)."""
    if len(route_coords) < 2:
        return []
    samples = sample_route_points(route_coords, sample_count)
    line = LineString([(p[1], p[0]) for p in samples])
    results = []
    for z in zones:
        poly = polygon_from_pairs(z["polygon"])
        # share of sampled route points inside the zone polygon
        inside = sum(1 for p in samples if poly.covers(Point(p[1], p[0])))
        ratio = (inside / len(samples)) if samples else 0.0
        status: Literal["outside", "partial", "within"] = (
            "outside" if ratio == 0 else ("within" if ratio >= 0.95 else "partial")
        )
        results.append(
            {"zoneId": z["id"], "name": z["name"], "insideRatio": ratio, "status": status}
        )
    return results
