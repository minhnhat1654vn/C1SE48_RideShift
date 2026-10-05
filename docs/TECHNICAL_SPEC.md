# RideShift — Đặc tả kỹ thuật (Technical Specification)

> Nguồn: *C1SE.48 – PROPOSAL* v1.0 (23/08/2026) — RideShift – Smart Transport Transition Advisor,
> Capstone Project 1 (CMU-SE 450), Duy Tan University.
> Đặc tả này tổng hợp yêu cầu của proposal thành danh sách tính năng cần có, đối chiếu với
> hiện trạng code (khảo sát ngày 04/10/2026). Thuật ngữ dùng theo [GLOSSARY.md](../GLOSSARY.md).

**Chú thích trạng thái:** ✅ đã có trong code · 🟡 có một phần / cần hoàn thiện · ⬜ chưa có — cần xây mới.

---

## 1. Problem Statement (vấn đề, nhìn từ người dùng)

Chính sách Vùng phát thải thấp (LEZ) tại Hà Nội đặt thêm ràng buộc lên chuyến đi:
loại phương tiện, khu vực, khung giờ và điều kiện. Người dân khi lên lộ trình **không biết**:

- lộ trình có đi qua LEZ hay không;
- phương tiện đang dùng có được vào khu vực đó không;
- hạn chế có áp dụng tại thời điểm khởi hành không;
- có lộ trình/phương tiện thay thế phù hợp hơn không;
- phương án thay thế nào cân bằng tốt nhất giữa thời gian, chi phí, tiện lợi và tuân thủ chính sách.

Ứng dụng bản đồ thông thường chỉ lo định hướng — không tích hợp chính sách LEZ.
Cơ quan quản lý cũng thiếu dữ liệu tổng hợp về xu hướng lựa chọn phương tiện và hiệu lực chính sách.

## 2. Solution (giải pháp, nhìn từ người dùng)

RideShift — nền tảng web hỗ trợ **quyết định** (decision-support), không chỉ tìm đường:
người dùng nhập điểm đi — điểm đến — phương tiện hiện có — mục đích — giờ đi (và tuỳ chọn ưu tiên);
hệ thống tính lộ trình, phân tích không gian so với LEZ, đối chiếu quy định theo phương tiện và thời điểm,
rồi **xếp hạng các phương án thay thế** bằng thuật toán đa tiêu chí (TOPSIS) có giải trình được.
Quản trị viên cấu hình vùng + quy định + phương tiện + trọng số, và theo dõi phân tích chuyển dịch phương tiện.

## 3. Đối tượng người dùng

| Vai trò | Đặc điểm | Nhu cầu chính |
|---|---|---|
| **Người dùng khách (Guest)** | Cư dân/lao động di chuyển thường xuyên trong nội đô Hà Nội; **không cần tài khoản**, không lưu dữ liệu cá nhân | Tra lộ trình nhanh, hiểu trạng thái LEZ dễ hiểu, được gợi ý phương án thay thế, so sánh chi phí/thời gian |
| **Quản trị viên (Admin)** | Mô phỏng vai trò cơ quan quản lý đô thị (trong phạm vi capstone) | Quản lý vùng/quy định/phương tiện/trọng số; xem xu hướng, phân tích theo khu vực/mục đích, ý định chuyển đổi |

## 4. Tính năng cần có (Feature List)

### F1 — Bản đồ tương tác & chất lượng không khí (FR-01…FR-07)

Bản đồ Leaflet tương tác hiển thị: vị trí người dùng (khi có quyền), điểm đi, điểm đến,
lộ trình đã tính, ranh giới LEZ, các điểm giao thông công cộng (bus/metro/BRT), và thông tin chất lượng không khí (AQI, PM2.5, PM10, thời điểm đo).

- FR-01 cho phép xác định điểm đi (nhập địa chỉ — geocode, chọn trên bản đồ, dùng vị trí hiện tại).
- FR-02 cho phép xác định điểm đến (như trên).
- FR-03 hiển thị lộ trình đã tính trên bản đồ.
- FR-04 hiển thị ranh giới các Vùng phát thải thấp.
- FR-05 hiển thị các Điểm giao thông công cộng liên quan.
- FR-06 truy vấn và hiển thị thông tin chất lượng không khí (AQI/PM2.5/PM10).
- FR-07 hiển thị dấu thời gian (timestamp) của dữ liệu AQI khi có.

