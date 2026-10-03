#!/usr/bin/env python3
"""Dựng polygon Vành đai 1 mới theo file quy_dinh_vanh_dai_1.txt (Task 29).

Trục (theo file):
  1. Trần Khát Chân – Đại Cồ Việt – Xã Đàn
  2. Ô Chợ Dừa – Hoàng Cầu (nhánh phụ)
  3. Voi Phục (OSM: Đường Thanh Niên / khu đền Voi Phục) – Kim Mã – Giảng Võ
  4. Nguyễn Khoái (đê ven sông)
Khép vòng tây: Giảng Võ → Chùa Bộc → Xã Đàn (ngã tư Chùa Bộc × Xã Đàn).

Output: /tmp/overpass/ring1_v2.json — polygon [[lat,lng]…] + báo cáo.
"""
import json
from collections import defaultdict

ROADS = "/tmp/overpass/ring1_roads.json"
OUT = "/tmp/overpass/ring1_v2.json"
BBOX = "20.98,105.78,21.09,105.89"
MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
GAP_MAX = 350  # m — gap tối đa cho phép giữa 2 trục liên tiếp


# ---------------- lọc + gộp ways mỗi đường thành polyline ----------------

def is_main_axis(name: str) -> bool:
    bad = ("Hẻm", "Ngách", "Ngõ", "Ngạch", "Cầu vượt", "dọc", "kênh")
    return not any(b in name for b in bad)


def load_ways():
    with open(ROADS) as f:
        raw = json.load(f)
    # bổ sung cache Thanh Niên / Quán Thánh nếu fetch riêng đã lưu
    return raw


def merge_ways(ways: list) -> tuple[list, dict]:
    """Gộp các ways (points, shared node ids) thành polyline dài nhất."""
    # rebuild từ node ids nếu có — /tmp cache chỉ lưu points; nối bằng endpoints
    segs = [w["points"] for w in ways]
    used = [False] * len(segs)
    chains: list[list] = []
    for i, s in enumerate(segs):
        if used[i]:
            continue
        chain = list(s)
        used[i] = True
        changed = True
        while changed:
            changed = False
            for j, t in enumerate(segs):
                if used[j]:
                    continue
                if chain[-1] == t[0]:
                    chain.extend(t[1:]); used[j] = True; changed = True
                elif chain[-1] == t[-1]:
                    chain.extend(reversed(t[:-1])); used[j] = True; changed = True
                elif chain[0] == t[-1]:
                    chain = list(t[:-1]) + chain; used[j] = True; changed = True
                elif chain[0] == t[0]:
                    chain = list(reversed(t[1:])) + chain; used[j] = True; changed = True
        chains.append(chain)
    chains.sort(key=len, reverse=True)
    return chains


def polyline_len(pts) -> float:
    import math
    total = 0.0
    for (a, b) in zip(pts, pts[1:]):
        total += math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 101000)
    return total


def min_gap(a: list, b: list) -> tuple[float, int, int]:
    import math
    best = (1e9, 0, 0)
    for i, p in enumerate(a):
        for j, q in enumerate(b):
            d = math.hypot((q[0] - p[0]) * 111320, (q[1] - p[1]) * 101000)
            if d < best[0]:
                best = (d, i, j)
    return best


def build_plan(plan: list[dict]) -> dict:
    """plan: [{road, side}] theo thứ tự; side='A' dùng như fetch, 'B' đảo."""
    import math
    chains_all = {}
    for step in plan:
        name = step["road"]
        chains = merge_ways(ROAD_WAYS[name])
        # chọn chuỗi dài nhất là trục chính (hẻm đã lọc)
        chains_all[name] = chains[0] if chains else []

    full: list = []
    report = []
    # đi từng trục theo hướng hợp lý: nối đuôi chain hiện tại với đầu chain kế
    cur = None
    for k, step in enumerate(plan):
        chain = list(chains_all[step["road"]])
        if step.get("reverse"):
            chain.reverse()
        if cur is None:
            cur = list(chain)
            report.append((step["road"], "start", 0.0))
            continue
        # nối: điểm cuối cur với điểm đầu chain (hoặc đảo chain nếu nối đuôi-hầu tốt hơn)
        tail = cur[-1]
        d_head = math.hypot((chain[0][0] - tail[0]) * 111320,
                            (chain[0][1] - tail[1]) * 101000)
        d_tail = math.hypot((chain[-1][0] - tail[0]) * 111320,
                            (chain[-1][1] - tail[1]) * 101000)
        if d_tail < d_head:
            chain.reverse()
            d_head, d_tail = d_tail, d_head
        report.append((step["road"], "connect", round(d_head, 1)))
        if d_head <= GAP_MAX:
            if d_head > 15:  # chèn connector ngắn
                cur.append(tail)
            cur.extend(chain)
        else:
            cur.extend(chain)  # vẫn nối, gap sẽ được báo cáo
        cur = cur
    # khép vòng
    d_close = math.hypot((cur[-1][0] - cur[0][0]) * 111320,
                         (cur[-1][1] - cur[0][1]) * 101000)
    report.append(("CLOSE", "close", round(d_close, 1)))
    return {"poly": cur, "report": report, "len_m": round(polyline_len(cur))}


