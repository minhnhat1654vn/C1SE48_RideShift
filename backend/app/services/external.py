"""External service adapters:

- Goong.io           : Vietnam-first geocoding WITH HOUSE NUMBERS (optional,
                       enabled by GOONG_API_KEY) — first choice of the chain
- Nominatim          : OpenStreetMap geocoding (FR-01/FR-02) — second choice
- LOCAL_PLACES       : offline Hanoi landmark fallback — last resort
- OSRM               : road-following routing with a provider chain + cache
- Open-Meteo         : air quality (FR-05/US-08) with deterministic simulation

All HTTP goes through a shared httpx client pinned to IPv4 with a proper
User-Agent (Nominatim/FOSSGIS reject requests without one).
"""
import math
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

import httpx

from .. import config
from .geo import LatLng, haversine_km

# --------------------------------------------------------------------------
# IPv4-pinned shared client (mirrors the original node:https family:4 fix)
_orig_getaddrinfo = socket.getaddrinfo


def _ipv4_preferred_getaddrinfo(*args, **kwargs):
    try:
        results = _orig_getaddrinfo(*args, **kwargs)
        v4 = [r for r in results if r[0] == socket.AF_INET]
        return v4 or results
    except Exception:
        raise


socket.getaddrinfo = _ipv4_preferred_getaddrinfo

_client_lock = threading.Lock()
_client: Optional[httpx.Client] = None


def http() -> httpx.Client:
    global _client
    with _client_lock:
        if _client is None:
            _client = httpx.Client(
                headers={"User-Agent": config.USER_AGENT},
                follow_redirects=True,
                timeout=config.TIMEOUT_ROUTE,
            )
        return _client


# --------------------------------------------------------------------------
# Geocoding — provider chain: Goong (VN house numbers) → Nominatim → LOCAL_PLACES

GeocodeResult = dict  # {name, lat, lng, source, provider}

# In-memory TTL cache (deliberately NOT a database table — geocoding is a
# stateless lookup; the cache only saves provider quota across autocomplete
# keystrokes and repeated demo queries).
_geo_cache: dict = {}
_geo_cache_lock = threading.Lock()


def _geo_cache_get(key: str):
    with _geo_cache_lock:
        hit = _geo_cache.get(key)
        if hit and time.time() - hit["at"] < config.GEOCODE_CACHE_TTL_SECONDS:
            return hit["result"]
    return None


def _geo_cache_set(key: str, result: list) -> None:
    with _geo_cache_lock:
        _geo_cache[key] = {"at": time.time(), "result": result}
        if len(_geo_cache) > config.GEOCODE_CACHE_MAX:
            oldest = next(iter(_geo_cache))
            _geo_cache.pop(oldest, None)


