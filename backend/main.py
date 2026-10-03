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

from app import db, seed  # noqa: E402
from app.routers import admin, public, trip  # noqa: E402


@asynccontextmanager
async def lifespan(application: FastAPI):
    try:
        db.init_db()
        seed.seed()
        from app.services import trend

        with db.get_conn() as conn:
            n = conn.execute("SELECT count(*) AS c FROM dataset_trend").fetchone()["c"]
        if n == 0:
            trend.run_pipeline()  # process the survey dataset on first boot
        trend.latest_trend_map()
        print("RideShift backend ready: schema ensured, seed ensured, dataset pipeline OK")
    except Exception as e:
        print(f"startup warning: {e!r}")
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
    allow_origins=["*"],  # same-origin via gateway; CORS kept permissive for dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public.router)
app.include_router(trip.router)
app.include_router(admin.router)


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
