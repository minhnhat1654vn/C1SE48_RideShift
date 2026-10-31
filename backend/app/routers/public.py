"""Public REST endpoints (no auth): zones, modes, locations, geocode,
air quality (trạm thật + chi tiết trạm/lịch sử 24h), dataset summary,
bảng tin chính sách, thông báo người dùng, dữ liệu mở + health.

Task 99: các endpoint bulletin / notifications / open-data DI RỜI từ 2
router gov_ops + gov_policy (đã xoá theo duyệt user 28/10 — 40/46 endpoint
gov FE không bao giờ gọi, 19 trong số đó 500 vì 8 bảng gov đã DROP theo DB
FINAL). Chỉ giữ lại ĐÚNG những route FE đang gọi, path + response KHÔNG đổi.
"""
import json
from datetime import date, datetime, time as _dt_time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .. import db
from ..config import APP_VERSION
from ..dto import _hhmm, iso_z, location_dto, mode_dto, zone_dto
from ..geojson_utils import zone_pairs_from_row
from ..services import airquality, airquality_sources, citygeom, external, trend

router = APIRouter()


@router.get("/health")
def health():
    # Counts chẩn đoán (không ảnh hưởng status): giúp `docker compose logs
    # backend` + FE hiển thị trạng thái dữ liệu thực tế lúc boot.
    counts: dict = {}
    try:
        with db.get_conn() as conn:
            counts["cities"] = conn.execute('SELECT COUNT(*) AS c FROM "City"').fetchone()["c"]
            counts["wards"] = conn.execute(
                "SELECT COUNT(*) AS c FROM gis.administrative_regions "
                "WHERE region_type IN ('Phường','Xã','Đặc khu')"
            ).fetchone()["c"]
    except Exception as e:  # noqa: BLE001
        counts = {"error": str(e)}
    try:
        with db.get_conn() as conn:
            conn.execute("SELECT 1")
        return {
            "status": "ok",
            "service": "rideshift-fastapi-backend",
            "version": APP_VERSION,
            "database": db.db_name(),
            "postgis": db.postgis_available(),
            "counts": counts,
        }
    except Exception as e:
        return {"status": "degraded", "error": str(e), "version": APP_VERSION}


@router.get("/api/zones")
def get_zones(
    all: str = Query(default="", alias="all"),
    city: str = Query(default="", alias="city"),
):
    include_inactive = all == "1"
    # legacy_is_hanoi: vùng LEZ tạo từ trước Task 63 (city_id NULL) là Hà Nội
    city_sql, city_args = _city_scope_sql(city, legacy_is_hanoi=True)
    with db.get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM policy.lez_zones
            WHERE (%s OR status = 'active') {city_sql}
            ORDER BY created_at ASC
            """,
            (include_inactive, *city_args),
        ).fetchall()
    return {"zones": [zone_dto(r, parsed_coordinates=True) for r in rows]}


@router.get("/api/modes")
def get_modes():
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM transportation.transportation_modes ORDER BY sort_order ASC"
        ).fetchall()
    return {"modes": [mode_dto(r) for r in rows]}


@router.get("/api/locations")
def get_locations(city: str = Query(default="", alias="city")):
    city_sql, city_args = _city_scope_sql(city, legacy_is_hanoi=True)
    with db.get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM transportation.transportation_locations
            WHERE status = 'active' {city_sql}
            ORDER BY name
            """,
            (*city_args,),
        ).fetchall()
    return {"locations": [location_dto(r) for r in rows]}


# ---------------------------------------------------------------------------
# Task 63 — multi-city: cities, wards (phường/xã 2025), trạm AQI thật
# ---------------------------------------------------------------------------

def _city_scope_sql(city: str, legacy_is_hanoi: bool = False) -> "tuple[str, list]":
    """Mệnh đề WHERE lọc theo thành phố; city rỗng → không lọc.

    legacy_is_hanoi=True: các dòng city_id NULL (dữ liệu cũ) được coi là
    Hà Nội — bảo đảm tương thích ngược với seed cũ.
    """
    if not city:
        return "", []
    if legacy_is_hanoi and city == "hanoi":
        return ' AND (city_id = %s OR city_id IS NULL)', [city]
    return " AND city_id = %s", [city]


