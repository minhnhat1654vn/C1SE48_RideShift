"""GeoJSON helpers dùng chung cho dữ liệu vùng LEZ.

Chuẩn DB FINAL: `policy.lez_zones.geometry GEOMETRY(MULTIPOLYGON,4326)` là
cột RANH GIỚI CHÍNH THỨC; cột `coordinates` (JSON [[lat,lng],…]) chỉ là bản
mirror portable — sandbox không cài được PostGIS (không root) vẫn đọc/ghi
được, và mọi tạo/cập nhật vùng đều ghi cả hai (db.sync_zone_geometry).

Module cung cấp bộ chuyển đổi an toàn để:
  1. db.init_db() ensure cột geometry + đồng bộ 2 chiều geometry ↔ coordinates;
  2. các mapper/endpoint đọc ranh giới KHÔNG BAO GIỜ KeyError — ưu tiên
     geometry (GeoJSON / hex EWKB PostGIS), fallback coordinates.

Không phụ thuộc cứng shapely/PostGIS — mọi parse đều try/except, hỏng thì
trả None (shapely chỉ dùng lazy khi gặp hex EWKB của PostGIS).
"""
import json
import math
from typing import Any, Optional

Pairs = list  # [[lat, lng], ...]


def geojson_outer_ring_pairs(obj: Any) -> Optional[Pairs]:
    """GeoJSON Polygon/MultiPolygon (dict | chuỗi | Feature/FC) → ring ngoài
    lớn nhất dưới dạng [[lat,lng],…], hoặc None nếu không phân tích được."""
    if isinstance(obj, (bytes, bytearray)):
        try:
            obj = obj.decode("utf-8", "ignore")
        except Exception:
            return None
    if isinstance(obj, str):
        s = obj.strip()
        if not s or s[0] not in "{[":
            return None  # WKB hex / WKT — xử lý bằng ST_AsGeoJSON ở lớp trên
        try:
            obj = json.loads(s)
        except Exception:
            return None
    if not isinstance(obj, dict):
        return None

    t = obj.get("type")
    if t == "Feature" and isinstance(obj.get("geometry"), dict):
        return geojson_outer_ring_pairs(obj["geometry"])
    if t == "FeatureCollection":
        for f in obj.get("features") or []:
            pairs = geojson_outer_ring_pairs(f)
            if pairs:
                return pairs
        return None

    if t == "Polygon":
        polys = [obj.get("coordinates") or []]
    elif t == "MultiPolygon":
        polys = obj.get("coordinates") or []
    else:
        return None

    best: Optional[list] = None
    for poly in polys:
        if not poly:
            continue
        ring = poly[0] or []  # ring ngoài
        if best is None or len(ring) > len(best):
            best = ring
    if not best or len(best) < 3:
        return None

    out: Pairs = []
    for p in best:
        if not isinstance(p, (list, tuple)) or len(p) < 2:
            continue
        lng, lat = p[0], p[1]
        if not _num(lng) or not _num(lat):
            continue
        out.append([float(lat), float(lng)])
    if len(out) < 3:
        return None
    if len(out) > 1 and out[0] == out[-1]:
        out = out[:-1]  # bỏ điểm đóng ring — FE tự đóng khi vẽ
    return out


def _num(v: Any) -> bool:
    try:
        f = float(v)
        return not math.isnan(f) and not math.isinf(f)
    except (TypeError, ValueError):
        return False


def multipolygon_geojson_from_pairs(coords: Any) -> Optional[str]:
    """[[lat,lng],…] (chuỗi JSON hoặc list) → chuỗi GeoJSON MultiPolygon
    (ring đã đóng, tọa độ [lng,lat]) — đúng kiểu DB FINAL
    GEOMETRY(MULTIPOLYGON,4326). Trả None nếu không dựng được đa giác hợp lệ
    (cần ≥ 3 điểm)."""
    try:
        pts = json.loads(coords) if isinstance(coords, str) else coords
    except Exception:
        return None
    if not isinstance(pts, list) or len(pts) < 3:
        return None
    ring = []
    for p in pts:
        if not isinstance(p, (list, tuple)) or len(p) < 2:
            return None
        try:
            ring.append([float(p[1]), float(p[0])])  # GeoJSON: [lng, lat]
        except (TypeError, ValueError):
            return None
    ring.append(ring[0])  # đóng ring
    # MultiPolygon: coordinates = [polygon,…], polygon = [ring,…] → [[ring]]
    return json.dumps({"type": "MultiPolygon", "coordinates": [[ring]]})


def _pairs_from_geometry(geom: Any) -> Optional[Pairs]:
    """Giá trị cột `geometry` → ring [[lat,lng],…].

    Ba dạng có thể gặp:
      * GeoJSON (dict / chuỗi '{…}') — sandbox TEXT + volume cũ;
      * hex EWKB ('01060000…') — PostGIS SELECT *;
      * bytes GeoJSON.
    """
    if isinstance(geom, (bytes, bytearray)):
        try:
            geom = geom.decode("utf-8", "ignore")
        except Exception:
            return None
    if isinstance(geom, dict):
        return geojson_outer_ring_pairs(geom)
    if isinstance(geom, str):
        s = geom.strip()
        if not s:
            return None
        if s[0] in "{[":
            return geojson_outer_ring_pairs(s)
        if (
            len(s) >= 16
            and len(s) % 2 == 0
            and all(c in "0123456789abcdefABCDEF" for c in s)
        ):
            try:  # hex EWKB → GeoJSON dict qua shapely (lazy import)
                from shapely import wkb as _wkb
                from shapely.geometry import mapping as _mapping

                g = _wkb.loads(bytes.fromhex(s))
                if g.is_empty:
                    return None
                return geojson_outer_ring_pairs(_mapping(g))
            except Exception:
                return None
    return None


def zone_pairs_from_row(row: dict) -> Optional[Pairs]:
    """Dòng policy.lez_zones → ring [[lat,lng],…].

    Ưu tiên cột `geometry` — ranh giới chính thức theo DB FINAL
    (GEOMETRY(MULTIPOLYGON,4326) trên PostGIS; TEXT GeoJSON trên sandbox).
    Fallback `coordinates` — mirror JSON luôn được db._sync_lez_zone_geometry
    đồng bộ hai chiều lúc boot. None nếu thiếu cả hai."""
    if not isinstance(row, dict):
        return None
    geom = row.get("geometry")
    if geom:
        try:
            pairs = _pairs_from_geometry(geom)
            if pairs:
                return pairs
        except Exception:
            pass
    raw = row.get("coordinates")
    if raw:
        try:
            v = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(v, list) and len(v) >= 3 and all(
                isinstance(p, (list, tuple)) and len(p) >= 2 for p in v[:5]
            ):
                return v
            if isinstance(v, dict):
                pairs = geojson_outer_ring_pairs(v)
                if pairs:
                    return pairs
        except Exception:
            pass
    return None
