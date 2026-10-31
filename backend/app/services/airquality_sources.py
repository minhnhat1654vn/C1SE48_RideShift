"""Nguồn trạm đo chất lượng không khí THẬT (Task 63 — US-08 nâng cấp nguồn thật).

Chuỗi nguồn (merge + failover, mọi giá trị gắn nguồn minh bạch):
  A) moitruongthudo.vn/api/site — trạm tự động chính thức của Chi cục BVMT
     Hà Nội (Sở NN&MT) — JSON mở, không cần token, chỉ có Hà Nội.
  B) api.waqi.info/map/bounds — WAQI (token) — US Embassy, UNIS + mirror trạm
     Sở; map/bounds trả rỗng thì fallback feed/geo tại tâm thành phố.
  B') api.waqi.info/search (Task 99) — WAQI search trả CẢ các trạm đã ngừng
     gửi số liệu (mirror mạng 35 trạm Hà Nội, AQI='-') mà map/bounds bỏ
     thiếu → gộp vào để hiển thị marker xám "AQI không khả dụng".
  C) (mô hình — tách ở services/airquality.py) Open-Meteo CAMS.

Task 99 — chi tiết trạm kiểu PAM Air (GET /api/airquality/stations/{id}):
lịch sử 24h 2 tầng: 1) /api/hourlyaqi/{id} của Sở khi có dữ liệu (hiện []
— mạng 35 trạm ngừng 12/2025, tự khôi phục khi Sở mở lại); 2) fallback mô
hình CAMS (Open-Meteo) tại đúng vị trí trạm (user 28/10 tối: cứ lấy CAMS
cho đủ 24 cột — UI không hiển thị chú thích nguồn).
Trạm tạm ngừng (xám): KHÔNG có lịch sử / min-max — "đã không hoạt động
rồi thì lấy đâu ra thông tin AQI" (user 28/10 chiều).

Quy tắc "không bịa số" (US-19): chỉ nhận trạm có AQI số học; cache-first
30 phút trong decision.air_quality_observations; không bịa khi nguồn chết.
"""
import json
import math
import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import httpx

from .. import config, db

WAQI_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126 Safari/537.36"
    ),
    "Accept": "application/json, */*",
}

# WAQI query bbox bị giới hạn quanh tâm (loại đảo xa như Côn Đảo/Hoàng Sa)
MAX_SPAN_DEG = 1.1

CITY_ALIASES = {
    "hanoi": ["hanoi"],
    "danang": ["da nang", "danang"],
    "hcm": ["ho chi minh", "hcmc", "saigon", "sai gon"],
}


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(a))


def source_label(source: str) -> str:
    if source == "moitruongthudo":
        return "Trạm quan trắc Sở NN&MT Hà Nội (moitruongthudo.vn)"
    return "WAQI — World Air Quality Index (aqicn.org)"


# ---------------------------------------------------------------------------
# Thành phố (bảng public."City" — seed bằng Prisma từ geojson "phường xã - 34")
# ---------------------------------------------------------------------------