def _fallback_cities() -> list:
    """Danh sách 3 thành phố TĨNH từ CITY_SEEDS — dùng khi bảng City chưa
    sẵn sàng (volume cũ/DB đang heal). Cổng chọn thành phố phải LUÔN hiện
    đủ 3 TP để người dùng đổi được Hà Nội ↔ Đà Nẵng ↔ TP.HCM."""
    from ..seed import CITY_SEEDS

    out = []
    for c in CITY_SEEDS:
        lat, lng = c["center"]
        out.append(
            {
                "id": c["id"],
                "name": c["name"],
                "centerLat": float(lat),
                "centerLng": float(lng),
                "defaultZoom": int(c["zoom"]),
                "bbox": [[lat - 0.55, lng - 0.55], [lat + 0.55, lng + 0.55]],
                "wardCount": 0,
            }
        )
    return out


@router.get("/api/cities")
def get_cities():
    try:
        return {"cities": airquality_sources.list_cities()}
    except Exception as e:  # noqa: BLE001
        # Không bao giờ 500: cổng chọn thành phố phải luôn hiện đủ 3 TP
        # (trước đây lỗi bảng City → 500 → FE rơi về đúng 1 Hà Nội).
        print(f"/api/cities fallback tĩnh (City chưa sẵn sàng): {e!r}")
        return {"cities": _fallback_cities(), "fallback": True}


