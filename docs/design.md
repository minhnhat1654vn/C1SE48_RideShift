# RideShift — Tài liệu Thiết kế (Design Specification)

> **Sản phẩm:** RideShift – Cố vấn chuyển đổi giao thông thông minh
> **Nền tảng:** Web (Next.js 16 + Tailwind CSS 4 + shadcn/ui, New York style)
> **Người dùng:** Người dân Hà Nội (tiếng Việt) + Quản trị viên
> **Tài liệu kèm theo:** `architecture.md` (cấu trúc hệ thống) · `db.md` (cấu trúc CSDL) · `figma/` (bộ bản vẽ design kit)

---

## 1. Định hướng thiết kế (Design Direction)

| Hạng mục | Quyết định |
|---|---|
| **Ý tưởng chủ đạo** | "Bản đồ xanh" — toàn bộ trải nghiệm xoay quanh bản đồ Hà Nội, lớp chất lượng không khí dạng *bản đồ thời tiết* và bảng xếp hạng phương tiện xanh |
| **Màu chủ đạo** | Xanh lá emerald (`#00884B`) — biểu thị giao thông xanh, giảm phát thải. Không dùng xanh dương/chàm (indigo/blue) |
| **Ngôn ngữ** | 100% tiếng Việt (UI, thông báo lỗi, dữ liệu mẫu) |
| **Phong cách** | Tối giản, sáng, thẻ bo tròn, viền 1px, bóng nhẹ — theo design system shadcn/ui (New York) |
| **Nền tảng bố cục** | Mobile-first; container `max-w-7xl`; footer luôn bám đáy màn hình (`min-h-screen flex flex-col` + `mt-auto`) |
| **Biểu tượng** | Bộ icon Lucide (`lucide-react`), mặc định nét 2px, kích thước `h-4`–`h-5` |

**Nguyên tắc bắt buộc khi thiết kế thêm màn hình mới:**
1. Bản đồ luôn hiển thị song song với form/kết quả (desktop) hoặc phía trên kết quả (mobile).
2. Lớp không khí phải **mượt như bản đồ thời tiết** — cấm hiển thị ô vuông (grid cell) cứng.
3. Bản đồ bị chặn trong phạm vi Hà Nội (`maxBounds`), chỉ hiện địa phương thuộc Hà Nội.
4. Mọi chuỗi hiển thị là tiếng Việt; số tiền định dạng `vi-VN` + VND.
5. Có trạng thái loading (skeleton/spinner), lỗi (Alert) và rỗng (empty) cho mọi vùng dữ liệu.

---

## 2. Hệ màu (Color Tokens)

Nguồn gốc: biến CSS trong `src/app/globals.css` (định nghĩa chuẩn = giá trị OKLCH). Cột HEX là giá trị quy đổi tương đương để dùng trong Figma/tool đồ họa.

### 2.1 Bảng màu chủ đề (Light theme — mặc định)

| Token | OKLCH (chuẩn) | HEX ~ | Công dụng |
|---|---|---|---|
| `--background` | `oklch(0.985 0.005 150)` | `#F8FBF8` | Nền trang (tint xanh rất nhạt) |
| `--foreground` | `oklch(0.16 0.02 155)` | `#061009` | Chữ chính |
| `--card` | `oklch(1 0 0)` | `#FFFFFF` | Nền thẻ/card |
| `--card-foreground` | = foreground | `#061009` | Chữ trong card |
| `--primary` | `oklch(0.55 0.14 155)` | `#00884B` | Màu thương hiệu: nút chính, logo, tab active, polyline tuyến đường |
| `--primary-foreground` | `oklch(0.985 0.005 150)` | `#F8FBF8` | Chữ trên nền primary |
| `--secondary` | `oklch(0.955 0.02 150)` | `#E7F4E9` | Nút phụ, nền nhấn nhẹ |
| `--muted` | `oklch(0.955 0.012 150)` | `#EBF3EC` | Nền phụ (footer, pill nav, skeleton) |
| `--muted-foreground` | `oklch(0.52 0.02 155)` | `#606D64` | Chữ phụ/nhãn |
| `--accent` | `oklch(0.94 0.045 150)` | `#D7F4DC` | Nền hover, highlight |
| `--accent-foreground` | `oklch(0.28 0.06 155)` | `#09311B` | Chữ trên accent |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `#E7000B` | Lỗi, nút xóa, trạng thái "Cấm" |
| `--border` / `--input` | `oklch(0.9 0.015 150)` | `#D7E1D9` | Viền card, input, divider |
| `--ring` | `oklch(0.6 0.12 155)` | `#389560` | Vòng focus khi bàn phím điều hướng |

