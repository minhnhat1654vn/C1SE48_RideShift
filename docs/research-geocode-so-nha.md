# Nghiên cứu: Tra cứu địa chỉ cấp số nhà (Goong → Nominatim → Local)

> Task 51 — nghiên cứu tính năng "tra cứu chi tiết hơn bằng số nhà" có trong
> bản mới trên GitHub (commit `df75b90` — "Task 4: Tich hop Goong geocode so nha",
> tác giả Chi-Ton) và đã được áp vào bản local sau refactor DB v2.

## 1. Tính năng giải quyết vấn đề gì?

Nominatim (OSM) hiểu địa chỉ Việt Nam ở mức **phường/phố**, nhưng yếu với
**số nhà + tên phố** kiểu Việt Nam (không dấu, viết tắt, thứ tự ngược).
Người dùng gõ "12 Ngo Quyen Hoan Kiem" và mong nhận đúng toạ độ số nhà 12
phố Ngô Quyền. Nguồn dữ liệu địa chỉ VN tốt nhất hiện có cho bài toán này là
**Goong** (nền tảng map của Zalo). Nhóm đã kiểm chứng (commit message):
- `12 Ngo Quyen Hoan Kiem` → đúng số nhà, `source=goong`
- `Đại Cồ Việt` → đúng phố Hà Nội (không còn match sai Bắc Ninh)

## 2. Chuỗi phân giải 3 tầng

```
GET /api/geocode?q=<chuỗi địa chỉ>
        │
        ▼
┌─ 1. GOONG ────────────────────────────────────────────┐
│ https://rsapi.goong.io/v2/geocode?api_key=...&address │
│ • Key: env GOONG_API_KEY (không commit, rules.md §1.2)│
│ • Thiếu key → return [] ngay (không gọi mạng)         │
│ • HTTP ≠ 200 / timeout 5s / exception → []            │
│ • Parse results[]: formatted_address, lat, lng        │
│ • Lọc địa lý: chỉ giữ kết quả trong bán kính 25 km    │
│   quanh STUDY_CENTER (21.0285, 105.8542) + sort gần nhất│
└──────────────┬────────────────────────────────────────┘
               │ rỗng?
               ▼
┌─ 2. NOMINATIM ────────────────────────────────────────┐
│ nominatim.openstreetmap.org/search?format=json&limit=6│
│   &countrycodes=vn&viewbox=105.60,21.18,106.05,20.70  │
│   &bounded=1&q=...                                    │
│ • UA bắt buộc: RideShift/1.0 (C1SE.48 Capstone)       │
│ • Cắt display_name còn 3 cụm đầu (số nhà + phố + phường)
│ • HTTP ≠ 200 / exception → rơi xuống tầng 3           │
└──────────────┬────────────────────────────────────────┘
               │ rỗng?
               ▼
┌─ 3. LOCAL (offline) ──────────────────────────────────┐
│ 28 địa danh Hà Nội hard-code trong external.py        │
│ substring matching thường giản đơn, tối đa 6 kết quả  │
└───────────────────────────────────────────────────────┘
```

Nguyên tắc: **"nguồn đầu tiên trả kết quả non-empty thắng"** — Goong có kết
quả (sau lọc bán kính) thì Nominatim không bao giờ được hỏi.

## 3. Contract JSON (không đổi so với v1)

```json
{ "results": [
  { "name": "Bắc Bộ Phủ, 12, Phố Ngô Quyền",
    "lat": 21.0266, "lng": 105.8553,
    "source": "goong" }   // "goong" | "external" | "local"
]}
```

Số nhà KHÔNG thêm field mới — sự khác biệt nằm ở **độ chi tiết của `name`**
và **độ chính xác toạ độ** (đúng mép số nhà thay vì tâm phường).

## 4. Frontend (GeoSearch trong planner)

- Debounce **300 ms**, tối thiểu **3 ký tự**, tối đa **5 gợi ý**
- Dropdown `role="listbox"`, chọn → `onPick({name, lat, lng})` → đưa vào
  `POST /api/trip/analyze`
- Request bắt buộc qua `apiUrl()` (thêm `XTransformPort=8000` trong sandbox)
  và parse cả hai shape `data?.results ?? data` (bài học Task 5 nhóm)

## 5. Điểm mạnh / hạn chế

**Mạnh:** graceful degradation 3 tầng (không bao giờ 500 vì dịch vụ ngoài);
geo-fence 2 lớp rẻ (bán kính 25 km + bounded viewbox); offline vẫn chạy được
tầng local; frontend tiết kiệm API (debounce + min 3 ký tự).

**Hạn chế (theo dõi để cải tiến sau):**
1. Chưa cache geocode — mỗi lần gõ là 1 lần gọi; Nominatim public giới hạn
   1 req/s (rủi ro throttle), Goong free tier có quota.
2. Không rate-limit theo IP.
3. "First-wins cứng" — Goong trả kết quả "gần đúng nhưng sai" trong 25 km thì
   nguồn sau không có cơ hội; chưa có scoring hợp nhất.
4. Bán kính tròn 25 km ≠ ranh giới Hà Nội thật (Sơn Tây ~35 km bị loại dù
   thuộc Hà Nội). Có thể thay bằng `ST_Within` trên `core.study_areas.geometry`
   hoặc `gis.administrative_regions` (đã có GIST index, đã import 126 phường).
5. UI chưa hiển thị badge `source` — người dùng không biết kết quả nào là
   số nhà chính xác (Goong) hay landmark ước lượng (local).
6. Goong key nằm trong query string — có thể rò vào access log trung gian.

## 6. Trạng thái trong bản local (sau Task 51)

- Chuỗi Goong → Nominatim → local đã được **port vào
  `mini-services/fastapi-backend/app/services/external.py`** — planner v1
  hưởng luôn tính năng số nhà mà không đổi UI.
- Sandbox chưa có `GOONG_API_KEY` trong env → tự chạy tầng Nominatim
  (đã kiểm chứng: `12 Ngo Quyen Hoan Kiem` → "Bắc Bộ Phủ, 12, Phố Ngô Quyền").
  Muốn bật Goong: thêm `GOONG_API_KEY=<key>` vào env của backend, không cần
  sửa code.
- Khuyến nghị tiếp theo: cache in-memory TTL 10 phút cho geocode (bắt chước
  `_route_cache`), badge nguồn trên dropdown, và ST_Within thay bán kính.
