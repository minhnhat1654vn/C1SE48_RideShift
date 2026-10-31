"""RideShift FastAPI backend — application entry point.

Backend service of the C1SE.48 capstone, implemented per the proposal
technology stack: Python + FastAPI + pandas + Shapely on PostgreSQL.

Run:  python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
(The npm script `bun run dev` in this folder does the same.)
"""
import sys
from contextlib import asynccontextmanager
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from app import config, db, seed  # noqa: E402
from app.routers import admin, public, trip  # noqa: E402

# Phiên bản đóng gói — định nghĩa ở app/config.py (đồng bộ tag image
# docker-compose.yml + /health) để backend/FE/compose dùng MỘT nguồn.
from app.config import APP_VERSION  # noqa: E402


def _boot_step(label: str, fn) -> None:
    """Chạy MỘT bước boot độc lập — bước trước lỗi KHÔNG được giết bước sau.

    (Fix gốc rễ Task 90): trước đây toàn bộ lifespan nằm trong một try duy
    nhất, nên một exception ở seed làm geoimport/wardimport/pipeline không
    bao giờ chạy → app vẫn 200 nhưng mất phường/xã + bulletin — đúng hiện
    tượng "chỉ có Hà Nội, không có phường, mất tab Chính sách"."""
    try:
        fn()
    except Exception as e:  # noqa: BLE001
        import traceback

        print(f"[boot] {label} THẤT BẠI: {e!r}")
        traceback.print_exc()


@asynccontextmanager
async def lifespan(application: FastAPI):
    _boot_step("schema (db.init_db)", db.init_db)
    _boot_step("seed (seed.seed)", seed.seed)

    def _geoimport():
        # Task 65 — gis.administrative_regions: 3 thành phố (HN/DN/HCM),
        # idempotent theo (study_area_id, code); self-heal sau khi DB bị reset
        from app.services import geoimport

        geo_report = geoimport.import_admin_regions()
        if geo_report.get("imported"):
            print(
                f"gis.administrative_regions: +{geo_report['imported']} phường/xã "
                f"({', '.join(c['city'] for c in geo_report.get('cities', []))})"
            )
        else:
            for c in geo_report.get("cities", []):
                if c.get("skipped") and c.get("reason"):
                    print(f"gis.administrative_regions/{c['city']}: bỏ qua — {c['reason']}")
                else:
                    print(
                        f"gis.administrative_regions/{c['city']}: đã có "
                        f"{c.get('existing', 0)} phường/xã (idempotent)"
                    )

    _boot_step("geoimport (phường/xã 3 thành phố)", _geoimport)

    def _wardimport():
        # governance pack: nạp phường/xã bộ máy 2025 (bổ sung mã còn thiếu) +
        # gán phường cho chuyến cũ — geoimport phía trên là nguồn chính thức,
        # ensure_wards chỉ lấp lỗ idempotent theo mã.
        from app.services import wardimport

        with db.get_conn() as conn:
            wardimport.ensure_wards(conn)
            wardimport.backfill_trip_wards(conn)

    _boot_step("wardimport (bổ sung phường bộ máy)", _wardimport)

    def _trend():
        from app.services import trend

        with db.get_conn() as conn:
            n = conn.execute("SELECT count(*) AS c FROM decision.dataset_trends").fetchone()["c"]
            n_survey = conn.execute(
                "SELECT count(*) AS c FROM decision.vehicle_survey_responses"
            ).fetchone()["c"]
        # process the survey dataset on first boot — and self-heal after a
        # snapshot restore that kept dataset_trends but skipped the 25k
        # vehicle_survey_responses rows (regenerated from the CSV in seconds)
        if n == 0 or n_survey == 0:
            trend.run_pipeline()
        trend.latest_trend_map()

    _boot_step("dataset pipeline (Kaggle dataHN.csv)", _trend)

    print(f"RideShift backend ready v{APP_VERSION}: boot xong (bước lỗi xem log [boot] phía trên)")
    yield


app = FastAPI(
    title="RideShift API",
    description=(
        "Smart Transport Transition Advisor — REST API (C1SE.48). "
        "Python + FastAPI + pandas + Shapely on PostgreSQL, per proposal."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    # Explicit origins (env CORS_ORIGINS): cross-origin fetches only carry /
    # receive the admin session cookie when the exact origin is echoed back —
    # a "*" wildcard makes the browser drop Set-Cookie on the Docker setup.
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public.router)
app.include_router(trip.router)
app.include_router(admin.router)

# Task 99 — 2 router gov_ops + gov_policy ĐÃ XOÁ theo duyệt user 28/10:
# 40/46 endpoint gov FE không bao giờ gọi, 19 endpoint 500 vì 8 bảng gov đã
# DROP theo DB FINAL. 9 endpoint FE đang dùng (bulletin, notifications ×4,
# open-data ×4, trip/feedback) đã được migrate sang public.py + trip.py.


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    """500s in the same {error} envelope the front-end expects."""
    print(f"unhandled error on {request.url.path}: {exc!r}")
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=500, content={"error": "Lỗi máy chủ nội bộ. Vui lòng thử lại."}
    )


from fastapi.exceptions import RequestValidationError  # noqa: E402
from starlette.exceptions import HTTPException as StarletteHTTPException  # noqa: E402


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request, exc: StarletteHTTPException):
    """Match the original API contract: errors are `{ error: string }`."""
    from fastapi.responses import JSONResponse

    detail = exc.detail
    if isinstance(detail, list):
        detail = "; ".join(
            f"{'.'.join(str(x) for x in e.get('loc', []))}: {e.get('msg', '')}"
            if isinstance(e, dict)
            else str(e)
            for e in detail
        )
    return JSONResponse(status_code=exc.status_code, content={"error": detail})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc: RequestValidationError):
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=400,
        content={"error": "Dữ liệu yêu cầu không hợp lệ.", "details": exc.errors()},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
