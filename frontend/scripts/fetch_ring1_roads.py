#!/usr/bin/env python3
"""Fetch OSM geometry cho các tuyến Vành đai 1 theo file quy_dinh_vanh_dai_1.txt.

Các trục (file TXT):
  1. Trần Khát Chân – Đại Cồ Việt – Xã Đàn
  2. Ô Chợ Dừa – Hoàng Cầu (nhánh phụ)
  3. Voi Phục – Kim Mã – Giảng Võ
  4. Nguyễn Khoái (đê ven sông)
+ dự phòng để khép vòng: Chùa Bộc, Thái Hà

Output: /tmp/overpass/ring1_roads.json  {road_name: [way...]}
In ra tổng hợp endpoints để dựng chu trình.
"""
import json
import sys
import time
import urllib.request
import urllib.parse

sys.path.insert(0, "/home/z/my-project/mini-services/fastapi-backend")

OUT = "/tmp/overpass/ring1_roads.json"
BBOX = "20.98,105.78,21.09,105.89"

NAMES = [
    "Nguyễn Khoái",
    "Trần Khát Chân",
    "Đại Cồ Việt",
    "Xã Đàn",
    "Ô Chợ Dừa",
    "Hoàng Cầu",
    "Voi Phục",
    "Kim Mã",
    "Giảng Võ",
    "Chùa Bộc",
    "Thái Hà",
]

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]


def build_query() -> str:
    regs = "|".join(NAMES)
    return (
        f"[out:json][timeout:90];"
        f'way["highway"]["name"~"{regs}"]({BBOX});'
        f"out geom;"
    )


def fetch_overpass() -> dict:
    q = build_query()
    body = urllib.parse.urlencode({"data": q}).encode()
    last_err = None
    for mirror in MIRRORS:
        try:
            print(f"  trying {mirror} …", flush=True)
            req = urllib.request.Request(
                mirror, data=body, headers={"User-Agent": "RideShift-LEZ/1.0"}
            )
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.loads(r.read())
            print(f"  OK — {len(data.get('elements', []))} ways", flush=True)
            return data
        except Exception as exc:  # noqa: BLE001
            print(f"  FAIL: {exc!r}", flush=True)
            last_err = exc
            time.sleep(2)
    raise SystemExit(f"All mirrors failed: {last_err!r}")


def main() -> None:
    data = fetch_overpass()
    roads: dict[str, list] = {}
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name", "")
        geom = el.get("geometry") or []
        if not geom:
            continue
        for target in NAMES:
            if target in name:
                roads.setdefault(target, []).append(
                    {
                        "way_id": el.get("id"),
                        "osm_name": name,
                        "points": [
                            (round(p["lat"], 6), round(p["lon"], 6)) for p in geom
                        ],
                    }
                )
                break

    import os

    os.makedirs("/tmp/overpass", exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(roads, f, ensure_ascii=False)

    print(f"\n=== {OUT} ===")
    for target in NAMES:
        ways = roads.get(target, [])
        pts = sum(len(w["points"]) for w in ways)
        seg_names = sorted({w["osm_name"] for w in ways})
        print(f"{target:16s} ways={len(ways):3d} pts={pts:5d}  {seg_names[:4]}")


if __name__ == "__main__":
    main()