LOCAL_PLACES: List[GeocodeResult] = [
    {"name": "Hồ Hoàn Kiếm, Hoàn Kiếm, Hà Nội", "lat": 21.0287, "lng": 105.8524, "source": "local"},
    {"name": "Chợ Đồng Xuân, Hoàn Kiếm, Hà Nội", "lat": 21.0361, "lng": 105.8489, "source": "local"},
    {"name": "Phố cổ Hà Nội, Hoàn Kiếm, Hà Nội", "lat": 21.0335, "lng": 105.8505, "source": "local"},
    {"name": "Quảng trường Ba Đình, Ba Đình, Hà Nội", "lat": 21.0336, "lng": 105.8342, "source": "local"},
    {"name": "Văn Miếu, Đống Đa, Hà Nội", "lat": 21.0278, "lng": 105.8355, "source": "local"},
    {"name": "Mỹ Đình, Nam Từ Liêm, Hà Nội", "lat": 21.0276, "lng": 105.7763, "source": "local"},
    {"name": "Keangnam Landmark 72, Nam Từ Liêm, Hà Nội", "lat": 21.0224, "lng": 105.7750, "source": "local"},
    {"name": "Siêu thị Big C Thăng Long, Cầu Giấy, Hà Nội", "lat": 21.0269, "lng": 105.7876, "source": "local"},
    {"name": "Công viên Cầu Giấy, Cầu Giấy, Hà Nội", "lat": 21.0302, "lng": 105.7948, "source": "local"},
    {"name": "Hồ Tây, Tây Hồ, Hà Nội", "lat": 21.0651, "lng": 105.8231, "source": "local"},
    {"name": "Quận Tây Hồ, Hà Nội", "lat": 21.0575, "lng": 105.8220, "source": "local"},
    {"name": "Bệnh viện Bạch Mai, Hai Bà Trưng, Hà Nội", "lat": 20.9921, "lng": 105.8490, "source": "local"},
    {"name": "Times City, Hai Bà Trưng, Hà Nội", "lat": 20.9975, "lng": 105.8717, "source": "local"},
    {"name": "Royal City, Thanh Xuân, Hà Nội", "lat": 20.9994, "lng": 105.8210, "source": "local"},
    {"name": "Đại học Bách khoa Hà Nội (HUST), Hai Bà Trưng, Hà Nội", "lat": 21.0033, "lng": 105.8430, "source": "local"},
    {"name": "Đại học Kinh tế Quốc dân, Hai Bà Trưng, Hà Nội", "lat": 21.0071, "lng": 105.8406, "source": "local"},
    {"name": "Bến xe Giáp Bát, Hoàng Mai, Hà Nội", "lat": 21.0034, "lng": 105.8412, "source": "local"},
    {"name": "Cầu Long Biên, Hà Nội", "lat": 21.0338, "lng": 105.8592, "source": "local"},
    {"name": "Cầu Chương Dương, Hà Nội", "lat": 21.0500, "lng": 105.8620, "source": "local"},
    {"name": "Sân bay quốc tế Nội Bài, Sóc Sơn, Hà Nội", "lat": 21.2212, "lng": 105.8072, "source": "local"},
    {"name": "Vincom Nguyễn Chí Thanh, Đống Đa, Hà Nội", "lat": 21.0144, "lng": 105.8069, "source": "local"},
    {"name": "Khu công nghiệp Thăng Long, Đông Anh, Hà Nội", "lat": 21.1000, "lng": 105.8300, "source": "local"},
    {"name": "Ga Hà Nội, Hoàn Kiếm, Hà Nội", "lat": 21.0223, "lng": 105.8455, "source": "local"},
    {"name": "Tràng Tiền Plaza, Hoàn Kiếm, Hà Nội", "lat": 21.0245, "lng": 105.8535, "source": "local"},
    {"name": "Công viên Thống Nhất (công viên Lenin), Hai Bà Trưng, Hà Nội", "lat": 21.0069, "lng": 105.8435, "source": "local"},
    {"name": "Văn Miếu - Quốc Tử Giám, Đống Đa, Hà Nội", "lat": 21.0278, "lng": 105.8355, "source": "local"},
    {"name": "Công viên nước Hồ Tây, Tây Hồ, Hà Nội", "lat": 21.0615, "lng": 105.8155, "source": "local"},
    {"name": "Gò Đống Đa, Đống Đa, Hà Nội", "lat": 21.0170, "lng": 105.8270, "source": "local"},
]


def _geocode_goong_classic(q: str) -> Optional[List[GeocodeResult]]:
    """Goong.io Geocoding.

    Trả về: None = lỗi mạng/key (KHÔNG phân biệt với "không có kết quả"),
    [] = gọi OK nhưng 0 ứng viên. Task 73 tách 2 trạng thái để geocode_address
    biết khi nào KHÔNG nên cache kết quả rỗng (mạng chớp n flash chỉ là tạm thời).

    Response is parsed defensively against shape drift:
      {"status": "OK", "geocoding_results": [
          {"name": ..., "formatted_address": ...,
           "geometry": {"location": {"lat": ..., "lng": ...}}}, ...]}
    (a Mapbox-style "features" array + "center": [lng, lat] is also accepted)
    """
    if not config.GOONG_API_KEY:
        return None  # chưa bật key — coi như nguồn không tham gia, không phải lỗi
    try:
        resp = http().get(
            config.GOONG_GEOCODE_URL,
            params={"address": q, "api_key": config.GOONG_API_KEY},
            timeout=config.TIMEOUT_GEOCODE,
        )
        if resp.status_code != 200:
            # 401/403: invalid key — 429: quota exhausted. Visible in
            # `docker compose logs backend`; the chain degrades to Nominatim.
            print(f"geocode: goong HTTP {resp.status_code} for q={q!r} — falling through")
            return None
        data = resp.json()
        items = data.get("geocoding_results") or data.get("features") or []
        results: List[GeocodeResult] = []
        for d in items[:6]:
            loc = (d.get("geometry") or {}).get("location") or {}
            lat = loc.get("lat", d.get("lat"))
            lng = loc.get("lng", d.get("lng"))
            if lat is None or lng is None:
                center = d.get("center")  # Mapbox-style [lng, lat]
                if isinstance(center, (list, tuple)) and len(center) == 2:
                    lng, lat = center[0], center[1]
            name = d.get("name") or d.get("formatted_address") or ""
            if lat is None or lng is None or not name:
                continue
            results.append({
                "name": name,
                "lat": float(lat),
                "lng": float(lng),
                "source": "external",
                "provider": "goong",
            })
        if not results:
            print(f"geocode: goong 0 result for q={q!r} — falling through")
        return results
    except Exception as e:
        print(f"geocode: goong unreachable ({e.__class__.__name__}: {e}) — falling through")
        return None