### 2.2 Gradient & màu bổ trợ

| Tên | Giá trị | Nơi dùng |
|---|---|---|
| Hero gradient | `linear-gradient(90deg, #ECFDF5 → #F8FBF8 → #F0FDFA)` (emerald-50 → background → teal-50); dark: `emerald-950/30 → background → teal-950/30` | Banner giới thiệu ở trang Planner |
| Viền cảnh báo | `#FE9A00` (amber-500) + nền `#FFFBEB` (amber-50) | Cảnh báo tuân thủ LEZ, tuyến ước lượng |
| Viền bản đồ Hà Nội | `#0F766E` (teal-700), viền ngoài trắng (casing) | Ranh giới thành phố trên bản đồ |
| Điểm trạm quan trắc | Chấm tròn tô màu theo AQI, viền trắng 2px | Lớp trạm trên bản đồ |
| Điểm A/B hành trình | A = `#00884B`, B = đỏ `#E7000B` (marker + nhãn trắng) | Đầu/cuối tuyến |

### 2.3 Bảng màu AQI (lớp chất lượng không khí) — **chuẩn hóa toàn ứng dụng**

Định nghĩa tại `src/lib/aqi-visual.ts`. Không được dùng màu khác cho cùng một băng.

| Băng | Khoảng AQI (US) | Màu | HEX | Nhãn tiếng Việt |
|---|---|---|---|---|
| Tốt | 0–50 | Xanh lá | `#22C55E` | Tốt |
| Trung bình | 51–100 | Vàng | `#FACC15` | Trung bình |
| Kém | 101–150 | Cam | `#F97316` | Kém |
| Xấu | 151–200 | Đỏ | `#EF4444` | Xấu |
| Rất xấu | 201–300 | Tím | `#A855F7` | Rất xấu |
| Nguy hại | >300 | Đỏ sẫm | `#7F1D1D` | Nguy hại |
| Không rõ | — | Xám | `#94A3B8` | Không rõ |

### 2.4 Màu biểu đồ (Admin)

`--chart-1…5` theo thứ tự: `#00884B`, `#57A45B`, `#94AB39`, `#C8AD3F`, `#C65D26` — dùng cho Recharts (pie/bar). Badge phân loại: `banned` = đỏ, `conditional` = vàng (amber), tuân thủ = xanh primary.

### 2.5 Dark theme

Đã định nghĩa bộ token `.dark` (nền tối, primary rút gọn thành trắng xám) qua `next-themes`; chế độ sáng là mặc định sản phẩm.

---

## 3. Typography

| Hạng mục | Giá trị |
|---|---|
| Font chữ | Geist Sans (biến `--font-geist-sans` của Next/font); fallback: Inter, Segoe UI, system-ui |
| Font monospace | Geist Mono (chỉ cho mã/thông số kỹ thuật nếu cần) |
| Tỷ lệ | H1 logo `text-lg` (18px, bold, tracking-tight) · Tiêu đề hero `text-xl` (20px, bold) · Tiêu đề card `text-sm–lg` (semibold) · Nội dung `text-sm` (14px) · Nhãn phụ/legends/footer `text-xs` (12px) · Micro-label `text-[11px]` |
| Trọng số | 400 (body) · 500 (nav/nhãn) · 600 (tiêu đề phụ) · 700 (tiêu đề/logo) |
| Quy tắc số | `toLocaleString('vi-VN')` cho VND; thời gian `HH:mm ngày d/m/yyyy` (múi giờ Asia/Ho_Chi_Minh); ngày trong tuần viết tắt "Th 2 … Th 7, CN" |