def list_cities() -> List[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT c.id, c.name, c."centerLat" AS center_lat, c."centerLng" AS center_lng,
                   c."defaultZoom" AS default_zoom, c.bbox,
                   (SELECT COUNT(*) FROM gis.administrative_regions r
                     WHERE r.study_area_id = c."studyAreaId"
                       AND r.region_type IN ('Phường','Xã','Đặc khu')) AS ward_count
            FROM "City" c
            WHERE c.active = TRUE
            ORDER BY c."sortOrder" ASC
            """
        ).fetchall()
    out = []
    for r in rows:
        try:
            bbox = json.loads(r["bbox"])
        except Exception:
            bbox = [[20.5, 105.2], [21.4, 106.1]]
        out.append(
            {
                "id": r["id"],
                "name": r["name"],
                "centerLat": float(r["center_lat"]),
                "centerLng": float(r["center_lng"]),
                "defaultZoom": int(r["default_zoom"]),
                "bbox": bbox,
                "wardCount": int(r["ward_count"]),
            }
        )
    return out


def get_city(city_id: str) -> Optional[dict]:
    for c in list_cities():
        if c["id"] == city_id:
            return c
    return None


# ---------------------------------------------------------------------------
# Nguồn A — moitruongthudo.vn
# ---------------------------------------------------------------------------

def fetch_moitruongthudo() -> List[dict]:
    try:
        resp = httpx.get(
            config.MOITRUONGTHUDO_SITE_URL,
            timeout=9.0,
            headers=WAQI_HEADERS,
        )
        data = resp.json()
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    out = []
    for s in data:
        try:
            lat = float(s.get("latitude"))
            lng = float(s.get("longtitude"))  # typo gốc của API — giữ đúng tên
        except (TypeError, ValueError):
            continue
        if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
            continue
        # Trạm không có AQI số học vẫn hiển thị (màu xám — "tạm ngừng cập
        # nhật") nhưng KHÔNG đóng góp vào lớp AQI (US-19: không bịa số).
        try:
            aqi = float(s.get("aqi"))
            available = aqi > 0
        except (TypeError, ValueError):
            aqi = None
            available = False
        out.append(
            {
                "id": f"mtd:{s.get('id')}",
                "name": (s.get("name") or f"Trạm Sở #{s.get('id')}").strip(),
                "lat": lat,
                "lng": lng,
                "aqi": round(aqi) if available else None,
                "available": available,
                "source": "moitruongthudo",
                "sourceLabel": source_label("moitruongthudo"),
                "measuredAt": (s.get("aqi_time") or "").strip()
                or datetime.now(timezone.utc).isoformat(),
                # Task 99 — panel chi tiết trạm (kiểu PAM Air)
                "address": (s.get("address") or "").strip() or None,
                "url": f"https://moitruongthudo.vn/public?site_id={s.get('id')}",
            }
        )
    return out


# ---------------------------------------------------------------------------
# Nguồn B — WAQI
# ---------------------------------------------------------------------------

def _waqi_bounds(city: dict) -> List[dict]:
    if not config.WAQI_TOKEN:
        return []
    (s, w), (n, e) = city["bbox"]
    lat1 = max(float(s), city["centerLat"] - MAX_SPAN_DEG / 2)
    lat2 = min(float(n), city["centerLat"] + MAX_SPAN_DEG / 2)
    lng1 = max(float(w), city["centerLng"] - MAX_SPAN_DEG / 2)
    lng2 = min(float(e), city["centerLng"] + MAX_SPAN_DEG / 2)
    try:
        resp = httpx.get(
            config.WAQI_BOUNDS_URL,
            params={
                "token": config.WAQI_TOKEN,
                "latlng": f"{lat1:.3f},{lng1:.3f},{lat2:.3f},{lng2:.3f}",
            },
            timeout=9.0,
            headers=WAQI_HEADERS,
        )
        data = resp.json()
    except Exception:
        return []
    if not isinstance(data, dict) or data.get("status") != "ok" or not isinstance(data.get("data"), list):
        return []
    out = []
    for st in data["data"]:
        try:
            lat = float(st.get("lat"))
            lng = float(st.get("lon"))
        except (TypeError, ValueError):
            continue
        if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
            continue
        station = st.get("station") or {}
        # AQI '-' (trạm không gửi số liệu) → vẫn trả về để hiển thị màu xám
        # "tạm ngừng", KHÔNG tham gia nội suy/lớp AQI (US-19).
        try:
            aqi = float(st.get("aqi"))
            available = aqi > 0
        except (TypeError, ValueError):
            aqi = None
            available = False
        out.append(
            {
                "id": f"waqi:{st.get('uid')}",
                "name": (station.get("name") or f"Trạm WAQI #{st.get('uid')}").strip(),
                "lat": lat,
                "lng": lng,
                "aqi": round(aqi) if available else None,
                "available": available,
                "source": "waqi",
                "sourceLabel": source_label("waqi"),
                "measuredAt": (station.get("time") or "").strip()
                or datetime.now(timezone.utc).isoformat(),
            }
        )
    return out


def _waqi_search(city: dict) -> List[dict]:
    """Task 99 — api.waqi.info/search/{alias}: WAQI trả về cả các trạm đã
    NGỪNG gửi số liệu (mirror mạng 35 trạm Hà Nội, toàn bộ AQI='-') mà
    map/bounds KHÔNG trả về. Đây là nguồn để hiển thị marker xám "AQI không
    khả dụng" theo yêu cầu user 28/10 ("lấy các trạm WAQI không hiển thị
    AQI → màu xám, không đóng góp vào lớp AQI"). Trạm có số liệu từ search
    cũng được gộp (bổ trợ cho bounds)."""
    if not config.WAQI_TOKEN:
        return []
    out: List[dict] = []
    seen: set = set()
    # alias đầu của mỗi thành phố là đủ (search của WAQI match rất rộng)
    for kw in CITY_ALIASES.get(city["id"], [])[:1]:
        try:
            resp = httpx.get(
                config.WAQI_SEARCH_URL,
                params={"keyword": kw, "token": config.WAQI_TOKEN},
                timeout=9.0,
                headers=WAQI_HEADERS,
            )
            data = resp.json()
        except Exception:
            continue
        if not isinstance(data, dict) or data.get("status") != "ok" or not isinstance(data.get("data"), list):
            continue
        for s in data["data"]:
            uid = s.get("uid")
            if uid is None or uid in seen:
                continue
            station = s.get("station") or {}
            geo = station.get("geo") or []
            if len(geo) < 2:
                continue
            try:
                lat, lng = float(geo[0]), float(geo[1])
            except (TypeError, ValueError):
                continue
            if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
                continue
            seen.add(uid)
            try:
                aqi = float(s.get("aqi"))
                available = aqi > 0
            except (TypeError, ValueError):
                aqi = None
                available = False
            time_obj = s.get("time") or {}
            out.append(
                {
                    "id": f"waqi:{uid}",
                    "name": (station.get("name") or f"Trạm WAQI #{uid}").strip(),
                    "lat": lat,
                    "lng": lng,
                    "aqi": round(aqi) if available else None,
                    "available": available,
                    "source": "waqi",
                    "sourceLabel": source_label("waqi"),
                    "measuredAt": (time_obj.get("stime") or "").strip()
                    or datetime.now(timezone.utc).isoformat(),
                    "url": f"https://aqicn.org/{station['url']}" if station.get("url") else None,
                }
            )
    return out


def _waqi_center_fallback(city: dict) -> List[dict]:
    """map/bounds thỉnh thoảng trả rỗng dù thành phố có trạm sống (xác minh
    22/10: Đà Nẵng) → thử feed/geo tại tâm; chỉ nhận nếu trạm ≤ 50 km."""
    if not config.WAQI_TOKEN:
        return []
    url = config.WAQI_FEED_GEO_URL.format(lat=city["centerLat"], lng=city["centerLng"])
    try:
        resp = httpx.get(url, params={"token": config.WAQI_TOKEN}, timeout=9.0, headers=WAQI_HEADERS)
        data = resp.json()
    except Exception:
        return []
    if not isinstance(data, dict) or data.get("status") != "ok" or not isinstance(data.get("data"), dict):
        return []
    payload = data["data"]
    try:
        aqi = float(payload.get("aqi"))
    except (TypeError, ValueError):
        return []
    geo = ((payload.get("city") or {}).get("geo")) or []
    if aqi <= 0 or len(geo) < 2:
        return []
    lat, lng = float(geo[0]), float(geo[1])
    if haversine_km(city["centerLat"], city["centerLng"], lat, lng) > config.STATION_RADIUS_KM:
        return []  # trạm khác tỉnh — bỏ
    time_iso = ((payload.get("time") or {}).get("iso")) or datetime.now(timezone.utc).isoformat()
    return [
        {
            "id": f"waqi:center:{city['id']}",
            "name": ((payload.get("city") or {}).get("name") or f"Trạm gần {city['name']}").strip(),
            "lat": lat,
            "lng": lng,
            "aqi": round(aqi),
            "source": "waqi",
            "sourceLabel": source_label("waqi"),
            "measuredAt": time_iso,
        }
    ]


def fetch_waqi(city: dict) -> List[dict]:
    """map/bounds ∪ search: bounds cho trạm đang hoạt động, search bổ sung
    các trạm đã ngừng (hiển thị xám). Trùng uid → giữ bản còn số liệu, thừa
    nhận url khi bản kia thiếu. Cả hai nguồn chết → fallback feed/geo."""
    bounds = _waqi_bounds(city)
    search = _waqi_search(city)
    if not bounds and not search:
        return _waqi_center_fallback(city)
    by_id = {s["id"]: s for s in bounds}
    for s in search:
        cur = by_id.get(s["id"])
        if cur is None:
            by_id[s["id"]] = s
        elif not cur.get("available") and s.get("available"):
            by_id[s["id"]] = s
        elif not cur.get("url") and s.get("url"):
            cur["url"] = s["url"]
    return list(by_id.values())


# ---------------------------------------------------------------------------
# Orchestrator cache-first (decision.air_quality_observations, 30 phút)
# ---------------------------------------------------------------------------

def _dedupe(stations: List[dict]) -> List[dict]:
    """Khử trùng theo vị trí (<0.9km): trạm Sở NN&MT giữ nguyên; trạm WAQI
    trùng vị trí bị bỏ. Trạm CÒN số liệu (available) được ưu tiên giữ so với
    trạm đã ngừng cập nhật khi hai trạm trùng nhau."""
    mtd = [s for s in stations if s["source"] == "moitruongthudo"]
    others = sorted(
        [s for s in stations if s["source"] != "moitruongthudo"],
        key=lambda s: 0 if s.get("available", s.get("aqi") is not None) else 1,
    )
    out = list(mtd)
    for o in others:
        if any(haversine_km(o["lat"], o["lng"], k["lat"], k["lng"]) < 0.9 for k in out):
            continue
        out.append(o)
    return out


def _aggregate_name_filter(city_id: str) -> "re.Pattern":
    """Chỉ match feed TỔNG HỢP "tên thành phố, Vietnam (…)" của WAQI (không
    phải trạm vật lý). Lưu ý phải có dấu phẩy ngay sau alias — nếu không,
    "Hanoi US Embassy, Vietnam (…)" (trạm thật của ĐSQ Mỹ) sẽ bị lọc nhầm
    (bug bắt được 28/10 khi thêm lớp trạm xám)."""
    aliases = CITY_ALIASES.get(city_id, [])
    return re.compile(
        r"^(" + "|".join(aliases) + r"), Vietnam \(", re.IGNORECASE
    ) if aliases else None


def get_stations_for_city(city_id: str) -> dict:
    now = datetime.now(timezone.utc)
    cache_key = f"stations:{city_id}"
    # Phản hồi user 21/10: AQI chỉ mở cho Hà Nội — Đà Nẵng/TP.HCM được thêm
    # để demo tính scalability của DB/API, không gắn nguồn AQI thật.
    if city_id != "hanoi":
        return _stations_payload(
            [],
            now,
            {"moitruongthudo": {"ok": False, "count": 0}, "waqi": {"ok": False, "count": 0, "configured": bool(config.WAQI_TOKEN)}},
            notice="Lớp AQI hiện chỉ khả dụng cho Hà Nội (Đà Nẵng/TP.HCM chỉ demo tính scalability).",
        )
    city = get_city(city_id)
    if not city:
        return _stations_payload([], now, {}, notice="Không tìm thấy thành phố.")

    # 1) cache tươi
    with db.get_conn() as conn:
        cached = conn.execute(
            "SELECT raw_data, observed_at FROM decision.air_quality_observations WHERE cache_key = %s",
            (cache_key,),
        ).fetchone()
    if cached and (now - cached["observed_at"]) < timedelta(seconds=config.STATIONS_CACHE_TTL_SECONDS):
        try:
            payload = json.loads(cached["raw_data"])
            if isinstance(payload, dict) and "stations" in payload:
                payload["fetchedAt"] = cached["observed_at"].isoformat()
                return payload
        except Exception:
            pass  # cache hỏng → fetch lại

    # 2) fetch thật
    mtd = fetch_moitruongthudo() if city_id == "hanoi" else []
    waqi = fetch_waqi(city)
    in_radius = _dedupe(mtd + waqi)
    in_radius = [
        s
        for s in in_radius
        if haversine_km(city["centerLat"], city["centerLng"], s["lat"], s["lng"])
        <= config.STATION_RADIUS_KM
    ]
    # feed "trung bình thành phố" của WAQI không phải trạm vật lý — chỉ giữ
    # khi nó là dữ liệu duy nhất có (VD Đà Nẵng)
    pattern = _aggregate_name_filter(city_id)
    physical = [s for s in in_radius if not (pattern and pattern.match(s["name"]))]
    stations = physical if physical else in_radius
    available_now = [s for s in stations if s.get("available", s.get("aqi") is not None)]
    sources = {
        "moitruongthudo": {
            "ok": len(mtd) > 0,
            "count": len(mtd),
            "available": len([s for s in mtd if s.get("available", s.get("aqi") is not None)]),
        },
        "waqi": {
            "ok": len(waqi) > 0,
            "count": len(waqi),
            "available": len([s for s in waqi if s.get("available", s.get("aqi") is not None)]),
            "configured": bool(config.WAQI_TOKEN),
        },
    }
    notice = None
    if not available_now:
        notice = (
            "Không lấy được trạm đo còn số liệu lúc này (nguồn Sở/WAQI không phản hồi "
            "hoặc các trạm tạm ngừng cập nhật). Bản đồ sẽ dùng mô hình nền Open-Meteo."
        )
        if stations:
            notice = (
                f"Tất cả {len(stations)} trạm đều tạm ngừng cập nhật số liệu — "
                "bản đồ sẽ dùng mô hình nền Open-Meteo."
            )
    payload = _stations_payload(stations, now, sources, notice=notice)

    with db.get_conn() as conn:
        study = db.study_area_id(conn)
        conn.execute(
            """
            INSERT INTO decision.air_quality_observations
                (cache_key, study_area_id, source, lat, lng, location, observed_at, raw_data)
            VALUES (%s, %s, 'stations', %s, %s, %s, %s, %s)
            ON CONFLICT (cache_key) DO UPDATE
            SET raw_data = EXCLUDED.raw_data, observed_at = EXCLUDED.observed_at
            """,
            (
                cache_key, study, city["centerLat"], city["centerLng"],
                json.dumps({"type": "Point", "coordinates": [city["centerLng"], city["centerLat"]]}),
                now, json.dumps(payload, ensure_ascii=False),
            ),
        )
    return payload


def _stations_payload(stations: List[dict], now, sources: dict, notice: Optional[str] = None) -> dict:
    payload = {
        "stations": stations,
        "fetchedAt": now.isoformat(),
        "sources": sources,
    }
    if notice:
        payload["notice"] = notice
    return payload


def nearest_stations(lat: float, lng: float, radius_km: float, limit: int = 4) -> List[dict]:
    """Trạm gần một điểm: chọn gói trạm của thành phố gần nhất rồi lọc bán kính.
    CHỈ trả trạm còn số liệu (available) — trạm xám không đóng góp vào lớp
    AQI / nội suy IDW (yêu cầu user 28/10)."""
    cities = list_cities()
    if not cities:
        return []
    best = min(
        cities,
        key=lambda c: haversine_km(lat, lng, c["centerLat"], c["centerLng"]),
    )
    if haversine_km(lat, lng, best["centerLat"], best["centerLng"]) > 180:
        return []
    stations = get_stations_for_city(best["id"]).get("stations", [])
    stations = [
        s for s in stations if s.get("available", s.get("aqi") is not None)
    ]
    ranked = sorted(
        stations, key=lambda s: haversine_km(lat, lng, s["lat"], s["lng"])
    )
    return [s for s in ranked if haversine_km(lat, lng, s["lat"], s["lng"]) <= radius_km][:limit]


# ---------------------------------------------------------------------------
# Task 99 — Chi tiết trạm + lịch sử AQI 24h (panel kiểu PAM Air)
# ---------------------------------------------------------------------------

# Bảng khoảng PM2.5 chuỗi 1 GIỜ → VN AQI, Phụ lục VI Thông tư
# 17/2023/TT-BTNMT (khớp TT 10/2021): C ≤ 35 → 0–50; 35–55 → 50–100;
# 55–75 → 100–150; 75–250 → 150–200; 250–350 → 200–300; 350–500 → 300–500.
_VN_AQI_PM25_1H = [
    (0.0, 35.0, 0.0, 50.0),
    (35.0, 55.0, 50.0, 100.0),
    (55.0, 75.0, 100.0, 150.0),
    (75.0, 250.0, 150.0, 200.0),
    (250.0, 350.0, 200.0, 300.0),
    (350.0, 500.0, 300.0, 500.0),
]


def vn_aqi_from_pm25_1h(c) -> Optional[int]:
    """VN AQI nội suy tuyến tính từ nồng độ PM2.5 (µg/m³, chuỗi 1 giờ)."""
    if c is None:
        return None
    try:
        c = float(c)
    except (TypeError, ValueError):
        return None
    if c < 0:
        return None
    for lo_c, hi_c, lo_i, hi_i in _VN_AQI_PM25_1H:
        if c <= hi_c:
            return round(lo_i + (c - lo_c) * (hi_i - lo_i) / (hi_c - lo_c))
    return 500  # trên 500 µg/m³ → trần thang VN AQI


def _fetch_mtd_hourly(site_id: str) -> List[dict]:
    """Lịch sử AQI theo giờ của trạm Sở NN&MT — đúng endpoint portal của họ
    dùng cho biểu đồ "Lịch sử AQI" (/api/hourlyaqi/{id}, khám phá Task 99).
    Hiện tại trả [] với mọi trạm (mạng 35 trạm cũ ngừng 12/2025) — khi Sở
    khôi phục thì panel tự động chuyển sang số đo thật."""
    try:
        resp = httpx.get(
            config.MOITRUONGTHUDO_HOURLY_URL.format(site_id=site_id),
            timeout=9.0,
            headers=WAQI_HEADERS,
        )
        data = resp.json()
    except Exception:
        return []
    if not isinstance(data, list) or not data:
        return []
    out: List[dict] = []
    for h in data:
        if not isinstance(h, dict):
            continue
        try:
            aqi = int(float(h.get("value")))
        except (TypeError, ValueError):
            continue
        if aqi <= 0:
            continue
        out.append(
            {
                "time": str(h.get("time") or h.get("short_label") or "").strip(),
                "aqi": aqi,
            }
        )
    return out[-24:]


def _fetch_cams_history(lat: float, lng: float, source: str) -> Optional[dict]:
    """Lịch sử 24h từ mô hình CAMS (Open-Meteo) tại ĐÚNG vị trí trạm.

    Trạm Sở (moitruongthudo): quy đổi PM2.5 → VN AQI (TT 17/2023) để cùng
    thang với số đo hiện tại của trạm. Trạm WAQI: dùng US AQI của CAMS để
    cùng thang với số liệu WAQI (aqicn.org báo US EPA AQI)."""
    url = (
        f"{config.OPEN_METEO_AQ_URL}?latitude={lat:.4f}&longitude={lng:.4f}"
        "&hourly=pm2_5,us_aqi&past_days=2&forecast_days=0&timezone=Asia%2FBangkok"
    )
    try:
        resp = httpx.get(url, timeout=9.0, headers=WAQI_HEADERS)
        hourly = (resp.json() or {}).get("hourly") or {}
    except Exception:
        return None
    times = hourly.get("time") or []
    pm25 = hourly.get("pm2_5") or []
    us_aqi = hourly.get("us_aqi") or []
    if not times:
        return None
    points: List[dict] = []
    for i, t in enumerate(times):
        if i >= len(pm25) and i >= len(us_aqi):
            break
        if source == "moitruongthudo":
            aqi = vn_aqi_from_pm25_1h(pm25[i]) if i < len(pm25) else None
        else:
            try:
                aqi = round(float(us_aqi[i])) if i < len(us_aqi) else None
                if aqi is not None and aqi <= 0:
                    aqi = None
            except (TypeError, ValueError):
                aqi = None
        if aqi is None:
            continue
        points.append({"time": str(t), "aqi": aqi})
    if len(points) < 6:  # quá thưa — coi như không có lịch sử
        return None
    return {"points": points[-24:], "scale": "vn" if source == "moitruongthudo" else "us"}


def get_station_detail(city_id: str, station_id: str) -> Optional[dict]:
    """Chi tiết 1 trạm + lịch sử AQI 24h (min/max) — phục vụ panel click trạm.

    Lịch sử 2 tầng: 1) /api/hourlyaqi của Sở (khi họ có dữ liệu);
    2) fallback mô hình CAMS tại vị trí trạm (user 28/10 tối: lấy CAMS cho
    đủ 24 cột, UI không hiển thị chú thích nguồn).
    Trạm tạm ngừng: KHÔNG có lịch sử / min-max — chỉ thông tin cơ bản.
    Cache 30 phút trong decision.air_quality_observations (phiên bản v3)
    — KHÔNG thêm bảng mới (ràng buộc user 28/10: không đổi cấu trúc DB)."""
    payload = get_stations_for_city(city_id)
    station = next(
        (s for s in payload.get("stations", []) if s.get("id") == station_id), None
    )
    if station is None:
        return None

    now = datetime.now(timezone.utc)
    available = bool(station.get("available", station.get("aqi") is not None))

    # Trạm tạm ngừng — không có gì để báo cáo ngoài thông tin cơ bản
    if not available:
        return {
            "station": station,
            "history": None,
            "lowest": None,
            "highest": None,
            "historySource": None,
            "aqiScale": "vn" if station.get("source") == "moitruongthudo" else "us",
            "available": False,
            "fetchedAt": now.isoformat(),
        }

    cache_key = f"hist:{station_id}"[:20]  # varchar(20) — key Task 99 cũ 22-28 ký tự chưa bao giờ ghi được
    with db.get_conn() as conn:
        cached = conn.execute(
            "SELECT raw_data, observed_at FROM decision.air_quality_observations WHERE cache_key = %s",
            (cache_key,),
        ).fetchone()
    if cached and (now - cached["observed_at"]) < timedelta(seconds=config.STATIONS_CACHE_TTL_SECONDS):
        try:
            detail = json.loads(cached["raw_data"])
            if (
                isinstance(detail, dict)
                and detail.get("v") == 3  # v3 = CAMS trở lại; bỏ qua cache v2 tích luỹ 1 điểm
                and detail.get("history") is not None
            ):
                # cập nhật trạng thái hiện tại của trạm (AQI đổi mỗi 30 phút)
                detail["station"] = station
                detail["fetchedAt"] = cached["observed_at"].isoformat()
                return detail
        except Exception:
            pass  # cache hỏng → tính lại

    history: List[dict] = []
    history_source: Optional[str] = None
    history_scale = "vn" if station.get("source") == "moitruongthudo" else "us"

    # 1) Số đo thật của Sở (khi /api/hourlyaqi có dữ liệu)
    if station.get("source") == "moitruongthudo" and station_id.startswith("mtd:"):
        real = _fetch_mtd_hourly(station_id.split(":", 1)[1])
        if real:
            history = real
            history_source = "Trạm đo thật — Sở NN&MT (moitruongthudo.vn)"

    # 2) Fallback: mô hình CAMS tại vị trí trạm (đủ 24 cột cho biểu đồ)
    if not history:
        cams = _fetch_cams_history(station["lat"], station["lng"], station.get("source") or "waqi")
        if cams:
            history = cams["points"]
            history_scale = cams["scale"]
            history_source = (
                "Mô hình CAMS (Open-Meteo) tại vị trí trạm"
                + (" — VN AQI quy đổi từ PM2.5 (TT 17/2023)" if history_scale == "vn" else " — US AQI")
            )

    values = [p["aqi"] for p in history if p.get("aqi") is not None]
    detail = {
        "v": 3,
        "station": station,
        "history": history,
        "lowest": min(values) if values else None,
        "highest": max(values) if values else None,
        "historySource": history_source,
        "aqiScale": history_scale,
        "available": True,
        "fetchedAt": now.isoformat(),
    }

    try:
        with db.get_conn() as conn:
            study = db.study_area_id(conn)
            conn.execute(
                """
                INSERT INTO decision.air_quality_observations
                    (cache_key, study_area_id, source, lat, lng, location, observed_at, raw_data)
                VALUES (%s, %s, 'station-history', %s, %s, %s, %s, %s)
                ON CONFLICT (cache_key) DO UPDATE
                SET raw_data = EXCLUDED.raw_data, observed_at = EXCLUDED.observed_at
                """,
                (
                    cache_key, study, station["lat"], station["lng"],
                    json.dumps({"type": "Point", "coordinates": [station["lng"], station["lat"]]}),
                    now, json.dumps(detail, ensure_ascii=False),
                ),
            )
    except Exception:
        pass  # cache lỗi không được làm chết response

    return detail