def _geocode_goong(q: str) -> Optional[List[GeocodeResult]]:
    """Goong.io — chuỗi 2 bước (Task 65) + semantics cache Task 73.

    1) Place AutoComplete — tìm VN text CÓ số nhà (input mời kiểu "120 yên");
       predictions có place_id nhưng KHÔNG có toạ độ
    2) Place Detail — giải từng prediction sang toạ độ chính xác
       (gọi song song, tối đa 8)
    3) Fallback: classic /geocode (đúng cho địa chỉ HOÀN CHỈNH) khi
       AutoComplete không ra kết quả

    Trả về: None = chưa bật key / nguồn lỗi mạng (KHÔNG cache rỗng),
            [] = nguồn đã trả lời nhưng 0 ứng viên (cache được).
    """
    if not config.GOONG_API_KEY:
        return None  # chưa bật key — nguồn không tham gia, không phải lỗi
    autocomplete_ok = False
    try:
        results: List[GeocodeResult] = []
        resp = http().get(
            config.GOONG_AUTOCOMPLETE_URL,
            params={"input": q, "api_key": config.GOONG_API_KEY, "limit": 8},
            timeout=config.TIMEOUT_GEOCODE,
        )
        if resp.status_code == 200:
            autocomplete_ok = True
            predictions = (resp.json() or {}).get("predictions") or []
            place_ids = [
                p["place_id"] for p in predictions[:8] if p.get("place_id")
            ]

            def _detail(place_id: str) -> Optional[GeocodeResult]:
                try:
                    r2 = http().get(
                        config.GOONG_PLACE_DETAIL_URL,
                        params={"place_id": place_id, "api_key": config.GOONG_API_KEY},
                        timeout=config.TIMEOUT_GEOCODE,
                    )
                    if r2.status_code != 200:
                        return None
                    d = (r2.json() or {}).get("result") or {}
                    loc = (d.get("geometry") or {}).get("location") or {}
                    lat, lng = loc.get("lat"), loc.get("lng")
                    name = d.get("formatted_address") or d.get("name") or ""
                    if lat is None or lng is None or not name:
                        return None
                    return {
                        "name": name,
                        "lat": float(lat),
                        "lng": float(lng),
                        "source": "external",
                        "provider": "goong",
                    }
                except Exception:
                    return None

            if place_ids:
                with ThreadPoolExecutor(max_workers=8) as pool:
                    results = [r for r in pool.map(_detail, place_ids) if r]
        else:
            print(f"geocode: goong-autocomplete HTTP {resp.status_code} for q={q!r} — falling through")
        # AutoComplete đã trả lời OK nhưng 0 kết quả → thử classic /geocode
        # (endpoint classic hiểu địa chỉ hoàn chỉnh, AutoComplete hiểu input mời)
        if not results and autocomplete_ok:
            classic = _geocode_goong_classic(q)
            if classic:
                results = classic
        if not results:
            print(f"geocode: goong 0 result for q={q!r} — falling through")
            return [] if autocomplete_ok else None
        return results
    except Exception as e:
        print(f"geocode: goong unreachable ({e.__class__.__name__}: {e}) — falling through")
        return None


