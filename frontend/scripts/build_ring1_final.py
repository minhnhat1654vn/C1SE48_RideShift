#!/usr/bin/env python3
"""Dựng polygon VÀNH ĐAI 1 mới theo file quy_dinh_vanh_dai_1.txt (Task 29).

Chu trình (clockwise), bám 4 trục trong file:
  Đê Nguyễn Khoái → Trần Khát Chân → Đại Cồ Việt → Xã Đàn → Ô Chợ Dừa
  → Hoàng Cầu → (khu Thái Hà/Chùa Bộc kéo dài) → Giảng Võ → Kim Mã
  → Liễu Giai → (Văn Cao/Thụy Khuê bờ Hồ Tây — khu Voi Phục)
  → Quán Thánh → Phan Đình Phùng → Hàng Đậu → Trần Nhật Duật
  → (dông bờ đông Hồ Gươm) → đóng về Trần Khát Chân.

Đỉnh dùng nút giao thực tế đã đo (gap ≤ ~90m) + 3 connector ngắn được công bố.
Output: /tmp/overpass/ring1_final.json + kiểm chứng Shapely.
"""
import json
import sys

sys.path.insert(0, "/home/z/my-project/mini-services/fastapi-backend")
from app.seed import RING1  # noqa: F401  (tham chiếu, không dùng polygon cũ)


def load_chains(path: str, key: str):
    """Chains (đã gộp, sắp theo độ dài) của đường `key` từ cache fetch."""
    from collections import defaultdict

    def is_main(n):
        return not any(x in n for x in ("Hẻm", "Ngách", "Ngõ", "Ngạch", "Cầu vượt"))

    raw = defaultdict(list)
    for f in ("/tmp/overpass/ring1_roads.json", "/tmp/overpass/extra_roads.json",
              "/tmp/overpass/north_roads.json"):
        try:
            data = json.load(open(f))
        except FileNotFoundError:
            continue
        for name, ways in data.items():
            if key in name:
                raw[name].extend(ways)
    segs = [w["points"] for ways in raw.values() for w in ways if is_main(w["osm_name"])]
    used = [False] * len(segs)
    out = []
    for i, s in enumerate(segs):
        if used[i]:
            continue
        ch = list(s)
        used[i] = True
        changed = True
        while changed:
            changed = False
            for j, t in enumerate(segs):
                if used[j]:
                    continue
                if ch[-1] == t[0]:
                    ch += t[1:]; used[j] = True; changed = True
                elif ch[-1] == t[-1]:
                    ch += t[::-1][1:]; used[j] = True; changed = True
                elif ch[0] == t[-1]:
                    ch = t[:-1] + ch; used[j] = True; changed = True
                elif ch[0] == t[0]:
                    ch = t[::-1][1:] + ch; used[j] = True; changed = True
        out.append(ch)
    out.sort(key=len, reverse=True)
    return out


def dist(p, q):
    import math
    return math.hypot((q[0] - p[0]) * 111320, (q[1] - p[1]) * 101000)


def slice_between(chain, pt_a, pt_b):
    """Lấy phần chain từ điểm gần pt_a tới điểm gần pt_b (giữ nguyên thứ tự)."""
    ia = min(range(len(chain)), key=lambda i: dist(chain[i], pt_a))
    ib = min(range(len(chain)), key=lambda i: dist(chain[i], pt_b))
    seg = chain[ia:ib + 1]
    if len(seg) < 2:
        seg = chain[ib:ia + 1][::-1]
    return seg


# ---------------- dựng chuỗi polygon ----------------
poly = []

def add(seg):
    for p in seg:
        if not poly or dist(poly[-1], p) > 1e-9:
            poly.append(p)

def connect(a, b):
    if poly and dist(poly[-1], a) > 2:
        poly.append(a)
    poly.append(b)

# [A] Đông–Nam: Đê Nguyễn Khoái → Trần Khát Chân → Đại Cồ Việt
nk = load_chains("/tmp/overpass/ring1_roads.json", "Nguyễn Khoái")[0]
tkc = load_chains("/tmp/overpass/ring1_roads.json", "Trần Khát Chân")[0]
dcv = load_chains("/tmp/overpass/ring1_roads.json", "Đại Cồ Việt")[0]