@router.get("/api/cities/{city_id}/wards")
def get_city_wards(city_id: str):
    """Ranh giới phường/xã (bộ máy 2025) của 1 thành phố — FeatureCollection.

    Thuộc tính giữ nguyên bộ cũ (ma_xa, ten_xa, loai, dtich_km2, dan_so,
    matdo_km2, sap_nhap) để lớp bản đồ hành chính tương thích.

    Task 86 (gộp A′): bảng public."Ward" ĐÃ BỎ — đọc thẳng
    gis.administrative_regions qua ánh xạ City."studyAreaId" ↔ study_area_id.
    boundary_simple là bản Douglas-Peucker 0.0005° đã giản lược (geoimport
    tự tạo khi nạp geojson); fallback về geometry đầy đủ nếu cột trống.
    """
    city = airquality_sources.get_city(city_id)
    if not city:
        raise HTTPException(status_code=404, detail="Không tìm thấy thành phố.")
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT code, name, region_type AS type, boundary_simple, geometry,
                   area_km2, population, density_km2, merged_from
            FROM gis.administrative_regions
            WHERE study_area_id = (SELECT "studyAreaId" FROM "City" WHERE id = %s)
              AND region_type IN ('Phường', 'Xã', 'Đặc khu')
            ORDER BY name ASC
            """,
            (city_id,),
        ).fetchall()
    features = []
    for w in rows:
        try:
            geometry = json.loads(w["boundary_simple"] or w["geometry"] or "")
        except Exception:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "ma_xa": w["code"],
                    "ten_xa": w["name"],
                    "loai": w["type"],
                    "dtich_km2": w["area_km2"],
                    "dan_so": w["population"],
                    "matdo_km2": w["density_km2"],
                    "sap_nhap": w["merged_from"],
                },
                "geometry": geometry,
            }
        )
    return {"type": "FeatureCollection", "features": features}


@router.get("/api/airquality/stations")
def get_airquality_stations(city: str = Query(default="hanoi", alias="city")):
    """Trạm đo thật theo thành phố (Sở NN&MT ∪ WAQI) — cache-first 30 phút."""
    try:
        return airquality_sources.get_stations_for_city(city)
    except Exception:
        return {
            "stations": [],
            "fetchedAt": "",
            "sources": {"moitruongthudo": {"ok": False, "count": 0}, "waqi": {"ok": False, "count": 0}},
            "notice": "Không tải được trạm đo thật.",
        }


@router.get("/api/airquality/stations/{station_id}")
def get_airquality_station_detail(station_id: str, city: str = Query(default="hanoi", alias="city")):
    """Task 99 — chi tiết 1 trạm + lịch sử AQI 24h (min/max) cho panel click
    trạm (kiểu PAM Air). Lịch sử: số đo thật của Sở khi có, fallback mô hình
    CAMS tại vị trí trạm — minh bạch qua historySource."""
    try:
        detail = airquality_sources.get_station_detail(city, station_id)
    except Exception:
        detail = None
    if detail is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy trạm đo.")
    return detail


@router.get("/api/geocode")
def geocode(q: str = "", city: str = Query(default="", alias="city")):
    """Tìm kiếm địa điểm — Task 73 lọc NGHIÊM NGẶT theo thành phố đang khoá.

    Phản hồi user: "việc tìm kiếm địa chỉ cũng cần limit lại theo vùng,
    tránh việc tìm 1 số nhà, tên đường nhưng lại xổ ra kết quả ở nhiều
    thành phố khác nhau". Do đó kết quả NGOÀI ranh giới thành phố (outline
    union phường/xã + đệm 2 km, xem services/citygeom.py) bị LOẠI BỎ, không
    chỉ xếp hạng xuống dưới như trước. Không có kết quả trong thành phố →
    trả [] (frontend hiển thị "Không tìm thấy trong {city.name}").
    """
    if len(q.strip()) < 2:
        return {"results": []}
    try:
        c = airquality_sources.get_city(city) if city else None
        # viewbox Nominatim: ưu tiên bbox outline (chặt), fallback bbox DB
        viewbox = (
            citygeom.city_viewbox(city, c["bbox"])
            if c
            else "105.60,21.18,106.05,20.70"
        )
        results = external.geocode_address(q, viewbox)
        if c:
            if citygeom.has_outline(city):
                results = [
                    r
                    for r in results
                    if citygeom.city_contains(city, r["lat"], r["lng"])
                ]
            results.sort(
                key=lambda r: airquality_sources.haversine_km(
                    c["centerLat"], c["centerLng"], r["lat"], r["lng"]
                )
            )
            results = results[:8]
        return {"results": results}
    except Exception:
        raise HTTPException(status_code=500, detail="Tìm kiếm địa điểm thất bại.")


@router.get("/api/airquality")
def air(lat: float = Query(...), lng: float = Query(...)):
    return {"airQuality": airquality.get_air_quality(lat, lng)}


@router.get("/api/dataset/summary")
def dataset_summary():
    """Processed "Vehicle at Ha Noi Dataset" (Deliverable #11 — pandas)."""
    return trend.dataset_summary()


# ===========================================================================
# Task 99 — migrated từ routers/gov_ops.py + gov_policy.py (2 router gov đã
# xoá theo duyệt user 28/10). CHỈ giữ các endpoint FE đang gọi, giữ nguyên
# path + response contract.
# ===========================================================================

# ---------------------------------------------------------------------------
# Thông báo người dùng (notification-bell.tsx) — public, ẩn danh theo userKey
# ---------------------------------------------------------------------------

class PrefsBody(BaseModel):
    userKey: str = Field(min_length=1, max_length=64)
    optIn: bool
    district: Optional[str] = Field(default=None, max_length=100)


class ReadBody(BaseModel):
    userKey: str = Field(min_length=1, max_length=64)
    ids: list[int] = Field(min_length=1, max_length=200)


def _require_user_key(user_key: str) -> str:
    uk = (user_key or "").strip()
    if not (1 <= len(uk) <= 64):
        raise HTTPException(status_code=400, detail="userKey không hợp lệ (1..64 ký tự).")
    return uk


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _vn_date(d: Optional[date]) -> str:
    return d.strftime("%d/%m/%Y") if d else "—"


def _generate_zone_notifications(conn, user_key: str) -> int:
    """Sinh thông báo LEZ mới cho user (idempotent theo UNIQUE(user_key, type, zone_id))."""
    today = _today()
    zones = conn.execute(
        """
        SELECT lez_zone_id, name, status, decision_no, issued_by, effective_from
        FROM policy.lez_zones
        WHERE status IN ('published', 'active')
          AND effective_from IS NOT NULL
          AND effective_from BETWEEN %s AND %s
        ORDER BY effective_from
        """,
        (today - timedelta(days=7), today + timedelta(days=30)),
    ).fetchall()
    created = 0
    for z in zones:
        ntype = "lez_published" if z["status"] == "published" else "lez_active"
        eff = _vn_date(z["effective_from"])
        qd = f"Quyết định số {z['decision_no']}" if z["decision_no"] else "Văn bản chính sách"
        org = f" (ban hành bởi {z['issued_by']})" if z["issued_by"] else ""
        verb = "sẽ có hiệu lực từ" if ntype == "lez_published" else "đã có hiệu lực từ"
        title = f"Vùng kiểm soát phát thải mới: {z['name']}"[:200]
        body = (
            f"{qd}{org} — vùng LEZ \"{z['name']}\" {verb} {eff}. "
            "Bạn nên xem xét lập kế hoạch lại tuyến di chuyển trong khu vực này."
        )
        row = conn.execute(
            """
            INSERT INTO decision.user_notifications (user_key, type, zone_id, title, body)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (user_key, type, zone_id) DO NOTHING
            RETURNING notification_id
            """,
            (user_key, ntype, int(z["lez_zone_id"]), title, body),
        ).fetchone()
        if row:
            created += 1
    return created


@router.post("/api/notifications/prefs")
def set_notification_prefs(body: PrefsBody):
    """(Public) Lưu tùy chọn nhận thông báo chính sách (UPSERT theo user_key)."""
    try:
        with db.get_conn() as conn:
            row = conn.execute(
                """
                INSERT INTO decision.notification_prefs (user_key, district, opt_in, updated_at)
                VALUES (%s, %s, %s, now())
                ON CONFLICT (user_key) DO UPDATE SET
                    opt_in = EXCLUDED.opt_in,
                    district = COALESCE(EXCLUDED.district, decision.notification_prefs.district),
                    updated_at = now()
                RETURNING user_key, opt_in, district
                """,
                (body.userKey.strip(), body.district, body.optIn),
            ).fetchone()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Không lưu được tùy chọn thông báo. Vui lòng thử lại.")
    return {"prefs": {"userKey": row["user_key"], "optIn": bool(row["opt_in"]), "district": row["district"]}}


@router.get("/api/notifications/prefs")
def get_notification_prefs(userKey: str = Query(default="")):
    """(Public) Tra tùy chọn thông báo theo user_key."""
    uk = _require_user_key(userKey)
    try:
        with db.get_conn() as conn:
            row = conn.execute(
                "SELECT user_key, opt_in, district FROM decision.notification_prefs WHERE user_key = %s",
                (uk,),
            ).fetchone()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Không tải được tùy chọn thông báo. Vui lòng thử lại.")
    if not row:
        return {"prefs": None}
    return {"prefs": {"userKey": row["user_key"], "optIn": bool(row["opt_in"]), "district": row["district"]}}


@router.get("/api/notifications")
def list_notifications(userKey: str = Query(default="")):
    """(Public) Danh sách thông báo của user (tự sinh thông báo LEZ nếu đã opt-in)."""
    uk = _require_user_key(userKey)
    try:
        with db.get_conn() as conn:
            prefs = conn.execute(
                "SELECT opt_in FROM decision.notification_prefs WHERE user_key = %s", (uk,)
            ).fetchone()
            if prefs and prefs["opt_in"]:
                _generate_zone_notifications(conn, uk)
            rows = conn.execute(
                """
                SELECT notification_id, type, title, body, zone_id, read_at, created_at
                FROM decision.user_notifications
                WHERE user_key = %s
                ORDER BY created_at DESC
                LIMIT 50
                """,
                (uk,),
            ).fetchall()
            unread = int(conn.execute(
                """
                SELECT count(*) AS c FROM decision.user_notifications
                WHERE user_key = %s AND read_at IS NULL
                """,
                (uk,),
            ).fetchone()["c"])
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Không tải được thông báo. Vui lòng thử lại.")
    return {
        "notifications": [
            {
                "id": int(r["notification_id"]),
                "type": r["type"],
                "title": r["title"],
                "body": r["body"],
                "zoneId": int(r["zone_id"]) if r["zone_id"] is not None else None,
                "readAt": iso_z(r["read_at"]),
                "createdAt": iso_z(r["created_at"]),
            }
            for r in rows
        ],
        "unread": unread,
    }


@router.post("/api/notifications/read")
def mark_notifications_read(body: ReadBody):
    """(Public) Đánh dấu một loạt thông báo là đã đọc."""
    try:
        with db.get_conn() as conn:
            conn.execute(
                """
                UPDATE decision.user_notifications SET read_at = now()
                WHERE user_key = %s AND notification_id = ANY(%s)
                """,
                (body.userKey.strip(), body.ids),
            )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Không cập nhật được trạng thái thông báo. Vui lòng thử lại.")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Dữ liệu mở (policy-bulletin.tsx — liên kết tải GeoJSON/JSON)
# ---------------------------------------------------------------------------

@router.get("/api/open/lez.geojson")
def open_lez_geojson():
    """(Public) GeoJSON các vùng LEZ đã công bố / đang hiệu lực."""
    try:
        with db.get_conn() as conn:
            rows = conn.execute(
                """
                SELECT lez_zone_id, name, status, decision_no, effective_from, effective_to, geometry
                FROM policy.lez_zones
                WHERE status IN ('published', 'active')
                ORDER BY lez_zone_id
                """
            ).fetchall()
    except Exception:
        raise HTTPException(status_code=500, detail="Không xuất được dữ liệu mở vùng LEZ. Vui lòng thử lại.")

    features = []
    for r in rows:
        pts = zone_pairs_from_row(r) or []
        ring: list[list[float]] = []
        if isinstance(pts, list):
            for p in pts:
                try:
                    ring.append([float(p[1]), float(p[0])])  # [lat,lng] -> [lng,lat]
                except (TypeError, ValueError, IndexError):
                    continue
        if len(ring) < 3:
            continue
        if ring[0] != ring[-1]:
            ring.append(list(ring[0]))
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {
                "id": int(r["lez_zone_id"]),
                "name": r["name"],
                "status": r["status"],
                "decisionNo": r["decision_no"],
                "effectiveFrom": r["effective_from"].isoformat() if r["effective_from"] else None,
                "effectiveTo": r["effective_to"].isoformat() if r["effective_to"] else None,
            },
        })
    return {"type": "FeatureCollection", "features": features}