---

## 4. Bo góc, bóng, khoảng cách, lưới

| Hạng mục | Giá trị | Ghi chú |
|---|---|---|
| Bán kính gốc | `--radius: 10px` | `rounded-lg` = 10px; `rounded-xl` = 14px (card lớn, logo box); `rounded-2xl` = 16px (hero, map container) |
| Pill | `rounded-full` | Tab chuyển vùng (nav), badge, chip AQI |
| Bóng | `shadow-sm` | Card, logo box, nút primary; không dùng bóng lớn |
| Container | `max-w-7xl`, `px-4` | Cả header/main/footer |
| Khoảng cách card | `p-4`–`p-6`, `gap-4`–`gap-6` | Grid desktop 2 cột `lg:grid-cols-[400px_1fr]` (form 400px + bản đồ chiếm phần còn) |
| Danh sách dài | `max-h-96 overflow-y-auto` | Bảng kết quả, danh sách vùng, trạm… kèm scrollbar mảnh tùy biến |
| Touch target | ≥ 44px | Nút, slider, switch trên mobile |

---

## 5. Iconography (Lucide)

| Icon | Vị trí sử dụng |
|---|---|
| `Leaf` | Logo, footer |
| `MapPinned` / `ShieldCheck` | Tab "Lập kế hoạch" / "Quản trị" |
| `Sprout` | Tiêu đề hero |
| `MapPin`, `Crosshair`, `ArrowUpDown`, `Search` | Ô nhập điểm đi/đến, "vị trí của tôi", nút đổi chiều |
| `Route`, `RefreshCw`, `Loader2`, `TriangleAlert` | Thông tin tuyến, làm mới AQI, trạng thái đang xử lý, cảnh báo |
| `Activity`, `MapPin`, `BookLock`, `SlidersHorizontal`, `LogOut` | Tab admin: Tổng quan / Vùng LEZ / Quy định / Phương tiện & Trọng số; đăng xuất |
| Icon phương tiện (chuỗi trong DB) | `motorbike` (xe máy xăng), `zap` (xe điện), `car` (ô tô), `bus` (buýt), `car-taxi-front` (taxi), `bike` (xe đạp), `footprints` (đi bộ) — ánh xạ `MODE_ICONS` sang Lucide |

---

## 6. Thư viện component (shadcn/ui – New York)

| Component | Nơi sử dụng chính |
|---|---|
| `Button` | "Phân tích hành trình" (primary), "Đổi chiều"/"Làm mới" (outline/ghost), "Tôi sẽ dùng xe này" (primary), nút vẽ vùng (admin) |
| `Card` + Header/Content | Toàn bộ khối nội dung (form, kết quả, KPI) |
| `Input` / `Label` / `Textarea` | Điểm đi/đến, datetime, tên vùng, điều kiện quy định |
| `Select` | Phương tiện, mục đích chuyến đi, chọn vùng khi thêm quy định |
| `Slider` | 4 thanh ưu tiên (Nhanh nhất / Tiết kiệm nhất / Thân thiện môi trường / Tiện nghi) + trọng số admin (0–50) |
| `Switch` | Hiện/ẩn lớp AQI & trạm, hiện điểm giao thông công cộng, bật/tắt vùng/quy định/phương tiện |
| `Alert` | Cảnh báo LEZ (amber), lỗi hệ thống (destructive), tuyến ước lượng (amber) |
| `Badge` | Trạng thái LEZ (Ngoài vùng/Một phần/Trong vùng), nguồn dữ liệu, "Cấm"/"Có điều kiện", "Đã ghi nhận" |
| `Tabs` | Chuyển Planner/Admin (pill tùy biến) + 4 tab admin |
| `Table` | So sánh phương án, bảng chuyến đi, quy định, phương tiện |
| `Dialog` / `AlertDialog` | Thêm quy định; xác nhận xóa vùng/quy định |
| `Skeleton` | Đang tải form/bản đồ/KPI/biểu đồ |
| `Tooltip` / Popup của Leaflet | Mẹo nhanh trên bản đồ (AQI, trạm) |