# nút tham chiếu
NUT_TKC_DCV = tkc[min(range(len(tkc)), key=lambda i: dist(tkc[i], (21.0090, 105.8530)))]
NUT_DCV_XD = dcv[min(range(len(dcv)), key=lambda i: dist(dcv[i], (21.0075, 105.8415)))]
NUT_NK_TKC = nk[min(range(len(nk)), key=lambda i: dist(nk[i], (21.0090, 105.8660)))]

add(slice_between(nk, NUT_NK_TKC, NUT_NK_TKC))  # placeholder — NK dùng 1 đỉnh
poly[-1] = NUT_NK_TKC
add(slice_between(tkc, NUT_NK_TKC, NUT_TKC_DCV))
add(slice_between(dcv, NUT_TKC_DCV, NUT_DCV_XD))

# [B] Xã Đàn → Ô Chợ Dừa → Hoàng Cầu
xd = load_chains("/tmp/overpass/ring1_roads.json", "Xã Đàn")[0]
ocd = load_chains("/tmp/overpass/ring1_roads.json", "Ô Chợ Dừa")[0]
hc = load_chains("/tmp/overpass/ring1_roads.json", "Hoàng Cầu")[0]

NUT_XD_OCD = xd[min(range(len(xd)), key=lambda i: dist(xd[i], (21.0183, 105.8296)))]
NUT_OCD_HC = ocd[min(range(len(ocd)), key=lambda i: dist(ocd[i], (21.0209, 105.8256)))]
NUT_HC_END = hc[min(range(len(hc)), key=lambda i: dist(hc[i], (21.0138, 105.8189)))]

add(slice_between(xd, NUT_DCV_XD, NUT_XD_OCD))
add(slice_between(ocd, NUT_XD_OCD, NUT_OCD_HC))
add(slice_between(hc, NUT_OCD_HC, NUT_HC_END))

# [C] Connector khu Thái Hà/Chùa Bộc kéo dài → Giảng Võ nam
gv = load_chains("/tmp/overpass/ring1_roads.json", "Giảng Võ")[0]
NUT_GV_S = gv[min(range(len(gv)), key=lambda i: dist(gv[i], (21.0239, 105.8209)))]
connect(NUT_HC_END, NUT_GV_S)

# [D] Giảng Võ (lên bắc) → Kim Mã (về tây tới Voi Phục)
km = load_chains("/tmp/overpass/ring1_roads.json", "Kim Mã")[0]
NUT_GV_KM = km[min(range(len(km)), key=lambda i: dist(km[i], (21.0322, 105.8300)))]
NUT_KM_W = km[min(range(len(km)), key=lambda i: dist(km[i], (21.0285, 105.8055)))]
add(slice_between(gv, NUT_GV_S, NUT_GV_KM))
add(slice_between(km, NUT_GV_KM, NUT_KM_W))

# [E] Liễu Giai (lên bắc) → Thụy Khuê (bờ Hồ Tây, đông) → Voi Phục
lg = load_chains("/tmp/overpass/extra_roads.json", "Liễu Giai")[0]
thk = load_chains("/tmp/overpass/north_roads.json", "Thụy Khuê")[0]
NUT_LG_S = lg[min(range(len(lg)), key=lambda i: dist(lg[i], (21.0302, 105.8131)))]
NUT_LG_N = lg[min(range(len(lg)), key=lambda i: dist(lg[i], (21.0372, 105.8149)))]
NUT_THK_E = thk[min(range(len(thk)), key=lambda i: dist(thk[i], (21.0427, 105.8359)))]
NUT_THK_W = thk[min(range(len(thk)), key=lambda i: dist(thk[i], (21.0434, 105.8168)))]

connect(NUT_KM_W, NUT_LG_S)
add(slice_between(lg, NUT_LG_S, NUT_LG_N))
connect(NUT_LG_N, NUT_THK_W)
add(slice_between(thk, NUT_THK_W, NUT_THK_E))

# [F] Quán Thánh → Phan Đình Phùng → Hàng Đậu → Trần Nhật Duật
qt = load_chains("/tmp/overpass/extra_roads.json", "Quán Thánh")[0]
pdp = load_chains("/tmp/overpass/north_roads.json", "Phan Đình Phùng")[0]
hd = load_chains("/tmp/overpass/north_roads.json", "Hàng Đậu")[0]
tnd = load_chains("/tmp/overpass/north_roads.json", "Trần Nhật Duật")[0]

