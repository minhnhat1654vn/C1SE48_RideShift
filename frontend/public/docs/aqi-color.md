# Lớp màu chất lượng không khí (AQI) trên bản đồ

Tài liệu này giải thích **cách lớp nền màu AQI được tô**: giá trị lấy từ đâu, màu theo chuẩn nào, và vì sao vùng **xa trạm quan trắc** lại nhạt dần — tính theo **km thực địa**, không phải pixel.

---

## Bức tranh tổng thể — 3 lớp quyết định màu bạn thấy

| # | Thành phần | Cách tính | Căn cứ |
|---|------------|-----------|--------|
| 1 | **Giá trị AQI** tại mỗi điểm | Nội suy IDW từ các trạm đo thật | Quy ước ngành GIS/môi trường (IDW, Shepard 1968) |
| 2 | **Màu** tương ứng giá trị | Tra thang VN-AQI 6 mức, nội suy tuyến tính trong băng | **QCVN 05:2023/BTNMT** + QĐ 1456/QĐ-TCMT |
| 3 | **Độ đậm (nhạt dần)** | Suy biến theo khoảng cách tới trạm gần nhất: đậm trong 8 km, mờ dần về 0 ở 45 km | Hằng số cấu hình của dự án (chọn theo mật độ trạm Hà Nội) |

---

## 1. Vùng gần trạm — đọc trực tiếp số đo thật

- Mỗi trút tròn trên bản đồ là **một trạm quan trắc thật** (4 trạm Sở Nông nghiệp & Môi trường Hà Nội + 1 trạm WAQI/UNIS), cập nhật theo chu kỳ.
- Gần trạm, màu nền lấy đúng theo giá trị AQI của trạm đó — không có nội suy nào "làm lệch" số đo.

## 2. Vùng xa trạm — nội suy IDW (Inverse Distance Weighting)

Vấn đề: giữa hai trạm cách nhau ~10–15 km, điểm ở giữa không có số đo. Lớp bản đồ phải **đoán một giá trị hợp lý** cho từng điểm.

Cách đoán (nội suy) là **IDW — "trung bình có trọng số nghịch đảo khoảng cách"**:

```
AQI(điểm) = Σ (wᵢ × AQIᵢ) / Σ (wᵢ)      với      wᵢ = 1 / (dᵢ² + 40)
```

- `dᵢ` = khoảng cách **km thực địa** từ điểm đang tô đến trạm thứ i.
- Trạm **càng gần thì quyền quyết định màu càng lớn** — hợp lý vì ô nhiễm phân rã theo khoảng cách.
- `+40` là số nhỏ chỉ để tránh chia 0 khi đứng đúng tâm trạm.
- Trạm xa hơn **45 km bị bỏ hẳn** (ngoài tầm ảnh hưởng → màu trong suốt).
- Tính bằng **km thực địa (Mercator)**, hoàn toàn **không liên quan pixel**.

**Ví dụ cụ thể** — một điểm cách trạm A (AQI 100) 3 km và trạm B (AQI 60) 9 km:

| Trạm | d (km) | w = 1/(d²+40) | w × AQI |
|------|--------|----------------|---------|
| A | 3 | 1/49 = 0,0204 | 2,04 |
| B | 9 | 1/121 = 0,0083 | 0,50 |
| | | **Σw = 0,0287** | **Σ = 2,54** |

→ AQI nội suy = 2,54 / 0,0287 ≈ **89** — lệch về phía trạm gần hơn (A=100), đúng trực giác.

> **Quy ước này có thật trong ngành**: IDW do Shepard đề xuất năm 1968, là công cụ nội suy tiêu chuẩn trong GIS (ArcGIS, QGIS mặc định dùng IDW với số mũ p = 2 — dự án cũng dùng p = 2). Đây là **quy ước ngành**, không phải chuẩn pháp quy.

## 3. Đổi giá trị thành màu — thang 6 băng VN-AQI

Giá trị AQI được tra vào thang màu 6 mức theo **QCVN 05:2023/BTNMT** và QĐ 1456/QĐ-TCMT (thang VN-AQI):

