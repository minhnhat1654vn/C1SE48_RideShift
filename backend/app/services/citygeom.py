"""Ranh giới thành phố cho lọc geocode nghiêm ngặt (Task 73).

Vấn đề (phản hồi user 25/10/2026): tìm "Nguyễn Trãi" với city=hanoi từng
trả kết quả "Tỉnh Phú Thọ", tìm "Xóm Chùa" trả "Tỉnh Hưng Yên" — vì lọc cũ
chỉ dùng bbox DB (Hanoi [[20.5,105.2],[21.4,106.1]]) và chỉ XẾP HẠNG, không
LOẠI kết quả ngoài thành phố.

Giải pháp:
  - tools/build_city_outline.py union toàn bộ phường/xã của mỗi thành phố
    (data/cities/{city}.geojson) thành 1 outline (MultiPolygon đơn giản hoá
    60 m) ghi ra data/cities/{city}-outline.geojson.
  - Module này nạp outline 1 lần mỗi tiến trình (lru_cache), buffer thêm
    ~2 km (nhận địa chỉ ngay mép ranh giới), dùng shapely.prepared cho test
    point-in-polygon vi mô.
  - city_viewbox() dựng viewbox Nominatim từ bbox outline (+0.05°) — chặt
    hơn bbox DB nên Nominatim trả đúng ứng viên trong thành phố.

An toàn suy thoái: nếu file outline thiếu → has_outline() False → route giữ
hành vi cũ (không lọc polygon, viewbox từ bbox DB) — không bao giờ vỡ.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional, Tuple

from shapely.geometry import Point, shape
from shapely.ops import unary_union
from shapely.prepared import PreparedGeometry, prep

# file tại app/services/citygeom.py → root backend = parent.parent.parent
DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cities"
MARGIN_KM = 2.0  # đệm ngoài ranh giới — địa chỉ sát mép vẫn được nhận
PAD_DEG = 0.05  # nới viewbox Nominatim ~5.5 km mỗi phía

Outline = Tuple[PreparedGeometry, Tuple[float, float, float, float]]  # prep, (minLng, minLat, maxLng, maxLat)


@lru_cache(maxsize=8)
def _load_outline(city_id: str) -> Optional[Outline]:
    path = DATA_DIR / f"{city_id}-outline.geojson"
    if not path.exists():
        return None
    try:
        fc = json.loads(path.read_text(encoding="utf-8"))
        geoms = [shape(f["geometry"]) for f in fc.get("features", []) if f.get("geometry")]
        if not geoms:
            return None
        u = unary_union([g.buffer(0) for g in geoms])
        u = u.buffer(MARGIN_KM / 111.32)  # ~2 km đệm mép
        b = u.bounds  # (minLng, minLat, maxLng, maxLat)
        return prep(u), b
    except Exception:
        return None


def has_outline(city_id: str) -> bool:
    """True nếu có outline dữ liệu → route LỌC theo polygon. False → hành vi cũ."""
    return _load_outline(city_id) is not None


def city_contains(city_id: str, lat: float, lng: float) -> bool:
    """Điểm có nằm trong ranh giới thành phố (+đệm 2 km) không.

    Chỉ gọi khi has_outline(city_id) — nếu không có dữ liệu mặc định True
    (không loại gì) để route xử lý nhất quán.
    """
    o = _load_outline(city_id)
    if o is None:
        return True
    return o[0].contains(Point(lng, lat))


def city_viewbox(city_id: str, fallback_bbox=None) -> str:
    """Chuỗi viewbox Nominatim "w,n,e,s" (x1,y1,x2,y2) từ bbox outline.

    Fallback: outline thiếu → dùng bbox DB của City (định dạng như trước).
    """
    o = _load_outline(city_id)
    if o is not None:
        _p, (w, s, e, n) = o
        return f"{w - PAD_DEG:.3f},{n + PAD_DEG:.3f},{e + PAD_DEG:.3f},{s - PAD_DEG:.3f}"
    if fallback_bbox:
        (s_lat, w_lng), (n_lat, e_lng) = fallback_bbox
        return f"{w_lng:.2f},{n_lat:.2f},{e_lng:.2f},{s_lat:.2f}"
    return "105.60,21.18,106.05,20.70"  # Hanoi mặc định của chuỗi geocode cũ