**Trạng thái:** ✅ (geocode qua backend, geolocation trong planner, AQ từ Open-Meteo kèm cache và giá trị nullable + nhãn dự phòng).
Nền bản đồ OpenStreetMap; lớp phường 3D chỉ là nền hiển thị hành chính, không phải thực thể quy định.

### F2 — Tính toán lộ trình (FR-08…FR-10)

- FR-08 tính lộ trình giữa điểm đi và điểm đến (dịch vụ định tuyến OSRM, dữ liệu OpenStreetMap).
- FR-09 xác định quãng đường (km).
- FR-10 ước tính thời gian di chuyển (phút).

**Trạng thái:** ✅ backend gọi OSRM có fallback khi dịch vụ ngoài lỗi (NFR-11/12).
Tự host OSRM là tuỳ chọn triển khai (thư mục `osrm/`), không bắt buộc lúc chạy mặc định.

### F3 — Phân tích không gian LEZ (FR-11, FR-12)

So sánh `Route Geometry × LEZ Polygon` cho ra **Trạng thái không gian** (bộ ba thứ nhất):
`outside` (ngoài vùng) · `partial` (đi ngang qua) · `within` (nằm trong).

- FR-11 xác định lộ trình có giao với LEZ hay không, ở mức nào.
- FR-12 nhận diện các quy định áp dụng cho vùng bị lộ trình đi qua.

**Trạng thái:** ✅ phân tích không gian chạy trong tầng dịch vụ Python/Shapely; khi PostGIS khả dụng,
cột `geom` + chỉ mục GIST được đồng bộ để truy vấn không gian ở tầng DB. Hai chế độ cho cùng kết quả.

### F4 — Kiểm tra phương tiện & chính sách (FR-13…FR-15)

Đối chiếu phương tiện với quy định của các vùng bị đi qua, xét **thời điểm khởi hành** (giờ + ngày trong tuần).
Kết quả là **Trạng thái tuân thủ** (bộ ba thứ hai):
`compliant` (được phép — xanh) · `conditionally_restricted` (hạn chế có điều kiện — vàng) · `not_permitted` (bị cấm — đỏ).

- FR-13 kiểm tra phương tiện đã chọn đối chiếu các hạn chế áp dụng.
- FR-14 hiển thị các điều kiện áp dụng (loại hạn chế, điều kiện, khung giờ, ngày).
- FR-15 cảnh báo người dùng khi tồn tại nguy cơ vi phạm/hạn chế.

**Trạng thái:** ✅ hai bộ ba trạng thái là hai khái niệm riêng — không được trộn lẫn khi hiển thị hay bàn nghiệp vụ.
Phương tiện bị cấm hiển thị thành thẻ cảnh báo, không có rank/điểm/nút chọn.

### F5 — Khuyến nghị đa tiêu chí — MCDM/TOPSIS (Objective 6)

Động cơ khuyến nghị xếp hạng các phương án thay thế (xe máy xăng, xe máy điện, buýt, taxi, xe đạp…)
bằng TOPSIS (Hwang & Yoon 1981) với **7 tiêu chí cố định**:

| Tiêu chí | Nguồn dữ liệu | Loại |
|---|---|---|
| travelTime | OSRM + tốc độ trung bình phương tiện | càng thấp càng tốt |
| cost | Chi phí cơ bản + theo km (VND) | càng thấp càng tốt |
| lezCompliance | Trạng thái tuân thủ → 1.0 / 0.5 / 0.0 | càng cao càng tốt |
| accessibility | Khoảng cách tới Điểm giao thông công cộng gần nhất | càng cao càng tốt |
| convenience | Điểm cơ sở phương tiện, điều chỉnh theo Mục đích chuyến đi | càng cao càng tốt |
| environment | Phát thải CO₂/km + bối cảnh AQI | càng cao càng tốt |
| trend | Xu hướng sử dụng theo tháng từ dữ liệu khảo sát | càng cao càng tốt |

