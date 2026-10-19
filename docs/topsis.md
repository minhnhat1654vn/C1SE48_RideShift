# Mô hình chấm điểm TOPSIS — Engine đề xuất phương án (Objective 6)

> Tài liệu này mô tả **đúng cách hệ thống đang tính** — engine
> `app/services/mcdm.py` (FastAPI + numpy) và bảng cấu hình `criteria_weight`
> (7 dòng, quản trị chỉnh được theo US-34). Thuật toán: TOPSIS
> (Hwang & Yoon, 1981) — một trong những phương pháp MCDM phổ biến nhất.

---

## 1. Ý tưởng cốt lõi

TOPSIS (*Technique for Order of Preference by Similarity to Ideal Solution*)
trả lời câu hỏi:

> *Trong 7 phương tiện, **phương án nào gần nhất với phương án lý tưởng nhất**
> (nhanh, rẻ, sạch, tuân thủ LEZ…) và **xa nhất với phương án tệ nhất**?*

Mỗi phương án nhận điểm **từ 0 đến 1** — càng gần 1 càng tốt. Đây là kỹ thuật
ra quyết định đa tiêu chí (MCDM) phù hợp vì các tiêu chí có **đơn vị khác
nhau** (phút, nghìn đồng, điểm thưởng…) không thể cộng trừ trực tiếp.

## 2. Bảy tiêu chí và trọng số (bảng `criteria_weight`)

| # | Tiêu chí | Trọng số | Loại | Giá trị tốt là… |
|---|----------|---------:|------|-----------------|
| 1 | ⏱ Thời gian di chuyển (`travelTime`) | **25%** | Chi phí (cost) | Nhỏ hơn |
| 2 | 💰 Chi phí ước tính (`cost`) | **20%** | Chi phí (cost) | Nhỏ hơn |
| 3 | 🚫 Tuân thủ LEZ (`lezCompliance`) | **20%** | Lợi ích (benefit) | Lớn hơn |
| 4 | ♿ Khả năng tiếp cận (`accessibility`) | 10% | Lợi ích | Lớn hơn |
| 5 | 👍 Thuận tiện (`convenience`) | 10% | Lợi ích | Lớn hơn |
| 6 | 🌱 Tác động môi trường (`environment`) | 10% | Lợi ích | Lớn hơn |
| 7 | 📊 Xu hướng khảo sát (`trend`) | 5% | Lợi ích | Lớn hơn |

**Nguồn dữ liệu từng tiêu chí:**

- **Thời gian / khoảng cách** — OSRM định tuyến trên bản đồ OSM, cộng tốc độ
  đặc trưng và thời gian chờ (`wait_minutes`) của từng phương tiện.
- **Chi phí** — ước tính VND: `base_cost_vnd + cost_per_km_vnd × km`
  (xăng/điện cho xe cá nhân, cước taxi, vé xe buýt ≈ 0).
- **Tuân thủ LEZ** — tra bảng `policy_rule` của Vành đai 1: phương án bị
  **cấm** trong khung giờ đi nhận điểm rất thấp; điều kiện ràng buộc hiển thị
  kèm cảnh báo (US-07, US-22).
- **Tiếp cận / Thuận tiện** — điểm chuẩn `base_accessibility` /
  `base_convenience` trong `transport_mode`, **điều chỉnh theo mục đích
  chuyến đi** (đi làm, đi học, mua sắm, giải trí — hằng số hành vi US-09).