---

## 7. Đặc tả màn hình

### 7.1 Khung chung
- **Header sticky** (`z-40`, nền mờ `backdrop-blur`): logo vuông 40px nền primary + "Ride**Shift**" ("Shift" tô primary) + tagline 11px; bên phải là pill-nav 2 mục *Lập kế hoạch / Quản trị* — mục active nền primary chữ trắng, mục thường chữ muted.
- **Footer** bám đáy (`mt-auto`): nền `muted/40`, viền trên, 2 dòng chữ 12px — thông tin nhóm C1SE.48 và công bố nguồn dữ liệu (OSM · OSRM · Open-Meteo) + slogan *"Hà Nội trong lành hơn cho ngày mai tốt đẹp hơn"*. Trên iOS có `pb-[env(safe-area-inset-bottom)]`.

### 7.2 Màn Lập kế hoạch (Planner) — người dùng khách
**Desktop:** hero band → grid 2 cột `400px | 1fr` (form | bản đồ) → khối kết quả bên dưới form.

1. **Hero band** (bo góc 16px, gradient xanh nhạt): tiêu đề + đoạn mô tả 14px muted.
2. **Form thẻ (Card)**:
   - "Điểm đi" & "Điểm đến": Input kèm icon `MapPin`, gợi ý địa điểm (geocode) dạng dropdown sau 350ms debounce; nút `Crosshair` "Vị trí của tôi"; nút `ArrowUpDown` đổi chiều 2 địa điểm.
   - "Xe của bạn hiện tại": Select danh sách phương tiện (icon + tên).
   - "Mục đích chuyến đi": Select (Đi làm / Đi học / Mua sắm / Giải trí / Khác).
   - "Thời gian xuất phát": datetime-local, mặc định hiện tại +5 phút.
   - "Ưu tiên của bạn": 4 Slider 0–100 (nhãn + giá trị %).
   - Switch "Hiện điểm giao thông công cộng".
   - Nút primary full-width "Phân tích hành trình" (spinner khi đang chạy).
3. **Bản đồ (Card)**: Leaflet + OSM tiles, khóa viewport trong Hà Nội (minZoom 9, `maxBounds` 20.52–21.43°N / 105.24–106.06°E, fitBounds toàn thành phố khi mở).
   - 2 pill nổi góc trên trái: switch "Mô hình AQI" / "Trạm quan trắc".
   - Chip thời gian cập nhật AQI + nút "Làm mới".
   - Lớp AQI mượt (xem 7.3), markers điểm giao thông (buýt/metro/BRT — chấm màu theo loại), marker A/B, polyline tuyến primary.

### 7.3 Lớp chất lượng không khí kiểu "bản đồ thời tiết" (đặc tả bắt buộc)
- **Kết xuất:** trường màu mượt liên tục (canvas 460px, nội suy IDW từ 528 điểm mẫu trên lưới 24×22 phủ toàn thành phố), bảng màu liên tục xanh→vàng→cam→đỏ; `opacity 0.6`; **cắt đúng theo ranh giới Hà Nội** (polygon Nominatim, cache 30 ngày) — ngoài ranh giới không có màu.
- **Ranh giới:** polyline teal `#0F766E` viền trắng casing.
- **Hover:** vòng highlight trắng + nền màu băng AQI theo con trỏ, tooltip dính: `AQI 150 · Kém`.
- **Click:** popup chi tiết — AQI nội suy + phân loại, PM2.5, PM10, "Cập nhật: HH:mm ngày d/m/yyyy", "Nguồn: mô hình Open-Meteo".
- **Trạm quan trắc:** chấm màu theo AQI, viền trắng; hover tooltip, click popup "Trạm … · AQI …".
- **Legend góc dưới phải:** 6 hàng (ô màu 14px + nhãn + khoảng giá trị), nền trắng 90%, bo 10px.
- **Dữ liệu:** TTL 24h (cập nhật mỗi ngày) + làm mới thủ công.