def _geocode_nominatim(
    q: str, viewbox: str = "105.60,21.18,106.05,20.70"
) -> Optional[List[GeocodeResult]]:
    """Nominatim bounded-search trong viewbox thành phố — Task 73 tăng limit
    6 → 10 (phản hồi user "list không xổ ra toàn bộ").

    None = lỗi mạng/HTTP (không cache kết quả rỗng), [] = gọi OK, 0 ứng viên.
    """
    try:
        resp = http().get(
            config.NOMINATIM_URL,
            params={
                "format": "json",
                "limit": "10",
                "countrycodes": "vn",
                "viewbox": viewbox,
                "bounded": "1",
                "q": q,
            },
            timeout=config.TIMEOUT_GEOCODE,
        )
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list) and data:
                return [
                    {
                        "name": ", ".join(str(d.get("display_name", "")).split(",")[:3]),
                        "lat": float(d["lat"]),
                        "lng": float(d["lon"]),
                        "source": "external",
                        "provider": "nominatim",
                    }
                    for d in data
                    if d.get("lat") and d.get("lon")
                ][:10]
        else:
            # Visible in `docker compose logs backend` — a 403/429 here means
            # Nominatim is rate-limiting / blocking this network and the
            # address autocomplete degrades to the built-in LOCAL_PLACES list.
            print(f"geocode: nominatim HTTP {resp.status_code} for q={q!r}")
            return None
    except Exception as e:
        print(f"geocode: nominatim unreachable ({e.__class__.__name__}: {e}) — falling back to LOCAL_PLACES")
        return None
    return []


def geocode_address(query: str, viewbox: str = "105.60,21.18,106.05,20.70") -> List[GeocodeResult]:
    """Geocode với viewbox tuỳ chọn (bbox thành phố — Task 63 multi-city).

    Task 73 (phản hồi user "có nhiều hơn 1 kết quả nhưng list không xổ ra
    toàn bộ" + "tìm nhà/tên đường lại ra kết quả nhiều thành phố"):
      - GỌI SONG SONG cả Goong lẫn Nominatim rồi GỘP kết quả (trước đây
        Goong có kết quả thì Nominatim bị bỏ qua — danh sách ít ứng viên;
        Goong cho số nhà, Nominatim cho nhiều kết quả đường/phố).
      - Gộp trùng theo toạ độ (4 chữ số ≈ 11 m) — Nominatim hay trả 2 dòng
        cùng 1 điểm (vd "Xóm Chùa, Tây Hồ" lặp).
      - Cache key GỐM viewbox — trước đây key chỉ theo q nên tìm 1 từ khoá
        ở 2 thành phố khác nhau bị dính kết quả cache của thành phố trước.
    """
    q = (query or "").strip()
    if not q:
        return []
    key = (q.lower(), viewbox)
    hit = _geo_cache_get(key)
    if hit is not None:
        return hit
    # Goong (VN house numbers) ∥ Nominatim (bounded theo viewbox) — song song
    # vì 2 nguồn độc lập; một nguồn lỗi không chặn nguồn còn lại
    with ThreadPoolExecutor(max_workers=2) as ex:
        fg = ex.submit(_geocode_goong, q)
        fn = ex.submit(_geocode_nominatim, q, viewbox)
        goong = fg.result()
        nomin = fn.result()
    results = [r for r in (goong or []) + (nomin or [])]
    # gộp trùng toạ độ (Goong đứng trước để ưu tiên số nhà) — 2 khoá:
    #   toạ độ 4 chữ số (≈11 m) và cùng TÊN trong 3 chữ số (≈110 m — Nominatim
    #   hay trả 2-3 dòng trùng tên cách nhau vài mét, vd "Xóm Chùa, Tây Hồ")
    merged: List[GeocodeResult] = []
    seen = set()
    for r in results:
        k = (round(r["lat"], 4), round(r["lng"], 4))
        kn = (r["name"].lower().strip(), round(r["lat"], 3), round(r["lng"], 3))
        if k in seen or kn in seen:
            continue
        seen.add(k)
        seen.add(kn)
        merged.append(r)
    results = merged[:10]
    if not results:
        ql = q.lower()
        results = [
            {**p, "provider": "local"}
            for p in LOCAL_PLACES
            if ql in p["name"].lower()
        ][:6]
    if not results and (goong is None and nomin is None):
        # CẢ HAI nguồn đều lỗi mạng (không phải 0 kết quả thật) → trả rỗng
        # NHƯNG không cache: lần gõ tiếp theo thử lại (mạng chớp n là tạm thời)
        print(f"geocode: cả goong lẫn nominatim lỗi mạng cho q={q!r} — bỏ qua cache")
        return []
    _geo_cache_set(key, results)
    return results


# --------------------------------------------------------------------------
# Routing (OSRM provider chain + in-memory TTL cache + synthetic fallback)

ROUTE_TIMEOUT = config.TIMEOUT_ROUTE
ROUTE_CACHE_TTL = config.ROUTE_CACHE_TTL_SECONDS
ROUTE_CACHE_MAX = config.ROUTE_CACHE_MAX