| Băng AQI | Mức | Màu |
|----------|-----|-----|
| 0–50 | Tốt | Xanh lá |
| 50–100 | Trung bình | Vàng |
| 100–150 | Kém | Cam |
| 150–200 | Xấu | Đỏ |
| 200–300 | Rất xấu | Tím |
| 300+ | Nguy hại | Nâu sẫm |

Trong một băng, màu **nội suy tuyến tính** giữa hai đầu băng (ví dụ AQI 75 = vàng pha cam một nửa) — nhờ vậy không thấy "bậc thang" màu gắt.

> Chuẩn chỉ quy định **thang + màu của 6 mức**. **Không có chuẩn nào quy định cách tô màu vùng không có trạm đo** — đó là lý do phần nội suy (mục 2) và độ đậm (mục 4) là lựa chọn kỹ thuật của nhóm, được ghi rõ tại đây để minh bạch.

## 4. Vì sao màu nhạt dần khi ra xa trạm — theo KM, không phải pixel

Đây là lớp "độ đậm" (độ mờ alpha) chồng lên việc chọn màu:

| Khoảng cách tới **trạm gần nhất** | Độ đậm màu |
|------------------------------------|-------------|
| **≤ 8 km** | Đậm đầy đủ (alpha đỉnh 45%) |
| **8 → 45 km** | Giảm **tuyến tính** từ đậm về 0 |
| **> 45 km** | Trong suốt hoàn toàn |

- **8 km và 45 km là hằng số cấu hình của dự án** (`AQI_FIELD_NEAR_KM` / `AQI_FIELD_RADIUS_KM` trong `map-view.tsx`), chọn theo mật độ trạm Hà Nội — **không phải số theo chuẩn quốc gia**.
- Alpha đỉnh chỉ 0,45 (45%) để lớp màu **không che nền bản đồ** — đường phố, ranh giới vẫn đọc được.
- Nhờ mép mềm tuyến tính, **không bao giờ thấy "hào quang tròn"** quanh trạm — màu chuyển mượt từ trạm ra ngoài.
- Có một **sóng thở rất nhẹ** (±8%, chu kỳ 9 giây) chạy chéo qua trường màu để lớp "sống" — chỉ dao động độ mờ, **không đổi giá trị AQI**.
- Theo zoom: dưới mức 11 lớp tự ẩn (chỉ còn badge trạm), từ 11→12 mờ dần vào để không "cục màu" hiện đột ngột.

## 5. "Bao nhiêu pixel thì màu giảm?" — pixel không phải đơn vị tính

- Ô lưới vẽ 16 px **chỉ là bước render** (vẽ 1 ô rồi phóng bilinear — đủ mượt, nhẹ máy).
- Tỷ lệ quy đổi km↔px **tự thay đổi theo zoom** theo công thức Mercator (`mét/px = 156543 × cos(vĩ độ) / 2^zoom`).
- Toạ độ vẽ được neo vào **map px tuyệt đối** (không phụ thuộc vị trí kéo bản đồ): **cùng một điểm địa lý luôn luôn cùng một màu**, dù bạn pan hay zoom.

## 6. Tóm tắt nhanh (Q&A)

**Hỏi:** Màu lấy từ đâu?
**Đáp:** Trạm quan trắc thật (4 Sở NN&MT Hà Nội + 1 WAQI/UNIS). Gần trạm màu theo số đo, xa trạm mới nội suy.

**Hỏi:** Vùng xa trạm tính kiểu gì?
**Đáp:** IDW số mũ 2: trung bình có trọng số `1/d²`, chỉ dùng trạm trong 45 km — trạm gần "giọng to" hơn.

**Hỏi:** Màu nhạt dần theo bao nhiêu km?
**Đáp:** Đậm đầy đủ trong 8 km quanh trạm gần nhất, giảm dần về 0 ở 45 km (tuyến tính).

**Hỏi:** Có quy ước/chuẩn nào không?
**Đáp:** (1) Thang màu 6 mức VN-AQI theo **QCVN 05:2023/BTNMT** — bắt buộc. (2) Nội suy IDW — quy ước ngành chuẩn (Shepard 1968, mặc định ArcGIS/QGIS với p=2). (3) Hai số 8 km / 45 km — cấu hình riêng của dự án, chọn theo mật độ trạm Hà Nội, được ghi rõ ở đây.