NUT_QT_W = qt[min(range(len(qt)), key=lambda i: dist(qt[i], (21.0427, 105.8360)))]
NUT_QT_E = qt[min(range(len(qt)), key=lambda i: dist(qt[i], (21.0403, 105.8476)))]
NUT_PDP_N = pdp[min(range(len(pdp)), key=lambda i: dist(pdp[i], (21.0427, 105.8476)))]
NUT_PDP_S = pdp[min(range(len(pdp)), key=lambda i: dist(pdp[i], (21.0355, 105.8476)))]
NUT_HD_W = hd[min(range(len(hd)), key=lambda i: dist(hd[i], (21.0355, 105.8476)))]
NUT_HD_E = hd[min(range(len(hd)), key=lambda i: dist(hd[i], (21.0365, 105.8500)))]
NUT_TND_W = tnd[min(range(len(tnd)), key=lambda i: dist(tnd[i], (21.0339, 105.8553)))]
NUT_TND_E = tnd[min(range(len(tnd)), key=lambda i: dist(tnd[i], (21.0407, 105.8499)))]

add(slice_between(qt, NUT_QT_W, NUT_QT_E))
add(slice_between(pdp, NUT_QT_E if dist(pdp[0], NUT_QT_E) < 50 else NUT_QT_E, NUT_PDP_S) if False else slice_between(pdp, NUT_PDP_N, NUT_PDP_S))
add(slice_between(hd, NUT_HD_W, NUT_HD_E))
add(slice_between(tnd, NUT_TND_W, NUT_TND_E))

# [G] Connector dọc đông Hồ Gươm: Trần Nhật Duật nam → Trần Khát Chân bắc → đóng
P_HG_E = (21.0285, 105.8527)  # nút Hàng Khay × Trần Khát Chân (bờ đông Hồ Gươm)
connect(NUT_TND_W, P_HG_E)
tkc_north = tkc[min(range(len(tkc)), key=lambda i: dist(tkc[i], (21.0285, 105.8527)))]
poly.append(tkc_north)
# Trần Khát Chân từ Hồ Gươm chạy nam — dùng chính chain tkc từ tkc_north về NUT_TKC_DCV
seg_back = slice_between(tkc, tkc_north, NUT_TKC_DCV)
add(seg_back)

print(f"Đỉnh polygon: {len(poly)}")
import math
total = sum(dist(a, b) for a, b in zip(poly, poly[1:] + [poly[0]]))
print(f"Chu vi: {total/1000:.1f} km")

from shapely.geometry import Polygon, Point
shp = Polygon([(lng, lat) for lat, lng in poly])
print(f"valid={shp.is_valid} simple={shp.is_simple} area={shp.area*111320*101000/1e6:.1f} km²")

checks = [
    ("Hồ Gươm", 21.0320, 105.8523, True),
    ("Nhà hát Lớn", 21.0304, 105.8498, True),
    ("Ga Hà Nội", 21.0260, 105.8490, True),
    ("Bách Khoa", 21.0053, 105.8530, True),
    ("ĐH KHXH&NV (XĐ)", 21.0145, 105.8350, True),
    ("Chợ Đồng Xuân", 21.0360, 105.8490, True),
    ("ĐH Luật/khu Hoàng Cầu", 21.0230, 105.8240, True),
    ("Keangnam", 21.0230, 105.8068, False),
    ("Hồ Tây (giữa hồ)", 21.0520, 105.8280, False),
    ("Big C Thăng Long", 20.9930, 105.8180, False),
    ("Mỹ Đình", 21.0276, 105.7763, False),
    ("Times City", 21.0055, 105.8860, False),
]
ok = 0
for name, lat, lng, expect in checks:
    inside = shp.contains(Point(lng, lat))
    ok += inside == expect
    print(f"   {'OK ' if inside == expect else 'XX '}{name:26s} inside={inside} expect={expect}")
print(f">>> {ok}/{len(checks)} landmark checks passed")

json.dump(poly, open("/tmp/overpass/ring1_final.json", "w"), ensure_ascii=False)
print("saved /tmp/overpass/ring1_final.json")
