#!/usr/bin/env python3
"""Dựng polygon VÀNH ĐAI 1 mới theo file quy_dinh_vanh_dai_1.txt — v2 (sửa hướng slice).

Chu trình (clockwise):
  Hồ Gươm đông → Trần Khát Chân → Đại Cồ Việt → Xã Đàn → Ô Chợ Dừa → Hoàng Cầu
  → (conn khu Thái Hà) → Giảng Võ → Kim Mã → (conn khu Voi Phục/Liễu Giai)
  → Thụy Khuê (bờ Hồ Tây) → Quán Thánh → Phan Đình Phùng → Hàng Đậu
  → Trần Nhật Duật → (conn bờ đông Hồ Gươm) → đóng.
"""
import json
import math
import sys

sys.path.insert(0, "/home/z/my-project/mini-services/fastapi-backend")


def load_chains(key: str, which: int = 0):
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
    return out[which]


def dist(p, q):
    return math.hypot((q[0] - p[0]) * 111320, (q[1] - p[1]) * 101000)


def nearest_idx(chain, pt):
    return min(range(len(chain)), key=lambda i: dist(chain[i], pt))


def nearest_point(chain, pt):
    return chain[nearest_idx(chain, pt)]


def node(chain, lat, lng):
    return nearest_point(chain, (lat, lng))


def add_slice(poly, chain, a, b, label):
    """Thêm phần chain từ điểm gần a tới điểm gần b (đúng hướng a→b)."""
    ia, ib = nearest_idx(chain, a), nearest_idx(chain, b)
    if ia == ib:
        return
    seg = chain[ia:ib + 1] if ia < ib else chain[ib:ia + 1][::-1]
    if dist(seg[0], a) > dist(seg[0], b):
        seg = seg[::-1]
    # bỏ đỉnh đầu nếu trùng đỉnh cuối polygon
    if poly and dist(poly[-1], seg[0]) < 2:
        seg = seg[1:]
    gap = dist(poly[-1], seg[0]) if poly else 0
    if gap > 400:
        print(f"  !! gap {gap:.0f}m trước '{label}'")
    poly.extend(seg)
    end_gap = dist(poly[-1], b) if poly else 0
    print(f"  {label:28s} {len(seg):3d} đỉnh, tới '{label}' lệch {end_gap:.0f}m")


poly = []

# [A] Đông–Nam: Hồ Gươm đông → Trần Khát Chân (dọc, thủ công) → Đại Cồ Việt
dcv = load_chains("Đại Cồ Việt")
NUT_TKC_HG = (21.0285, 105.8527)              # Hồ Gươm đông (bờ Hồ Gươm — thủ công)
NUT_TKC_MID = (21.0140, 105.8530)             # Trần Khát Chân giữa (dọc 105.853)
NUT_TKC_DCV = node(dcv, 21.0090, 105.8530)    # TKC × ĐCV (đầu đông chain ĐCV)
NUT_DCV_XD = node(dcv, 21.0075, 105.8415)     # ĐCV × XĐ
poly.append(NUT_TKC_HG)
poly.append(NUT_TKC_MID)
poly.append(NUT_TKC_DCV)
add_slice(poly, dcv, NUT_TKC_DCV, NUT_DCV_XD, "Đại Cồ Việt")

# [B] Xã Đàn → Ô Chợ Dừa → Hoàng Cầu
xd = load_chains("Xã Đàn")
ocd = load_chains("Ô Chợ Dừa")
hc = load_chains("Hoàng Cầu")
NUT_XD_OCD = node(xd, 21.0183, 105.8296)
NUT_OCD_HC = node(ocd, 21.0209, 105.8256)
NUT_HC_END = node(hc, 21.0138, 105.8189)
add_slice(poly, xd, NUT_DCV_XD, NUT_XD_OCD, "Xã Đàn")
add_slice(poly, ocd, NUT_XD_OCD, NUT_OCD_HC, "Ô Chợ Dừa")
add_slice(poly, hc, NUT_OCD_HC, NUT_HC_END, "Hoàng Cầu")

# [C] Connector khu Thái Hà → Giảng Võ (lên bắc)
gv0, gv1 = load_chains("Giảng Võ", 0), load_chains("Giảng Võ", 1)
NUT_GV_S = node(gv0, 21.0234, 105.8199)
NUT_GV_CAT = node(gv0, 21.0296, 105.8274)
NUT_GV_KM = node(gv1, 21.0322, 105.8300)
connect_a = poly[-1]
poly.append((21.0165, 105.8200))  # connector khu Chùa Bộc kéo dài (1)
poly.append((21.0212, 105.8210))  # connector khu Chùa Bộc kéo dài (2)
print(f"  connector Hoàng Cầu → Giảng Võ: {dist(connect_a, NUT_GV_S):.0f}m")
add_slice(poly, gv0, NUT_GV_S, NUT_GV_CAT, "Giảng Võ (nam→Cát Linh)")
add_slice(poly, gv1, NUT_GV_CAT, NUT_GV_KM, "Giảng Võ (Cát Linh→Kim Mã)")