@router.get("/api/open/facilities.geojson")
def open_facilities_geojson():
    """(Public) GeoJSON điểm hạ tầng giao thông đang hoạt động."""
    try:
        with db.get_conn() as conn:
            rows = conn.execute(
                """
                SELECT l.transportation_location_id, l.name, l.location_type, l.lat, l.lng,
                       tm.code AS mode_code
                FROM transportation.transportation_locations l
                LEFT JOIN transportation.transportation_modes tm
                  ON tm.transportation_mode_id = l.transportation_mode_id
                WHERE l.status = 'active'
                ORDER BY l.transportation_location_id
                """
            ).fetchall()
    except Exception:
        raise HTTPException(status_code=500, detail="Không xuất được dữ liệu mở hạ tầng. Vui lòng thử lại.")

    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(r["lng"]), float(r["lat"])]},
            "properties": {
                "id": int(r["transportation_location_id"]),
                "name": r["name"],
                "type": r["location_type"],
                "mode": r["mode_code"],
                "lat": float(r["lat"]),
                "lng": float(r["lng"]),
            },
        }
        for r in rows
    ]
    return {"type": "FeatureCollection", "features": features}


@router.get("/api/open/aqi.json")
def open_aqi():
    """(Public) Bản ghi AQI mới nhất của mỗi trạm (DISTINCT ON cache_key)."""
    try:
        with db.get_conn() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT ON (cache_key)
                       cache_key, lat, lng, aqi, pm25, source, observed_at
                FROM decision.air_quality_observations
                ORDER BY cache_key, observed_at DESC
                """
            ).fetchall()
    except Exception:
        raise HTTPException(status_code=500, detail="Không xuất được dữ liệu mở AQI. Vui lòng thử lại.")
    return {
        "stations": [
            {
                "stationKey": r["cache_key"],
                "lat": float(r["lat"]),
                "lng": float(r["lng"]),
                "aqi": int(r["aqi"]) if r["aqi"] is not None else None,
                "pm25": float(r["pm25"]) if r["pm25"] is not None else None,
                "source": r["source"],
                "observedAt": iso_z(r["observed_at"]),
            }
            for r in rows
        ],
        "generatedAt": iso_z(datetime.now(timezone.utc)),
    }


@router.get("/api/open/modes.json")
def open_modes():
    """(Public) Danh mục phương tiện kèm tham số vận hành (dữ liệu mở)."""
    try:
        with db.get_conn() as conn:
            rows = conn.execute(
                """
                SELECT code, name, avg_speed_kmh, base_fare, cost_per_km, co2_per_km_g
                FROM transportation.transportation_modes
                ORDER BY sort_order, code
                """
            ).fetchall()
    except Exception:
        raise HTTPException(status_code=500, detail="Không xuất được dữ liệu mở phương tiện. Vui lòng thử lại.")
    return {
        "modes": [
            {
                "code": r["code"],
                "name": r["name"],
                "avgSpeedKmh": float(r["avg_speed_kmh"]),
                "baseFare": float(r["base_fare"]),
                "costPerKm": float(r["cost_per_km"]),
                "co2PerKmG": float(r["co2_per_km_g"]),
            }
            for r in rows
        ],
        "generatedAt": iso_z(datetime.now(timezone.utc)),
    }


# ---------------------------------------------------------------------------
# Bảng tin chính sách (policy-bulletin.tsx)
# ---------------------------------------------------------------------------

_DAY_TO_INT = {"Mon": 1, "Tue": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6, "Sun": 7}


def _d_iso(d) -> Optional[str]:
    """DATE column → 'YYYY-MM-DD' (None giữ None)."""
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.date().isoformat()
    if isinstance(d, date):
        return d.isoformat()
    return str(d)


def _days_to_ints(raw) -> list[int]:
    """'Mon,Tue' (hoặc '1,2') → [1, 2]; rỗng/lỗi → cả tuần [1..7]."""
    if raw is None:
        return list(range(1, 8))
    out: set[int] = set()
    for tok in str(raw).split(","):
        tok = tok.strip()
        if tok in _DAY_TO_INT:
            out.add(_DAY_TO_INT[tok])
        elif tok.isdigit() and 1 <= int(tok) <= 7:
            out.add(int(tok))
    return sorted(out) or list(range(1, 8))


@router.get("/api/public/bulletin")
def public_bulletin():
    """(Public) Bảng tin chính sách công khai: vùng LEZ + quy định + hạn chế."""
    with db.get_conn() as conn:
        zones = conn.execute(
            """
            SELECT * FROM policy.lez_zones
            WHERE status IN ('published', 'active')
            ORDER BY effective_from DESC NULLS LAST, created_at DESC
            """
        ).fetchall()
        zone_ids = [z["lez_zone_id"] for z in zones]
        rules_by_zone: dict[int, list[dict]] = {}
        if zone_ids:
            rules = conn.execute(
                """
                SELECT * FROM policy.lez_rules
                WHERE lez_zone_id = ANY(%s) AND status = 'active'
                ORDER BY start_time, rule_name
                """,
                (zone_ids,),
            ).fetchall()
            rule_ids = [r["lez_rule_id"] for r in rules]
            restr_by_rule: dict[int, list] = {}
            if rule_ids:
                for vr in conn.execute(
                    """
                    SELECT vr.lez_rule_id, vt.code AS vt_code, vt.name AS vt_name, vr.restriction_type,
                           vr.min_emission_level, vr.restriction_reason
                    FROM policy.vehicle_restrictions vr
                    JOIN policy.vehicle_types vt ON vt.vehicle_type_id = vr.vehicle_type_id
                    WHERE vr.lez_rule_id = ANY(%s)
                    ORDER BY vt.name
                    """,
                    (rule_ids,),
                ).fetchall():
                    restr_by_rule.setdefault(int(vr["lez_rule_id"]), []).append(vr)
            for r in rules:
                rules_by_zone.setdefault(int(r["lez_zone_id"]), []).append(
                    {
                        "ruleId": int(r["lez_rule_id"]),
                        "ruleName": r["rule_name"],
                        "startTime": _hhmm(r["start_time"]),
                        "endTime": _hhmm(r["end_time"]),
                        "daysOfWeek": _days_to_ints(r["days_of_week"]),
                        "effectiveFrom": _d_iso(r["effective_from"]),
                        "effectiveTo": _d_iso(r["effective_to"]),
                        "restrictions": [
                            {
                                "vehicleType": vr["vt_name"],
                                "vehicleTypeCode": vr["vt_code"],
                                "restrictionType": vr["restriction_type"],
                                "minEmissionLevel": int(vr["min_emission_level"] or 0),
                                "reason": vr["restriction_reason"],
                            }
                            for vr in restr_by_rule.get(int(r["lez_rule_id"]), [])
                        ],
                    }
                )
    return {
        "bulletin": [
            {
                "zoneId": int(z["lez_zone_id"]),
                "name": z["name"],
                "description": z["description"],
                "status": z["status"],
                "decisionNo": z.get("decision_no"),
                "issuedBy": z.get("issued_by"),
                "effectiveFrom": _d_iso(z["effective_from"]),
                "effectiveTo": _d_iso(z["effective_to"]),
                "publishedAt": iso_z(z.get("published_at")),
                "rules": rules_by_zone.get(int(z["lez_zone_id"]), []),
            }
            for z in zones
        ]
    }