### 7.4 Khối Kết quả phân tích
1. **TripOverviewCard:** khoảng cách, thời gian, trạng thái LEZ (badge: *Ngoài vùng* xanh nhạt / *Một phần trong vùng LEZ* vàng / *Trong vùng* đỏ + thanh tỷ lệ inside-ratio), dòng "Nguồn định tuyến: OSRM road network"; nếu tuyến ước lượng → Alert vàng "Tuyến đường hiển thị là ước lượng".
2. **ComplianceCard:** cảnh báo cho xe đang chọn (vàng) + danh sách quy định áp dụng (vùng, loại Cấm/Có điều kiện, điều kiện, khung giờ, ngày).
3. **AirQualityCard:** AQI điểm giữa tuyến, badge phân loại màu, PM2.5/PM10, nguồn, cảnh báo dữ liệu cũ nếu có.
4. **RecommendationsPanel:** danh sách xếp hạng TOPSIS — hạng + icon + tên + điểm (thanh progress), thời gian/chi phí/CO₂, nút "Tôi sẽ dùng xe này" (sau khi bấm → badge "Đã ghi nhận"); mở rộng được bảng phân rã 7 tiêu chí (label, giá trị hiển thị, % trọng số, cột đóng góp).
5. **ComparisonTable:** so sánh 4 phương án hàng đầu (thời gian, chi phí, CO₂, LEZ).
6. **ImpactEstimator:** "Xe hiện tại vs phương án tốt nhất" — chênh lệch thời gian/chi phí/phát thải/mức tuân thủ.

### 7.5 Bảng điều khiển Quản trị (Admin)
1. **Login gate** (chưa đăng nhập): card giữa màn — "Đăng nhập quản trị", username/password, hint "Tài khoản demo: admin / admin123".
2. **Header đăng nhập:** "Bảng điều khiển quản trị RideShift" + chip "Đăng nhập với tư cách …" + nút Đăng xuất.
3. **4 tab:**
   - **Tổng quan:** bộ lọc Từ ngày/Đến ngày (Áp dụng/Đặt lại/Làm mới) → 6 thẻ KPI (Chuyến đã phân tích, % bị ảnh hưởng LEZ, Thời gian TB, Chi phí TB VND, % ý định chuyển đổi, Phương án được đề xuất nhiều nhất) → 4 biểu đồ Recharts (pie cơ cấu phương tiện, bar theo quận, bar theo mục đích, bar ý định chuyển đổi) → bảng chuyến gần đây (`max-h-96` scroll, badge LEZ/Đã chuyển đổi).
   - **Vùng LEZ:** trái = danh sách vùng (switch hiệu lực, sửa tên/mô tả inline, xóa có AlertDialog); phải = bản đồ vẽ vùng (click thêm điểm, Hoàn tác/Xóa hết, nhập tên + mô tả, Lưu vùng ≥ 3 điểm).
   - **Quy định chính sách:** bảng quy định (Vùng, Phương tiện, Loại Cấm/Có điều kiện, Điều kiện, Khung giờ, Ngày, Hiệu lực) + Dialog "Thêm quy định" (vùng, phương tiện, loại, điều kiện, 06:00–22:00, 7 chip Th 2–CN).
   - **Phương tiện & Trọng số:** bảng phương tiện (tốc độ, giá khởi điểm, giá/km, CO₂, thời gian chờ, Bật/tắt) + trình chỉnh 7 trọng số (Slider 0–50 + ô số, badge Tổng phải = 100%).

---

## 8. Trạng thái & phản hồi (States)