Yêu cầu quy trình (proposal §7.1-3): quy trình 9 bước từ đầu vào người dùng → sinh ứng viên → thu thập tiêu chí
→ chuẩn hoá → áp trọng số → thuật toán MCDM → tính điểm → xếp hạng → sinh khuyến nghị.
Phương pháp, tiêu chí, cách chuẩn hoá, trọng số và cách chấm **phải được tài liệu hoá** — không dùng if/else thủ công.
Người dùng có thể khai báo ưu tiên (nhanh / rẻ / thân thiện môi trường / thoải mái, thang 0–100) điều chỉnh kết quả.

**Trạng thái:** ✅ TOPSIS là một hàm thuần ở backend (numpy); trọng số cấu hình được (F9); giải trình từng tiêu chí
(contributions) trả về cùng kết quả. Điểm chỉ được tính ở backend — frontend chỉ sắp lại thứ tự hiển thị.

### F6 — So sánh các phương án (Objective 7)

Bảng so sánh giữa các phương án theo: thời gian, quãng đường, chi phí ước tính, tuân thủ LEZ,
tính tiếp cận, tính tiện lợi, và điểm khuyến nghị tổng. Giá trị là số thật do hệ thống tính — số trong proposal chỉ mang tính minh hoạ.

**Trạng thái:** ✅ khu vực kết quả hiển thị bảng so sánh + điểm/rank; phương tiện bị cấm nằm ngoài bảng xếp hạng (thẻ cảnh báo riêng).

### F7 — Ước lượng tác động — Impact Estimator (Objective 8)

Tóm tắt **chênh lệch** giữa Phương tiện hiện tại và các phương án thay thế
(thời gian, chi phí, tuân thủ, tiếp cận, tiện lợi, điểm tổng) → nêu rõ phương án được khuyến nghị và vì sao.

**Trạng thái:** ✅ khối "Ước lượng tác động" so sánh phương tiện hiện tại với đề xuất hàng đầu
(khi trùng thì so với phương án kế tiếp), hiển thị delta thời gian, chi phí, phát thải CO₂ và badge tuân thủ.
**ĐÃ CHỐT 04/10: giữ 4 trường hiện trạng** — thỏa và vượt US-12 AC (3 trường); phần lệch với Objective 8
(6 trường) là accepted deviation, giải trình trong báo cáo cuối.

### F8 — Ghi nhận lựa chọn & chuyển dịch (Mode Shift)

Sau khi xem khuyến nghị, người dùng chọn phương tiện thực định đi. Hệ thống ghi lại:
phương tiện hiện tại, phương án khuyến nghị (điểm), phương tiện được chọn, và cờ **chuyển dịch** (được chọn ≠ hiện tại).
Bản ghi chuyến đi được tạo ngay khi phân tích — kể cả khi người dùng không chọn gì (bảo toàn dữ liệu "bỏ qua khuyến nghị").

**Trạng thái:** ✅ đây là mắt xích cho mọi phân tích ý định chuyển đổi (F10) và cho đánh giá hiệu quả chính sách.

### F9 — Dashboard quản trị: quản lý chính sách (Objective 9, §7.1-5)

- CRUD **Vùng phát thải thấp**: thêm/sửa/xóa/kích hoạt, vẽ polygon trên bản đồ (wizard), kiểm tra tọa độ hợp lệ.
- CRUD **Quy định hạn chế**: gắn phương tiện × vùng, loại hạn chế (banned/conditional), điều kiện, khung giờ, ngày.
- Quản lý **Phương tiện**: bật/tắt, tham số tốc độ/chi phí/phát thải/tiếp cận/tiện lợi.
- Quản lý **Trọng số**: 7 tiêu chí, UI validate live, **tổng phải đúng 100%** (backend từ chối nếu lệch).

**Trạng thái:** ✅ toàn bộ qua REST có xác thực; xóa vùng/phương tiện xoá cascade quy định liên quan.

### F10 — Dashboard quản trị: phân tích & KPI (Objective 9, §7.1-5)

Dashboard là giao diện **phân tích chính sách**, không chỉ CRUD. KPI theo proposal:

| KPI | Trạng thái |
|---|---|
| Tổng số chuyến đi đã phân tích | ✅ |
| % lộ trình bị ảnh hưởng bởi LEZ | ✅ |
| Phương tiện được khuyến nghị nhiều nhất | ✅ |
| Thời gian di chuyển trung bình / chi phí ước tính trung bình | ✅ |
| Ý định chuyển đổi phương tiện (% chuyển dịch + phân bố chuyển sang đâu) | ✅ |
| Ưu tiên phương tiện theo khu vực (theo quận) | ✅ |
| Ưu tiên phương tiện theo mục đích chuyến đi | ✅ |
| Theo dõi xu hướng từ dữ liệu khảo sát + chạy lại pipeline | ✅ (kèm bộ lọc thời gian) |

**Trạng thái:** ✅ tổng hợp phía backend bằng pandas; chỉ quản trị viên đã xác thực mới xem được.

### F11 — Pipeline dữ liệu khảo sát (Objective 10, Deliverable #11)

Xử lý bộ dữ liệu khảo sát *Vehicle at Ha Noi Dataset*: làm sạch → chuyển đổi → phân tích mô tả
→ xu hướng lựa chọn phương tiện theo tháng (`share`, `trend_index`) → cấp dữ liệu cho tiêu chí trend,
và phần tổng hợp cho dashboard. Pipeline **tự chạy khi bảng trend trống** lúc khởi động; quản trị viên chạy lại được.

**Trạng thái:** ✅ cơ chế pipeline hoàn chỉnh (pandas); 🟡 **quy mô dữ liệu**: CSV hiện tại ~2.400 mẫu,
trong khi proposal cam kết ">25.000 mẫu" — cần mở rộng/nạp dataset đầy đủ để đạt đúng deliverable.

### F12 — Nền tảng kỹ thuật chung