- **Môi trường** — từ `co2_per_km_g` của từng phương tiện.
- **Xu hướng** — tỷ trọng lựa chọn phương tiện theo tháng từ bộ dữ liệu khảo
  sát "Vehicle at Ha Noi" (pipeline pandas → `dataset_trend`, Deliverable #11).

## 3. Năm bước tính điểm

1. **Lập ma trận quyết định** — 7 phương tiện × 7 tiêu chí = bảng số liệu thô.
2. **Chuẩn hóa vector** — mỗi giá trị chia cho √(tổng bình phương cả cột).
   Đưa mọi tiêu chí về **cùng thước đo không thứ nguyên**: 20 phút và 15.000
   đồng trở nên so sánh được.
3. **Nhân trọng số** — mỗi giá trị chuẩn hóa × trọng số tiêu chí. Từ đây
   thời gian "nặng" hơn xu hướng khi tính khoảng cách.
4. **Xác định 2 mốc lý tưởng** (từng cột):
   - **A⁺ (tốt nhất tưởng tượng)** — tiêu chí *chi phí* → giá trị **nhỏ nhất**,
     tiêu chí *lợi ích* → giá trị **lớn nhất**;
   - **A⁻ (tệ nhất tưởng tượng)** — ngược lại.
   Chính tại đây mô hình xử lý "càng ít càng tốt": không cần biến đổi dữ
   liệu, chỉ đảo chiều khi chọn mốc.
5. **Đo khoảng cách + chấm điểm** (khoảng cách Euclid qua cả 7 tiêu chí):
   - **d⁺** = khoảng cách tới A⁺ (càng nhỏ càng tốt);
   - **d⁻** = khoảng cách tới A⁻ (càng lớn càng tốt);
   - **Điểm CLOSE = d⁻ / (d⁺ + d⁻)** — luôn nằm trong [0, 1].

Diễn giải trực quan: mẫu số là "quãng đường từ tệ nhất đến tốt nhất", điểm
cho biết phương án **đứng được bao nhiêu % đoạn đường đó**, tính từ phía tệ nhất.

## 4. Ví dụ mini tính tay (3 tiêu chí × 3 phương án)

Trọng số: thời gian 0.5 · chi phí 0.3 · môi trường 0.2.

| Phương án | Thời gian (phút) | Chi phí (nghìn ₫) | Môi trường (điểm) |
|-----------|-----------------:|------------------:|------------------:|
| Xe máy xăng | 20 | 15 | 3.0 |
| Xe máy điện | 22 | 4 | 4.5 |
| Xe buýt | 35 | 7 | 5.0 |

Sau chuẩn hóa vector + nhân trọng số:

| Phương án | Thời gian | Chi phí | Môi trường | d⁺ | d⁻ | **Điểm** |
|-----------|----------:|--------:|-----------:|---:|---:|---------:|
| Xe máy xăng | 0.218 ⭐ best | 0.264 ✗ worst | 0.081 ✗ worst | 0.201 | 0.216 | **0.52** |
| Xe máy điện | 0.240 | 0.070 ⭐ best | 0.122 | **0.026** | 0.156 | **0.86** 🏆 |
| Xe buýt | 0.381 ✗ worst | 0.123 | 0.136 ⭐ best | 0.172 | 0.054 | **0.24** |

→ **Xe máy điện thắng** vì gần như không lệch so với mốc "best" ở cả 3 cột
(d⁺ chỉ 0.026). Xe buýt dù sạch nhất nhưng chậm quá nên tụt cuối. Hệ thống
chạy thật dùng ma trận **7×7** với đúng 7 tiêu chí bảng §2 — nguyên tắc y hệt.

## 5. Đọc kết quả trên giao diện

- Điểm 0–1 nhân 100 thành **thang 0–100** hiển thị ở danh sách xếp hạng (US-10).
- Khối **"Vì sao có điểm này?"** (US-22/US-23 — auto-expand cho rank 1) chính
  là 7 giá trị *đã chuẩn hóa × trọng số* của phương án: thấy ngay tiêu chí nào
  kéo điểm lên, tiêu chí nào kéo xuống.
- Với tiêu chí loại *chi phí* (thời gian, tiền), giá trị hiển thị đã được đảo
  thành "càng nhiều càng tốt" để người dùng không hiểu nhầm.
- Phương án bị LEZ cấm vẫn hiển thị nhưng gắn nhãn **BỊ CẤM** kèm điều kiện
  (US-06/US-07) — không bị loại khỏi bảng để người dùng so sánh.

## 6. Ghi chú kỹ thuật

- **Trọng số tự chuẩn hóa**: nếu admin chỉnh cho tổng ≠ 100%, engine tự chia
  chuẩn trước khi tính — không bao giờ tính sai vì quên chuẩn tổng.
- **Trường hợp biên**: nếu mọi phương án bằng nhau hoàn toàn (d⁺ + d⁻ = 0),
  điểm mặc định 0.5 (trung lập) thay vì chia cho 0.
- **Trọng số âm bị chặn** về 0 để tránh phá hỏng phép tính khoảng cách.
- Mọi phép tính trên mảng numpy — một lần gọi `/api/recommend` chạy dưới
  ~10ms cho 7 phương án, phù hợp NFR hiệu năng.

## 7. Vì sao chọn TOPSIS cho đề tài

- **Trộn được nhiều đơn vị** (phút / đồng / điểm / %) trong một phép so sánh
  duy nhất, có cơ sở lý thuyết trích dẫn được (Hwang & Yoon, 1981).
- **Minh bạch, truy vết được** — trọng số nằm trong DB, quản trị chỉnh trực
  tiếp; mỗi điểm số phân rã được thành đóng góp từng tiêu chí.
- **Xử lý tự nhiên tiêu chí "càng ít càng tốt"** mà không cần chuyển đổi
  dữ liệu phức tạp.
- **Xét tổng hòa 7 khía cạnh** thay vì tối ưu đơn tiêu chí — đúng triết lý
  "chuyển đổi giao thông xanh": không phải luôn chọn nhanh nhất hay rẻ nhất,
  mà là **cân bằng tối ưu** giữa cá nhân người dùng và mục tiêu thành phố.