| Trạng thái | Quy ước |
|---|---|
| Loading | Skeleton (form/KPI/biểu đồ), `Loader2` quay trong nút, placeholder bản đồ nền muted |
| Lỗi trường | Chữ đỏ 12px ngay dưới input + Alert destructive phía trên form |
| Lỗi hệ thống | Alert destructive với thông điệp tiếng Việt đã vi hóa từ server |
| Cảnh báo | Alert vàng (LEZ, tuyến ước lượng, dữ liệu AQI cũ) |
| Rỗng | "Chưa có dữ liệu." (biểu đồ/bảng admin), ẩn nhẹ toàn khối (results chưa phân tích) |
| Thành công | Badge "Đã ghi nhận" sau lựa chọn; thông báo "Đã lưu trọng số…" inline; switch tự cập nhật |
| Disabled | Hàng phương tiện tắt `opacity-50`; nút bấm bị khóa khi thiếu dữ liệu |

---

## 9. Responsive & Accessibility

- **Breakpoints Tailwind:** mobile mặc định (stack dọc: form → bản đồ → kết quả); `md:` bản đồ cao 420px; `lg:` grid 2 cột; admin KPI `sm:grid-cols-2 xl:grid-cols-3`; bảng có wrapper cuộn ngang.
- **Điều khiển bàn phím:** mọi control shadcn hỗ trợ focus; vòng focus `ring` màu `#389560`; Enter submit form đăng nhập.
- **ARIA:** `aria-label` cho nút icon (đổi chiều, sửa, xóa, bật/tắt), `aria-current` cho tab, `aria-hidden` cho icon trang trí, `sr-only` cho cột hành động của bảng.
- **Tương phản:** chữ phụ `#606D64` trên nền trắng đạt ≥ 4.5:1; chữ trên primary trắng `#F8FBF8`.
- **An toàn màn hình notch:** footer có `pb-[env(safe-area-inset-bottom)]`.

---

## 10. Bộ bản vẽ Figma (thư mục `docs/figma/`)

| File | Nội dung | Khung |
|---|---|---|
| `00-user-flow.svg` | **Sơ đồ luồng giao diện**: 2 làn (Người dùng / Quản trị), 4 màn, 14 bước đánh số ①–⑭ — bấm nút nào → mở màn/dialog nào, nhánh điều kiện phiên đăng nhập, luồng lỗi, tác động chéo (admin đổi vùng → planner refresh) | 1680×2060 |
| `01-design-tokens.svg` | Bảng màu (theme + AQI + biểu đồ), typography, bo góc, component mẫu | 1200×1560 |
| `02-planner-desktop.svg` | Trang Planner desktop: header, hero, form, bản đồ AQI mượt, footer | 1440×1160 |
| `03-results-desktop.svg` | Khối kết quả: tổng quan, tuân thủ, AQI, xếp hạng, so sánh, tác động | 1440×1500 |
| `04-aqi-map-mobile.svg` | Bản đồ AQI mobile 390×844: tooltip hover, popup click, legend | 390×844 |
| `05-admin-dashboard.svg` | Admin: tab, bộ lọc, 6 KPI, 4 biểu đồ, bảng chuyến đi | 1440×1240 |
| `06-header-footer.svg` | Component Header (desktop khách/admin + mobile) & Footer (desktop + mobile + safe-area) với đầy đủ thông số kỹ thuật, cấu trúc trang chung | 1440×1080 |
| `07-admin-login.svg` | Màn Đăng nhập quản trị: artboard toàn màn + trạng thái lỗi / đang xử lý + luồng xác thực (cookie 8h) + gắn với bảng AdminUser/AdminSession | 1440×1240 |
| `08-dialogs-popups.svg` | Bộ hộp thoại: dialog chi tiết AQI (thanh băng AQI 6 màu), dialog chi tiết phương án, AlertDialog xác nhận xóa (cascade), 3 loại toast, tooltip hover + quy tắc a11y chung | 1440×1080 |

Cách đưa vào Figma: kéo-thả file `.svg` vào canvas (hoặc File ▸ Open) — mỗi file thành 1 frame với đầy đủ layer nhóm, vector và chữ có thể sửa. Xem chi tiết trong `docs/figma/README.md`.
