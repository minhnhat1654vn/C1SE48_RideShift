"""GeoJSON helpers shared by the seed/admin/trip code (stdlib json only).

Per DB FINAL the database stores shapes as real PostGIS `geometry` columns;
the canonical wire format between backend and frontend stays GeoJSON. These
helpers convert between the GeoJSON strings exchanged with the database/API
and the [[lat, lng], …] pair lists the frontend has always used for LEZ
polygons (Leaflet) and route sampling.
"""
import json
from typing import Any, List, Optional, Sequence


def point_geojson(lat: float, lng: float) -> str:
    """GeoJSON Point text from a [lat, lng] pair (GeoJSON order = [lng, lat])."""
    return json.dumps({"type": "Point", "coordinates": [float(lng), float(lat)]})


def linestring_geojson(coords: Sequence[Sequence[float]]) -> str:
    """GeoJSON LineString text from [[lat, lng], …] route samples."""
    return json.dumps(
        {"type": "LineString", "coordinates": [[c[1], c[0]] for c in coords]}
    )


def polygon_geojson_from_pairs(pairs: Sequence[Sequence[float]]) -> str:
    """Closed GeoJSON Polygon text from [[lat, lng], …] ring points."""
    ring = [[float(p[1]), float(p[0])] for p in pairs]
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0])
    return json.dumps({"type": "Polygon", "coordinates": [ring]})


def geojson_to_pairs(gj_text: Optional[str]) -> List[List[float]]:
    """GeoJSON text (Polygon | MultiPolygon) → outer ring as [[lat, lng], …].

    The returned ring does NOT repeat the closing point (same shape the
    frontend has always received in `zone.coordinates`).
    """
    try:
        gj: Any = json.loads(gj_text) if isinstance(gj_text, str) else None
        if not isinstance(gj, dict):
            return []
        gtype = gj.get("type")
        if gtype == "Polygon":
            ring = gj["coordinates"][0]
        elif gtype == "MultiPolygon":
            ring = gj["coordinates"][0][0]
        else:
            return []
        pairs = [[float(c[1]), float(c[0])] for c in ring]
        if len(pairs) > 1 and pairs[0] == pairs[-1]:
            pairs = pairs[:-1]
        return pairs
    except Exception:
        return []