ROAD_WAYS: dict[str, list] = {}


def ensure_roads() -> None:
    raw = load_ways()
    for k, v in raw.items():
        ROAD_WAYS[k] = [w for w in v if is_main_axis(w["osm_name"])]
    # Thanh Niên (đoạn bờ đông Hồ Tây = khu Voi Phục) — fetch nếu chưa có
    if not ROAD_WAYS.get("Thanh Niên"):
        import urllib.request
        import urllib.parse
        q = ('[out:json][timeout:60];(way["highway"]["name"~"Thanh Niên"]'
             f'({BBOX}););out geom tags;')
        body = urllib.parse.urlencode({"data": q}).encode()
        req = urllib.request.Request(
            MIRRORS[1], data=body, headers={"User-Agent": "RideShift/1.0"})
        data = json.loads(urllib.request.urlopen(req, timeout=90).read())
        ways = []
        for el in data.get("elements", []):
            g = el.get("geometry") or []
            if g:
                ways.append({
                    "way_id": el["id"], "osm_name": "Đường Thanh Niên",
                    "points": [(round(p["lat"], 6), round(p["lon"], 6))
                               for p in g],
                })
        ROAD_WAYS["Thanh Niên"] = [w for w in ways
                                   if is_main_axis(w["osm_name"])]

PLANS = {
    "A_file_order": [
        {"road": "Nguyễn Khoái"},
        {"road": "Trần Khát Chân"},
        {"road": "Đại Cồ Việt"},
        {"road": "Xã Đàn"},
        {"road": "Ô Chợ Dừa"},
        {"road": "Hoàng Cầu"},
        {"road": "Thanh Niên"},
        {"road": "Kim Mã"},
        {"road": "Giảng Võ"},
        {"road": "Chùa Bộc"},
        {"road": "Xã Đàn", "reuse": True},
    ],
    "B_no_chuaboc": [
        {"road": "Nguyễn Khoái"},
        {"road": "Trần Khát Chân"},
        {"road": "Đại Cồ Việt"},
        {"road": "Xã Đàn"},
        {"road": "Ô Chợ Dừa"},
        {"road": "Hoàng Cầu"},
        {"road": "Thanh Niên"},
        {"road": "Kim Mã"},
        {"road": "Giảng Võ"},
    ],
}


def main() -> None:
    ensure_roads()

    for pname, plan in PLANS.items():
        # Xã Đàn dùng 2 lần: lần 2 là đoạn ngã tư Chùa Bộc → ngã tư Ô Chợ Dừa
        res = build_plan(plan)
        print(f"\n=== PLAN {pname} — tổng dài {res['len_m']/1000:.1f} km ===")
        for road, how, gap in res["report"]:
            print(f"   {road:16s} {how:8s} gap={gap}m")
        # kiểm tra polygon
        from shapely.geometry import Polygon, Point
        poly = Polygon([(lng, lat) for lat, lng in res["poly"]])
        print(f"   valid={poly.is_valid} simple={poly.is_simple} "
              f"area={poly.area*111320*101000/1e6:.1f} km²")
        checks = [
            ("Hồ Gươm", 21.0320, 105.8523, True),
            ("Nhà hát Lớn", 21.0304, 105.8498, True),
            ("Ga Hà Nội", 21.0260, 105.8490, True),
            ("Bách Khoa", 21.0053, 105.8530, True),
            ("ĐH Luật (Hoàng Cầu)", 21.0270, 105.8260, True),
            ("Chợ Đồng Xuân", 21.0360, 105.8490, True),
            ("Hồ Tây (giữa hồ)", 21.0645, 105.8495, False),
            ("Big C Thăng Long", 20.9930, 105.8180, False),
            ("Keangnam", 21.0230, 105.8068, False),
            ("Mỹ Đình", 21.0276, 105.7763, False),
            ("Times City", 21.0055, 105.8860, False),
        ]
        ok = 0
        for name, lat, lng, expect in checks:
            inside = poly.contains(Point(lng, lat))
            mark = "OK " if inside == expect else "XX "
            ok += inside == expect
            print(f"   {mark}{name:22s} inside={inside} expect={expect}")
        print(f"   >>> {ok}/{len(checks)} landmark checks passed")
        with open(f"/tmp/overpass/plan_{pname}.json", "w") as f:
            json.dump(res["poly"], f, ensure_ascii=False)


if __name__ == "__main__":
    main()
