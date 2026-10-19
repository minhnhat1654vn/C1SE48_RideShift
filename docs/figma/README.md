# RideShift — Bộ bản vẽ thiết kế cho Figma

Thư mục này chứa **bộ design kit RideShift** chuẩn bị sẵn để đưa vào Figma — gồm cả **sơ đồ luồng giao diện** (bấm nút nào → mở màn nào).

## 1. Danh sách file

| File | Khung (px) | Nội dung |
|---|---|---|
| `00-user-flow.svg` | 1680×2060 | **SƠ ĐỒ LUỒNG GIAO DIỆN (xem đầu tiên):** 2 làn song song — Người dùng (khách) & Quản trị viên; 4 màn hình (Planner → Kết quả; Đăng nhập → Dashboard 4 tab); 14 bước đánh số ①–⑭ với mũi tên “bấm nút này → sang màn này”; nhánh điều kiện phiên đăng nhập (diamond); luồng lỗi (đỏ), nhánh chưa có phiên (hổ phách), tác động chéo (admin đổi vùng → planner refresh); chú giải đầy đủ + trình tự sử dụng |
| `01-design-tokens.svg` | 1200×1560 | Bảng màu chủ đề (light), bảng màu AQI 6 băng, màu biểu đồ, typography, bo góc, nút/badge, form controls, legend |
| `02-planner-desktop.svg` | 1440×1110 | Màn chính: header, hero, form lập kế hoạch (gợi ý địa điểm, ưu tiên), bản đồ AQI mượt + ranh giới Hà Nội, footer |
| `03-results-desktop.svg` | 1440×1180 | Khối kết quả: tổng quan tuyến, tuân thủ LEZ, chất lượng không khí, xếp hạng TOPSIS (mở rộng tiêu chí), bảng so sánh, tác động chuyển đổi |
| `04-aqi-map-mobile.svg` | 390×844 | Bản đồ AQI mobile: tooltip khi hover (`AQI 150 · Kém`), bottom sheet chi tiết khi click, legend, pills bật/tắt lớp |
| `05-admin-dashboard.svg` | 1440×1240 | Quản trị: tab, bộ lọc ngày, 6 KPI, 4 biểu đồ, bảng chuyến gần đây |
| `06-header-footer.svg` | 1440×1080 | **Component Header & Footer:** header desktop (khách / đã đăng nhập), header mobile 2 dòng, footer desktop + mobile (safe-area); thông số kỹ thuật đầy đủ (sticky, backdrop-blur, nav pill, touch target 44px); sơ đồ cấu trúc trang chung (header–main–footer mt-auto) |
| `07-admin-login.svg` | 1440×1240 | **Màn Đăng nhập quản trị:** artboard toàn màn hình (header + card giữa + footer); trạng thái lỗi (alert đỏ 401), trạng thái đang xử lý (spinner); luồng xác thực 4 bước POST /api/admin/login → sha256+salt → cookie `rs_admin_session` 8h → Dashboard; gắn với bảng AdminUser/AdminSession |
| `08-dialogs-popups.svg` | 1440×1080 | **Bộ hộp thoại:** dialog chi tiết AQI (số to + thanh băng 6 màu + thông số PM2.5/PM10/O₃/NO₂ + khuyến nghị), dialog chi tiết phương án (điểm TOPSIS, 4 ô số liệu, ưu/nhược, nút chọn), AlertDialog xác nhận xóa vùng (cảnh báo cascade), 3 loại toast (thành công/lỗi/thông tin), tooltip hover + quy tắc a11y chung cho mọi dialog |

> Đề xuất đọc theo thứ tự: `00-user-flow` (nắm luồng) → `01-design-tokens` (hệ màu/chữ) → `02→03→05` (màn chính) → `06→07→08` (component & hộp thoại) → `04` (mobile).

## 2. Cách đưa vào Figma

**Cách 1 — Kéo thả trực tiếp (nhanh nhất):**
1. Mở file Figma (hoặc tạo file mới).
2. Kéo file `.svg` từ thư mục này thả vào canvas → mỗi file thành 1 frame với đầy đủ nhóm layer, vector, gradient, blur và **text có thể sửa**.
3. Lặp lại cho 9 file, sau đó sắp xếp: đặt `00-user-flow` riêng một page tên `User Flow`, các màn hình vào page `RideShift Screens`, component vào page `Components`.

**Cách 2 — Menu:** `File ▸ Open…` (hoặc `File ▸ Place image/SVG`) rồi chọn file `.svg`.

**Cách 3 — Từ app thật (độ chính xác 100%):** cài plugin miễn phí **html.to.design** trong Figma, dán URL preview của ứng dụng RideShift → plugin chuyển trang đang chạy thành layers Figma (hữu ích khi cần bản vẽ khớp từng pixel với code).

## 3. Vì sao không phải file `.fig`?

Định dạng `.fig` là **định dạng nhị phân riêng tư của Figma** — chỉ chính Figma xuất được (File ▸ Save local copy), không có công cụ/lib công khai nào tạo file `.fig` hợp lệ từ đầu. Con đường chuẩn để đưa thiết kế ngoài vào Figma chính là **import SVG** (Figma nhập SVG giữ nguyên vector + text + gradient + layer blur), đó là lý do bộ kit này được đóng gói dưới dạng SVG.

Nếu bạn cần file `.fig` thật: mở các SVG này trong Figma theo bước trên → `File ▸ Save local copy (.fig)` — sẽ ra file `.fig` chuẩn để lưu trữ/chia sẻ.

## 4. Ghi chú kỹ thuật của bộ kit

- Màu lấy **trực tiếp từ token OKLCH** trong `src/app/globals.css` (quy đổi HEX chính xác) — xem `docs/design.md` §2 để đối chiếu.
- Path ranh giới Hà Nội trong các bản đồ là hình khối mượt mô phỏng đúng tỷ lệ bbox thành phố (105.28–106.03°E, 20.55–21.40°N); bản thật chạy từ polygon Nominatim (xem `docs/architecture.md` §5.2).
- Hiệu ứng "bản đồ thời tiết" dùng `feGaussianBlur` + clip path — khi import vào Figma sẽ thành **Layer blur** + frame clip content, giữ được cảm giác chuyển sắc mềm như app thật.
- Sơ đồ luồng (`00-user-flow.svg`) dùng 5 loại mũi tên phân biệt màu/hình thức (điều hướng / hệ thống / chéo luồng / lỗi / điều kiện) + số bước ①–⑭ — khớp 1:1 với hành vi code thật (`src/app/page.tsx`, `components/rideshift/*`, `lib/auth.ts`).
- Font mặc định: Inter (fallback Segoe UI / system). App thật dùng Geist Sans — trong Figma có thể swap sang Inter Variable hoặc Geist từ Google Fonts.
- Tất cả text là text layer thật (không bị phẳng thành đường nét) — sửa nội dung tiếng Việt trực tiếp trong Figma.