# [D] Kim Mã về tây tới Voi Phục
km = load_chains("Kim Mã")
NUT_KM_W = node(km, 21.0311, 105.8172)   # Kim Mã × Liễu Giai (đầu tây phố Kim Mã)
add_slice(poly, km, NUT_GV_KM, NUT_KM_W, "Kim Mã (Voi Phục)")

# [E] Liễu Giai lên bắc → Thụy Khuê (bờ Hồ Tây, chạy đông) → Voi Phục
lg = load_chains("Liễu Giai")
thk = load_chains("Thụy Khuê")
NUT_LG_S = node(lg, 21.0302, 105.8131)
NUT_LG_N = node(lg, 21.0372, 105.8149)
NUT_THK_W = node(thk, 21.0434, 105.8168)
NUT_THK_E = node(thk, 21.0427, 105.8359)
connect_a = poly[-1]
poly.append((21.0345, 105.8150))  # connector khu Văn Cao/Liễu Giai
print(f"  connector Kim Mã → Liễu Giai: {dist(connect_a, NUT_LG_S):.0f}m")
add_slice(poly, lg, NUT_LG_S, NUT_LG_N, "Liễu Giai")
connect_a = poly[-1]
poly.append((21.0390, 105.8155))  # connector Văn Cao
print(f"  connector Liễu Giai → Thụy Khuê: {dist(connect_a, NUT_THK_W):.0f}m")
add_slice(poly, thk, NUT_THK_W, NUT_THK_E, "Thụy Khuê (bờ Hồ Tây)")

# [F] Quán Thánh (thẳng) → Hàng Đậu → (conn dọc đông Hồ Gươm) → đóng
hd = load_chains("Hàng Đậu")
NUT_QT_E = (21.0403, 105.8476)          # Quán Thánh × Phan Đình Phùng × Hàng Đậu (nút thật)
NUT_HD_W = node(hd, 21.0401, 105.8472)
NUT_HD_E = node(hd, 21.0407, 105.8499)
connect_a = poly[-1]
poly.append(NUT_QT_E)
print(f"  connector Thụy Khuê → Quán Thánh×PĐP (Quán Thánh thẳng): "
      f"{dist(connect_a, NUT_QT_E):.0f}m")
add_slice(poly, hd, NUT_HD_W, NUT_HD_E, "Hàng Đậu")
connect_a = poly[-1]
hg = poly[0]
poly.append((21.0360, 105.8527))  # conn dọc đông Hồ Gươm (Hàng Khay)
poly.append(poly[0])               # đóng tại Hồ Gươm đông
print(f"  connector Hàng Đậu → Hồ Gươm (đóng, dọc đông Hồ Gươm): "
      f"{dist(connect_a, poly[-1]):.0f}m")

print(f"\nĐỉnh: {len(poly)} | chu vi: {sum(dist(a,b) for a,b in zip(poly, poly[1:]+[poly[:1][0]]))/1000:.1f} km")

from shapely.geometry import Polygon, Point
shp = Polygon([(lng, lat) for lat, lng in poly])
print(f"valid={shp.is_valid} simple={shp.is_simple} area={shp.area*111320*101000/1e6:.1f} km²")

for tol in (0.0003, 0.0005):
    s = shp.simplify(tol)
    checks = [("Hồ Gươm",21.0320,105.8523,1),("Nhà hát Lớn",21.0304,105.8498,1),
              ("Ga Hà Nội",21.0260,105.8490,1),("ĐH KHXH&NV",21.0145,105.8350,1),
              ("Chợ Đồng Xuân",21.0360,105.8490,1),("ĐH Văn hóa (Hoàng Cầu)",21.0239,105.8228,1),
              ("Keangnam",21.0230,105.8068,0),("Hồ Tây giữa",21.0520,105.8280,0),
              ("Big C Thăng Long",20.9930,105.8180,0),("Mỹ Đình",21.0276,105.7763,0),
              ("Times City",21.0055,105.8860,0),("HV Báo chí (Trần Phú)",21.0380,105.8180,0)]
    ok = sum(1 for n, la, ln, e in checks if s.contains(Point(ln, la)) == bool(e))
    print(f"tol={tol}: pts={len(s.exterior.coords)-1} simple={s.is_simple} valid={s.is_valid} "
          f"area={s.area*111320*101000/1e6:.1f}km² landmarks={ok}/{len(checks)}")
    if s.is_simple and s.is_valid and ok == len(checks):
        coords = [[round(lat, 5), round(lng, 5)] for lng, lat in s.exterior.coords][:-1]
        json.dump(coords, open("/tmp/overpass/ring1_v2.json", "w"), ensure_ascii=False)
        print(">>> SAVED /tmp/overpass/ring1_v2.json")
        break