- **REST API chuẩn hoá** (NFR-19): mọi lỗi non-2xx trả `{ "error": string }` tiếng Việt, tập trung tại một chỗ; tài liệu OpenAPI tự sinh tại `/docs`.
- **Xác thực quản trị** (NFR-07/08): mọi thao tác admin yêu cầu phiên hợp lệ; cookie phiên TTL 8 giờ; mật khẩu băm với pepper.
- **Độ tin cậy dịch vụ ngoài** (NFR-11/12): mọi gọi Nominatim/OSRM/Open-Meteo có User-Agent riêng + timeout; cache AQ trong DB; fallback định tuyến khi OSRM lỗi.
- **Triển khai Docker** (In-Scope #18): compose 3 dịch vụ (frontend :3000, backend :8000, PostgreSQL+PostGIS :5432); schema + seed idempotent tự đảm bảo lúc boot.
- **Kiểm thử** (In-Scope #17, Deliverable #13): unit/integration/system/API/spatial/recommendation testing — **⬜ chưa có test nào trong repo**, xem §8.

## 5. Yêu cầu phi chức năng (NFR-01…NFR-22 — tóm lược đối chiếu)

- **Hiệu năng (NFR-01–03):** thời gian phản hồi API chấp nhận được trong môi trường test; tối ưu chỉ mục PostGIS cho truy vấn không gian (GIST đã tạo khi PostGIS bật); gọi dịch vụ ngoài không chặn chức năng không liên quan. 🟡 cần đo đạc thực tế (Phase 7).
- **Khả dụng (NFR-04–06):** UI dễ hiểu cho người không chuyên; kết quả tuân thủ hiển thị bằng nhãn + giải thích rõ; cảnh báo quan trọng phân biệt thị giác (xanh/vàng/đỏ + thẻ cảnh báo). ✅ (UI tiếng Việt, mobile-first).
- **Bảo mật (NFR-07–10):** xác thực + phân quyền admin; validate đầu vào (Pydantic); chống lỗ hổng web thông dụng. ✅ cơ bản; 🟡 cần review bảo mật có chủ đích trước demo cuối.
- **Tin cậy (NFR-11–13):** xử lý lỗi API ngoài một cách duyên dáng; dùng cache khi phù hợp; lỗi API được log và trình bày không lộ thông tin nhạy cảm. ✅ (fallback + cache + error envelope che chi tiết kỹ thuật).
- **Mở rộng (NFR-14–16):** thêm khu vực địa lý mới, thêm phương tiện mới, quy định cấu hình được thay vì hard-code. ✅ (vùng/phương tiện/quy định/trọng số đều là dữ liệu).
- **Bảo trì (NFR-17–20):** backend chia module rõ ràng (routers/services/db); frontend component hoá; API request/response chuẩn hoá; mã nguồn quản lý bằng Git. ✅.
- **Tương thích (NFR-21–22):** chạy trên trình duyệt hiện đại; hỗ trợ desktop + mobile trong phạm vi dự án. ✅ (Tailwind responsive).

## 6. User Stories

**Bản đồ & môi trường (F1)**
1. Là một người dùng khách, tôi muốn tìm điểm đi bằng cách gõ địa chỉ, chọn trên bản đồ hoặc dùng vị trí hiện tại, để bắt đầu lên kế hoạch chuyến đi nhanh mà không cần biết tọa độ.
2. Là một người dùng khách, tôi muốn tìm điểm đến tương tự như điểm đi, để chỉ định nơi tôi cần tới.
3. Là một người dùng khách, tôi muốn thấy lộ trình được vẽ trên bản đồ, để hình dung quỹ đạo thực tế của chuyến đi.
4. Là một người dùng khách, tôi muốn thấy ranh giới các vùng phát thải thấp trên bản đồ, để biết khu vực nào có hạn chế.
5. Là một người dùng khách, tôi muốn thấy các điểm buýt/metro/BRT trên bản đồ, để đánh giá khả năng dùng phương tiện công cộng.
6. Là một người dùng khách, tôi muốn xem chỉ số AQI và nồng độ PM2.5/PM10 tại khu vực chuyến đi, để cân nhắc sức khoẻ khi chọn phương tiện.
7. Là một người dùng khách, tôi muốn thấy thời điểm đo của dữ liệu AQI, để biết dữ liệu còn mới hay không.
8. Là một người dùng khách, tôi muốn dùng được ứng dụng trên điện thoại, để tra cứu ngay trên đường.

**Lộ trình & LEZ (F2–F4)**
9. Là một người dùng khách, tôi muốn hệ thống tính lộ trình giữa hai điểm, để không phải tự tìm đường.
10. Là một người dùng khách, tôi muốn biết quãng đường và thời gian ước tính của lộ trình, để ước lượng chuyến đi.
11. Là một người dùng khách, tôi muốn biết lộ trình nằm ngoài / đi ngang qua / nằm trong vùng LEZ, để hiểu mức độ ảnh hưởng tới chính tôi.
12. Là một người dùng khách, tôi muốn biết phương tiện tôi đang dùng có bị cấm hay bị hạn chế trong các vùng đó không, xét đúng ngày và khung giờ tôi đi, để tránh vi phạm.
13. Là một người dùng khách, tôi muốn thấy rõ điều kiện cụ thể của từng quy định áp dụng cho tôi, để hiểu vì sao bị hạn chế và làm gì để hợp lệ.
14. Là một người dùng khách, tôi muốn nhận cảnh báo trực quan khi có nguy cơ vi phạm, để không bỏ sót thông tin quan trọng.

**Khuyến nghị & so sánh (F5–F7)**
15. Là một người dùng khách, tôi muốn được xếp hạng các phương án thay thế (xe điện, buýt, taxi, xe đạp…) bằng thuật toán đa tiêu chí minh bạch, để có cơ sở lựa chọn thay vì phỏng đoán.
16. Là một người dùng khách, tôi muốn khai báo ưu tiên (nhanh nhất / rẻ nhất / thân thiện môi trường / thoải mái nhất), để khuyến nghị phản ánh điều tôi quan tâm.
17. Là một người dùng khách, tôi muốn mục đích chuyến đi (đi làm, đi học, mua sắm…) được tính vào độ tiện lợi, vì nhu cầu mỗi loại chuyến đi là khác nhau.
18. Là một người dùng khách, tôi muốn thấy mức đóng góp của từng tiêu chí vào điểm của mỗi phương án, để hiểu vì sao nó được xếp hạng như vậy.
19. Là một người dùng khách, tôi muốn so sánh các phương án trong một bảng thống nhất (thời gian, chi phí, tuân thủ, tiếp cận, tiện lợi, điểm tổng), để quyết định nhanh.
20. Là một người dùng khách, tôi muốn thấy chênh lệch giữa phương án được khuyến nghị và phương tiện hiện tại của tôi, để lượng hoá lợi ích khi chuyển đổi.
21. Là một người dùng khách, tôi muốn phương tiện bị cấm không xuất hiện như một lựa chọn bình thường mà hiện thành cảnh báo riêng, để không chọn nhầm vào phương án không thể đi.

**Ghi nhận lựa chọn (F8)**
22. Là một người dùng khách, tôi muốn ghi nhận phương tiện tôi thực sự chọn sau khi xem khuyến nghị, để đóng góp vào số liệu cộng đồng (mà không cần tài khoản hay thông tin cá nhân).

**Quản trị — chính sách (F9)**
23. Là một quản trị viên, tôi muốn thêm/sửa/xóa vùng phát thải thấp bằng cách vẽ polygon trên bản đồ, để cấu hình chính sách đúng hình trạng thực tế.
24. Là một quản trị viên, tôi muốn bật/tắt vùng mà không xóa hẳn, để tạm ngưng áp dụng khi chính sách thay đổi.
25. Là một quản trị viên, tôi muốn tạo quy định gắn phương tiện với vùng kèm loại hạn chế, điều kiện, khung giờ và ngày áp dụng, để mô hình hoá chính sách LEZ phức tạp.
26. Là một quản trị viên, tôi muốn quản lý danh mục phương tiện cùng các tham số mặc định (tốc độ, chi phí, phát thải, tiếp cận, tiện lợi), để cập nhật khi có phương tiện mới (NFR-15).
27. Là một quản trị viên, tôi muốn điều chỉnh trọng số 7 tiêu chí với ràng buộc tổng 100% được kiểm tra ngay khi nhập, để tinh bộ khuyến nghị mà không sửa code (NFR-16).

**Quản trị — phân tích (F10)**
28. Là một quản trị viên, tôi muốn xem tổng số chuyến đi đã phân tích và % lộ trình bị ảnh hưởng bởi LEZ, để đánh giá độ phủ chính sách.
29. Là một quản trị viên, tôi muốn xem phương tiện được khuyến nghị nhiều nhất và thời gian/chi phí trung bình, để nắm bức tranh tổng thể.
30. Là một quản trị viên, tôi muốn xem % ý định chuyển đổi và phân bố "chuyển sang phương tiện gì", để đo hiệu lực khuyến nghị.
31. Là một quản trị viên, tôi muốn phân tích ưu tiên phương tiện theo quận và theo mục đích chuyến đi, để có chính sách phân khu phù hợp.
32. Là một quản trị viên, tôi muốn chạy lại pipeline dữ liệu khảo sát, để cập nhật xu hướng khi có dữ liệu mới.

**Chất lượng hệ thống (F12, NFR)**
33. Là một người dùng khách, tôi muốn hệ thống vẫn cho kết quả hữu ích khi dịch vụ ngoài (OSRM/AQ) tạm lỗi, để không bị "kẹt trắng màn hình" (NFR-11/12).
34. Là một quản trị viên, tôi muốn đăng nhập an toàn và mọi thao tác quản trị đều yêu cầu phiên hợp lệ, để dữ liệu chính sách không bị sửa trái phép (NFR-07/08).
35. Là một người dùng khách, tôi muốn mọi lỗi đều được thông báo bằng tiếng Việt rõ ràng thay vì lỗi kỹ thuật trần trụi, để hiểu việc cần làm tiếp (NFR-13).
36. Là một thành viên nhóm phát triển, tôi muốn bộ kiểm thử tự động phủ API, thuật toán TOPSIS, phân tích không gian và pipeline dữ liệu, để tự tin thay đổi code mà không phá tính năng (In-Scope #17).

## 7. Implementation Decisions

Các quyết định kiến trúc đã chốt (xem chi tiết trong `AGENTS.md` và `docs/architecture.md`):

1. **Kiến trúc 3 tầng, ranh giới HTTP:** React/Next.js chỉ là tầng hiển thị — không có kết nối DB, không tính điểm; FastAPI nắm toàn bộ nghiệp vụ; PostgreSQL/PostGIS lưu trữ. Frontend gọi backend duy nhất qua một seam `apiFetch` (hỗ trợ deploy chuẩn bằng `NEXT_PUBLIC_API_BASE` và chế độ sandbox gateway).
2. **Backend sở hữu schema:** `schema.sql` idempotent (`CREATE TABLE IF NOT EXISTS`) là nguồn chuẩn, giữ bản copy y hệt cho init container; seed idempotent; pipeline dataset tự chạy khi trống.
3. **Không gian hai chế độ:** tọa độ JSON `[lat,lng]` của vùng là **nguồn chuẩn duy nhất**; cột PostGIS `geometry(Polygon,4326)` + chỉ mục GIST là dẫn xuất, tự tạo/sync khi extension khả dụng — nếu không, phân tích chạy Shapely trong tầng dịch vụ. Hai adapter, một seam.
4. **Chính sách là dữ liệu, không hard-code (NFR-14–16):** vùng, quy định, phương tiện, trọng số đều là bảng cấu hình; thêm khu vực/phương tiện mới không cần đổi code.
5. **TOPSIS duy nhất ở backend:** 7 tiêu chí cố định; `travelTime`/`cost` là cost-criteria; trả về score (0..1), rank và contributions từng tiêu chí để giải trình. Frontend chỉ được sắp lại thứ tự hiển thị — tuyệt đối không tự tính điểm.
6. **Hai bộ ba trạng thái tách bạch:** Trạng thái không gian (outside/partial/within) của *lộ trình vs vùng* và Trạng thái tuân thủ (compliant/conditionally_restricted/not_permitted) của *phương tiện vs các vùng bị đi qua*, quy đổi điểm LEZ 1.0/0.5/0.0.
7. **Error contract tập trung:** mọi non-2xx là `{ "error": string }` tiếng Việt qua các exception handler gom về một chỗ; caller không tự chuẩn hoá lỗi.
8. **Xác thực admin:** mật khẩu băm dạng `SALT$sha256(SALT:password)`; cookie phiên `rs_admin_session`, TTL 8 giờ; mọi endpoint admin yêu cầu phiên hợp lệ. *(Lệch có chủ đích so với mô tả "JWT" trong đơn đăng ký dự án — phiên cookie đơn giản và đủ cho phạm vi prototype.)*
9. **Gọi dịch vụ ngoài kỷ luật:** mọi request Nominatim/OSRM/Open-Meteo có User-Agent mô tả + timeout; AQ được cache trong DB theo khóa toạ độ làm tròn; định tuyến có fallback khi OSRM lỗi.
10. **Vòng đời bản ghi chuyến đi:** tạo ngay khi phân tích (chứa sẵn phương án khuyến nghị + điểm), cập nhật sau khi người dùng chọn; cờ chuyển dịch = được chọn ≠ hiện tại. Tham chiếu phương tiện bằng id logic (không FK cứng) để lịch sử sống sót khi danh mục thay đổi.
11. **Triển khai Docker:** compose 3 dịch vụ; `NEXT_PUBLIC_API_BASE` là build-arg (đổi giá trị phải build lại image frontend).
12. **Ngôn ngữ & UI:** toàn bộ copy tiếng Việt; shadcn/ui + Tailwind; bảng màu xanh lá (emerald); mobile-first; footer dính đáy; danh sách dài cuộn trong khung.

## 8. Testing Decisions

Nguyên tắc: chỉ kiểm **hành vi ngoài** qua seam, không kiểm chi tiết triển khai nội bộ.
Repo hiện **chưa có bộ test nào** — phần này là kế hoạch thiết lập, gắn với In-Scope #17 và Deliverable #13.

**Seams được chọn (tối thiểu, ưu tiên seam hiện có):**

1. **Seam HTTP API (chính)** — `pytest` + FastAPI TestClient trên DB đã seed: hợp đồng endpoint, error envelope `{error}`, tri-state compliance, từ chối trọng số ≠ 100, cascade xóa vùng/quy định, chặn truy cập admin chưa xác thực.
2. **Seam hàm thuần `topsis()`** — test vàng (ma trận quen thuộc → điểm/rank kỳ vọng) + test độ nhạy trọng số (đúng yêu cầu *Recommendation Evaluation*: ranking consistency, sensitivity to weights, so với baseline) + bất biến (tổng trọng số 0 → không chia 0).
3. **Seam phân tích không gian `analyze_route_vs_zones`** — polygon tổng hợp cho đủ 3 trạng thái outside/partial/within và trường hợp tọa độ sai.
4. **Seam pipeline `run_pipeline()`** — CSV fixture → số dòng/hệ số kỳ vọng trong bảng trend.
5. **Tuỳ chọn:** smoke E2E frontend (mở trang → nhập tuyến → thấy kết quả) và Postman collection cho API testing như proposal chỉ định.

Không test component UI ở mức chi tiết render; UI được nghiệm thu qua demo + smoke.

## 9. Out of Scope (loại trừ rõ ràng theo proposal)

Điều khiển giao thông thời gian thực; theo dõi GPS liên tục; điều khiển/khoá phương tiện; chế tài tự động;
xử phạt vi phạm giao thông; xử lý thanh toán; đăng ký phương tiện; xác thực giấy tờ chính thức;
kết nối trực tiếp hệ thống xử phạt của nhà nước; thay thế hệ thống quản lý giao thông nhà nước.
Sản phẩm giữ vai trò **prototype hỗ trợ quyết định**, không phải hệ thống điều hành giao thông chính thức.
(Ngoài ra: người dùng cá nhân không có tài khoản — không có đăng ký/đăng nhập phía guest.)

## 10. Further Notes

**Chênh lệch giữa proposal và hiện trạng — cần quyết định:**

| # | Vấn đề | Chi tiết | Đề xuất |
|---|---|---|---|
| 1 | Quy mô dataset | CSV hiện có ~2.400 mẫu vs cam kết ">25.000 mẫu" của proposal (Deliverable #11) | **CẬP NHẬT Q4 04/10: nạp dataset Kaggle trước GC-S5** (owner assign trong tuần này) — deviation được đóng khi nạp xong |
| 2 | Impact Estimator | Chưa có mô-đun tóm tắt delta so với phương tiện hiện tại (F7) | **ĐÃ CHỐT 04/10: giữ 4 trường hiện có** (thỏa US-12 AC) — Objective 8 là accepted deviation |
| 3 | Auth JWT | Proposal (đơn đăng ký) ghi JWT; thực tế dùng cookie phiên | Giữ cookie phiên, ghi chú vào báo cáo như quyết định thiết kế |
| 4 | Kiểm thử & đánh giá | Chưa có test; Phase 7 (đo hiệu năng, SUS, sensitivity) chưa thực hiện | Ưu tiên 4 seam ở §8 trước khi冻结 code |
| 5 | Air Quality nguồn | Proposal cho phép Open-Meteo *hoặc* OpenAQ — đang dùng Open-Meteo | Không cần thêm; nêu rõ trong báo cáo |

**Bản đồ deliverable (proposal §14) → nơi lưu trữ:** Web app + bản đồ + lộ trình + LEZ + phương tiện + AQ + khuyến nghị + Impact Estimator + dashboard → codebase này; DB PostgreSQL+PostGIS → `schema.sql`/compose; Processed dataset → `backend/data/` + `dataset_trend`; System design docs → `docs/` (architecture, db, ERD); **Testing docs → ⬜ cần tạo** (đầu ra tự nhiên của §8); Report/Slides/Demo → ngoài repo.

**Truy vết nhanh FR → tính năng:** FR-01…07 → F1 · FR-08…10 → F2 · FR-11,12 → F3 · FR-13…15 → F4 · Objective 6 → F5 · Objective 7 → F6 · Objective 8 → F7 · Objective 9 → F9, F10 · Objective 10 → F11.