_route_cache: dict = {}
_route_cache_lock = threading.Lock()


def _cache_key(origin: LatLng, dest: LatLng, profile: str) -> str:
    r = lambda v: round(v * 10000) / 10000  # noqa: E731
    return f"{profile}|{r(origin[0])},{r(origin[1])}|{r(dest[0])},{r(dest[1])}"


def _cache_get(key: str):
    with _route_cache_lock:
        hit = _route_cache.get(key)
        if hit and time.time() - hit["at"] < ROUTE_CACHE_TTL:
            return hit["result"]
    return None


def _cache_set(key: str, result: dict) -> None:
    with _route_cache_lock:
        _route_cache[key] = {"at": time.time(), "result": result}
        if len(_route_cache) > ROUTE_CACHE_MAX:
            oldest = next(iter(_route_cache))
            _route_cache.pop(oldest, None)


def synthetic_route(a: LatLng, b: LatLng) -> List[LatLng]:
    """Slightly curved deterministic path — last-resort offline fallback."""
    coords: List[LatLng] = []
    steps = 42
    dx = b[1] - a[1]
    dy = b[0] - a[0]
    perp_x, perp_y = -dy, dx
    mag = math.hypot(perp_x, perp_y) or 1.0
    for i in range(steps + 1):
        t = i / steps
        bow = math.sin(t * math.pi) * 0.045 * (haversine_km(a, b) / 8 + 0.3)
        lat = a[0] + dy * t + (perp_y / mag) * bow
        lng = a[1] + dx * t + (perp_x / mag) * bow
        coords.append((lat, lng))
    return coords


def _try_osrm(base: str, origin: LatLng, dest: LatLng) -> Optional[dict]:
    url = (
        f"{base}/route/v1/driving/"
        f"{origin[1]},{origin[0]};{dest[1]},{dest[0]}"
        "?overview=full&geometries=geojson&steps=false&annotations=false"
    )
    try:
        resp = http().get(url, timeout=ROUTE_TIMEOUT)
        data = resp.json()
    except Exception:
        return None
    route = (data or {}).get("routes", [None])[0]
    geom = (route or {}).get("geometry", {}).get("coordinates")
    if data.get("code") != "Ok" or not route or not geom or len(geom) < 2:
        return None
    coords = [(c[1], c[0]) for c in geom]
    return {
        "coords": coords,
        "distanceKm": route["distance"] / 1000,
        "durationMin": (route["duration"] / 60) * 1.35,  # Hanoi traffic factor
        "source": "osrm",
    }


def get_route(origin: LatLng, dest: LatLng, profile: str = "driving") -> dict:
    key = _cache_key(origin, dest, profile)
    hit = _cache_get(key)
    if hit:
        return hit

    if profile == "driving":
        providers = config.OSRM_PROVIDERS_DRIVING
    elif profile == "cycling":
        providers = config.OSRM_PROVIDERS_CYCLING
    else:
        providers = config.OSRM_PROVIDERS_WALKING

    for base in providers:
        result = _try_osrm(base, origin, dest)
        if result:
            _cache_set(key, result)
            return result

    distance_km = haversine_km(origin, dest) * 1.35
    result = {
        "coords": synthetic_route(origin, dest),
        "distanceKm": distance_km,
        "durationMin": (distance_km / 25) * 60,
        "source": "estimated",
    }
    _cache_set(key, result)
    return result


# --------------------------------------------------------------------------
# Air quality simulation (deterministic fallback, US-19)


def simulate_air_quality(lat: float, lng: float, now=None) -> dict:
    from datetime import datetime, timezone

    now = now or datetime.now(timezone.utc)
    hour = now.hour  # UTC hour, matching the original server-side behavior
    seed = abs(math.sin(lat * 100 + lng * 77)) * 12
    base = 68 + seed
    if 7 <= hour <= 9:
        base += 28
    if 17 <= hour <= 20:
        base += 32
    if 1 <= hour <= 4:
        base -= 22
    base = max(25.0, min(215.0, base))
    return {
        "aqi": round(base),
        "pm25": round(base * 0.52 * 10) / 10,
        "pm10": round(base * 0.78 * 10) / 10,
        "measuredAt": now.isoformat().replace("+00:00", "Z"),
        "source": "simulated",
        "locationLabel": "Ước tính từ mô hình nội bộ",
        "notice": "Dịch vụ chất lượng không khí bên ngoài không khả dụng. Đây là giá trị ước tính và có thể đã cũ.",
    }
