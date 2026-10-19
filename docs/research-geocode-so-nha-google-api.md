# Nghiên cứu bổ sung: Tra cứu số nhà bằng Google Maps Platform (2026)

> Task 51-c — nối tiếp `docs/research-geocode-so-nha.md` (Task 51, chuỗi
> Goong → Nominatim → local). Tài liệu này đánh giá việc **thêm Google Maps
> Platform** làm nguồn tra cứu số nhà cho điểm đi/đến của RideShift
> (C1SE.48, LEZ Hà Nội). Ngày truy vấn nguồn: **17/10/2026**.

## 1. Mục đích & phạm vi

- Bài toán: người dùng gõ địa chỉ tới **số nhà + phố + phường** (vd
  "12 Ngô Quyền, Hoàn Kiếm") và nhận đúng toạ độ mép nhà — không dừng ở tâm
  phường như Nominatim.
- Phạm vi tài liệu: (1) xác thực lại hiện trạng code, (2) bảng SKU + giá
  Google Maps Platform 2026 kèm nguồn, (3) cơ chế session token, (4) trạng
  thái Places API (legacy), (5) so sánh chất lượng địa chỉ VN, (6) ước tính
  chi phí demo, (7) kiến trúc tích hợp + sketch code, (8) khuyến nghị.
- KHÔNG sửa code — chỉ nghiên cứu. Chuỗi geocode hiện tại tiếp tục là mặc định.

## 2. Hiện trạng RideShift (đối chiếu code 17/10/2026)

- **Backend local** `mini-services/fastapi-backend/app/routers/public.py:81-88`:
  `GET /api/geocode?q=` — chặn query < 2 ký tự, gọi
  `external.geocode_address(q)`, trả `{"results": [...]}` (contract v1 giữ nguyên).
- **Chuỗi 3 tầng** `app/services/external.py:138-171` — "nguồn đầu non-empty thắng":
  1. Goong `_goong_geocode` (external.py:97-135): dùng env `GOONG_API_KEY`
     (external.py:106 — thiếu key → `[]` ngay, không gọi mạng); parse
     `results[]` của `rsapi.goong.io/v2/geocode`; lọc bán kính 25 km quanh
     `STUDY_CENTER` (21.0285, 105.8542) rồi sort gần nhất (external.py:128-133).
  2. Nominatim: `countrycodes=vn`, `viewbox=105.60,21.18,106.05,20.70`,
     `bounded=1`, `limit=6`, UA bắt buộc (external.py:149-167).
  3. Local: 28 địa danh Hà Nội hard-code (external.py:58-87).
- **Frontend** `src/components/rideshift/planner.tsx:297-335`: debounce
  **350 ms**, tối thiểu **2 ký tự**, gọi `/api/geocode?q=` qua `apiFetch`,
  parse `data.results ?? []`, dropdown gợi ý → `pick()` đặt `{lat,lng,name}`.
  Proxy Next.js: `src/app/api/geocode/route.ts:6-18`.
  Type `GeocodeResult` `src/lib/external.ts:9-14`: `source: 'external'|'local'`
  (chưa có giá trị `'google'` — cần mở rộng khi tích hợp).
- **Bản nhóm trên GitHub**: `frontend/src/components/rideshift/planner-v2.tsx:56-104`
  (component `GeoSearch` — debounce 300 ms, min 3 ký tự, `slice(0,5)`, chịu cả
  mảng trần lẫn `{results:[]}`); `backend/app/routers/public.py:30-37` cùng
  contract; `backend/app/services/external.py:97-144` cùng chuỗi Goong.
- Điểm yếu đã ghi nhận ở tài liệu Goong (hạn chế 1-6) giữ nguyên hiệu lực:
  chưa cache, chưa rate-limit, first-wins cứng, bán kính 25 km ≠ ranh giới
  Hà Nội, chưa có badge nguồn, key trong query string.

## 3. Google Maps Platform 2026 — SKU, giá, free tier

Nguồn chính: trang giá chính thức `developers.google.com/maps/billing-and-pricing/pricing`
(cào trực tiếp ngày 17/10/2026). Mô hình free tier mới hiệu lực **01/03/2025**:
không còn credit $200/tháng dùng chung — **mỗi SKU có free cap hàng tháng riêng**
(`developers.google.com/maps/billing-and-pricing/march-2025` + `/faq`).

| SKU (Places API New / Geocoding) | Free cap/tháng | Giá/1000 call theo bậc (0–100k → 100–500k → 500k–1M → 1–5M → 5M+) | Ghi chú |
|---|---|---|---|
| Autocomplete Requests | 10.000 | $2.83 → $2.27 → $1.70 → $0.85 → $0.21 | Tính theo từng request; session dở dang/lãng quên về SKU này |
| Autocomplete Session Usage | **Không giới hạn** | $0 | Phần request 13+ trong session; hoặc toàn bộ nếu kết thúc bằng PD Pro/Enterprise |
| Geocoding API | 10.000 | $5.00 → $4.00 → $3.00 → $1.50 → $0.38 | Geocode "thuần" 1 request 1 địa chỉ (mô hình Goong hiện dùng) |
| Place Details Essentials (IDs Only) | **Không giới hạn** | $0 | Chỉ trả place_id — KHÔNG kết thúc được session giá rẻ (xem §3.1) |
| Place Details Essentials | 10.000 | $5.00 → $4.00 → $3.00 → $1.50 → $0.38 | Kết thúc session chuẩn; trả basic fields |
| Place Details Pro | 5.000 | $17.00 → $13.60 → $10.20 → $5.10 → $1.28 | Toàn bộ autocomplete trong session thành $0 nếu kết thúc bằng SKU này |
| Text Search Essentials (IDs Only) | **Không giới hạn** | $0 | | 
| Text Search Pro | 5.000 | $32.00 → $25.60 → $19.20 → $9.60 → $2.40 | Tìm kiếm văn bản phóng khoáng hơn autocomplete |
| Nearby Search Pro | 5.000 | $32.00 → … | (tham khảo) |

Ghi chú: khách hàng mới được **$300 trial credit** (`mapsplatform.google.com/pricing`);
ngoài pay-as-you-go còn có gói subscription theo tầng Essentials/Pro/Enterprise.
Con số trên là pay-as-you-go — "(nên soi lại bảng giá live trước khi bật production)".

### 3.1 Cơ chế session token (nguồn: `.../places/web-service/session-pricing`, cào 17/10/2026)

- Session bắt đầu ở request Autocomplete (New) đầu tiên **kèm session token**
  (UUID tự sinh mỗi phiên nhập), tiếp tục qua các request gõ tiếp theo, và
  **kết thúc bằng Place Details (New) hoặc Address Validation dùng cùng token**.
- **Kết thúc bằng Place Details Essentials**: 12 request Autocomplete đầu tính
  giá `Autocomplete Requests` ($2.83/1000); từ request 13 trở đi miễn phí
  (`Autocomplete Session Usage`); request kết thúc tính Place Details Essentials.
- ⚠️ Bẫy: kết thúc bằng **Place Details Essentials (IDs Only)** (SKU $0) thì
  TOÀN BỘ autocomplete trong session bị quay lại tính theo request — session
  vô nghĩa. Phải kết thúc bằng PD Essentials (có fields) nếu muốn chi phí thấp.
- **Session dở dang / bỏ dở**: mọi autocomplete request bị tính per-request
  ($2.83/1000). Token hết hạn mà vẫn dùng → tính như không có token.
- Kết thúc bằng PD Pro/Enterprise/Address Validation: toàn bộ autocomplete $0
  nhưng request kết thúc đắt ($17+). Không hợp lý cho demo của nhóm.
- Tham số hộp giới hạn gợi ý: Autocomplete (New) REST có
  `locationRestriction` (rectangle) + `includedRegionCodes: ["vn"]`
  (`components=country:vn` legacy) — "(kiểm tra tên field chính xác trên
  reference Autocomplete (New) khi làm)".

### 3.2 Trạng thái Places API (legacy)

- **01/03/2025** (chắc chắn): legacy Places/Directions/Distance Matrix **ngừng
  cấp cho dự án mới**, ngừng cập nhật tính năng; $200 credit thay bằng free
  cap theo SKU (`cloudfresh.com/en/blog/google-maps-platform-changes-2025`;
  `sharetribe.com` help; `developers.google.com/maps/billing-and-pricing/march-2025`).
- **05/10/2026** (nguồn thứ cấp): Legacy Places, Directions, Distance Matrix
  chính thức **discontinued** — `masterconcept.ai` (đối tác Google Cloud,
  06/10/2026) và khớp dòng "Beginning October 5, 2026…" trong Google Cloud
  release notes. Bảng giá legacy vẫn hiển thị trên trang giá (tính toán
  thời kỳ chuyển tiếp). **→ Kết luận kỹ thuật: TUYỆT ĐỐI dùng Places API (New),
  không đụng legacy dù code mẫu cũ trên mạng tràn legacy.**
  "(Mốc 05/10/2026 cần đối chiếu chính thức tại developers.google.com/maps/deprecations)".

## 4. Chất lượng địa chỉ Việt Nam: Google vs Goong vs Nominatim

| Tiêu chí | Google Maps Platform | Goong | Nominatim (OSM) |
|---|---|---|---|
| Độ phủ số nhà Hà Nội | Tốt ở phố lớn; ngõ nhỏ/ngách số kiểu "Ngõ 12 phố X" không đều (quan sát phổ biến — cần kiểm chứng trên dữ liệu thật) | Tốt nhất cho kiểu địa chỉ VN (số nhà, ngõ, ngách; dữ liệu nội địa hóa) | Yếu số nhà; tốt ở mức phường/phố (Task 51 kiểm chứng) |
| Parse tiếng Việt có dấu, thứ tự ngược | Tốt (dấu, viết tắt Q./P., không dấu đều hiểu) | Rất tốt — thiết kế cho VN | Trung bình; chịu không dấu nhưng hay match sai tỉnh khác |
| Autocomplete UX (gợi ý từng ký tự) | Có (Autocomplete New + session pricing) | Có (docs.goong.io/help — cũng dùng session token) | Không chính thức (public API 1 req/s, chống autocomplete) |
| Giá geocode 1 call | $5.00/1000 (sau 10k free) | $3.50/1000 + tặng $100 khi đăng ký | Miễn phí (chính sách fair-use 1 req/s) |
| Giá autocomplete | $2.83/1000 (sau 10k free) | $1.40/1000 (goong.io/bang-gia) | — |
| Quota/ổn định | SLA thương mại, quota theo project | 5 req/s (180/phút) theo trang giá; server VN | Public instance dễ bị throttle khi demo nhiều người |
| Đụng ToS/bảo mật | Key phải giấu backend + restrict; cache toạ độ ≤ 30 ngày | Key env như hiện tại | UA + viewbox, không cache quá mức |
| Phù hợp demo capstone | Thừa — nhưng quen thuộc, dễ "cho hội đồng xem" | Đủ và rẻ, đã tích hợp sẵn | Đã là fallback, không đủ số nhà |

Nguồn chất lượng VN: `gogoduk.com/blog/map-api-viet-nam-tot-nhat` (29/05/2026,
so sánh Google/Goong về địa chỉ VN + admin boundary); `track-asia.com` Top 10
Maps API cho Việt Nam (15/09/2025 — Google "mạnh hệ sinh thái nhưng đắt, lưu ý
thay đổi chính sách tại VN từ 2022"); `goong.io` (định vị "thay thế Google APIs"
cho VN). Kinh nghiệm nội bộ: commit df75b90 của nhóm kiểm chứng Goong đúng số
nhà "12 Ngo Quyen Hoan Kiem".

## 5. Ước tính chi phí cho demo capstone

Giả định: 1 "phiên tra cứu" = người dùng gõ 1 ô (điểm đi HOẶC điểm đến) chọn
1 gợi ý = ~8 request Autocomplete + 1 Place Details (Essentials). Kịch bản demo
200–500 tra cứu/ngày × 30 ngày:

| Kịch bản | Autocomplete call/tháng | Place Details/tháng | Chi phí Google/tháng (pay-as-you-go) |
|---|---|---|---|
| Nhẹ 200 phiên/ngày | 48.000 | 6.000 | AC: 10k free → 38k×$2.83 = **$107.5**; PD ≤ free cap → **tổng ~$107.5** |
| Cao 500 phiên/ngày | 120.000 | 15.000 | AC: 110k×$2.83 = $311.3 + PD: 5k×$5 = $25 → **tổng ~$336** |
| Nhẹ + geocode thuần (không autocomplete, mô hình Goong hiện tại) | — | 6.000 Geocoding | ≤ 10k free → **$0** |
| Cao + geocode thuần | — | 15.000 Geocoding | 5k×$5 = **$25** |

- So với **Goong**: geocode thuần $3.50/1000 → 15k call = $52.5/tháng nhưng có
  **$100 gift không hết hạn** + free tier ~30k truy vấn/tháng theo trang giá
  → **thực tế demo ~$0**. Autocomplete Goong $1.40/1000 → 120k = $168/tháng
  (Google: $336 — Goong rẻ ~50%).
- **Session token + debounce + cache TTL 30 ngày** (ToS cho phép cache toạ độ
  tối đa 30 ngày — Service Specific Terms, cloud.google.com/maps-platform/terms/maps-service-terms)
  là 3 đòn bẩy giữ chi phí gần $0: cache trùng địa chỉ không phát sinh call.
- $300 trial credit của khách hàng mới đủ phủ cả kịch bản cao (~1 tháng demo).

## 6. Kiến trúc tích hợp đề xuất cho RideShift

1. **Backend proxy** (không bao giờ key ra trình duyệt — Google API Security
   Best Practices + rules.md §1.2): endpoint mới
   `GET /api/geocode/google?q=&session=` trong `public.py`; key từ env
   `GOOGLE_MAPS_API_KEY` (thiếu → trả `[]`, tự rơi xuống chuỗi cũ).
2. **Fallback chain mới**: Google → Goong → Nominatim → local (chèn Google
   ĐẦU chuỗi trong `geocode_address`, external.py:138-171) — hoặc giữ Goong
   đầu và Google là opt-in qua env, quyết định ở §8.
3. **Session token**: frontend sinh `crypto.randomUUID()` mỗi lần bắt đầu gõ
   1 ô; truyền `&session=` cho proxy; khi user chọn gợi ý → proxy gọi
   **Place Details Essentials (có fields, KHÔNG dùng IDs-only)** với cùng
   token để đóng session; sau đó xoá token.
4. **Giới hạn địa lý**: `locationRestriction` bbox Hà Nội ~20.80–21.15 /
   105.70–106.05 + `includedRegionCodes: ["vn"]`; server lọc thêm
   `ST_Within(geometry)` trên `gis.administrative_regions` (thay bán kính
   25 km — hạn chế 4 của tài liệu Goong).
5. **Cache**: bảng đề xuất `decision.geocode_cache(query_norm PK, lat, lng,
   display_name, source, fetched_at)` — TTL 30 ngày đúng ToS Google; hit cache
   → không gọi Google/Goong (giảm 60–80% call khi demo lặp địa chỉ quen).
6. **Không phá contract**: trả đúng shape `{name, lat, lng, source:"google"}`;
   có thể thêm field `placeId` (frontend cũ bỏ qua field lạ, an toàn); UI v1
   (`planner.tsx`) không cần đổi gì để hưởng kết quả tốt hơn.

## 7. Sketch code

FastAPI (thêm vào `services/external.py` + `routers/public.py`, ~30 dòng):

```python
import uuid
def google_autocomplete(q: str, session: str) -> list[GeocodeResult]:
    if not config.GOOGLE_MAPS_API_KEY: return []          # env, không commit
    r = http().post(                                       # Places API (New) dùng POST
        "https://places.googleapis.com/v1/places:autocomplete",
        headers={"X-Goog-Api-Key": config.GOOGLE_MAPS_API_KEY},
        json={"input": q, "sessionToken": session,          # TODO điền đúng field name
              "includedRegionCodes": ["vn"],
              "locationRestriction": {"rectangle": {"low":  {"latitude": 20.80, "longitude": 105.70},
                                                    "high": {"latitude": 21.15, "longitude": 106.05}}}},
    )
    # TODO: 200? parse suggestions[].placePrediction.{placeId, text.text} →
    # lọc ST_Within Hanoi, map {"name": text, "lat","lng": None} — chú ý
    # autocomplete KHÔNG trả toạ độ; toạ độ lấy ở Place Details khi user chọn.
```

Frontend hook (~25 dòng, đặt cạnh `planner.tsx:297`):

```ts
const sessionId = useRef(crypto.randomUUID())              // 1 phiên nhập = 1 UUID
// trong fetchSuggestions: gọi /api/geocode/google?q=&session=sessionId.current
// debounce 350ms giữ nguyên; khi pick(): gọi endpoint đóng session
//   POST /api/geocode/google/details {session, placeId} → {lat,lng,name}
// rồi regenerate UUID cho lần gõ kế tiếp (dùng reuseBoundary nếu gõ lại — TODO)
```

Chỗ cần điền: tên field JSON chính xác của Autocomplete (New)/Place Details
(New) theo reference; cache Postgres (mục 5) trước lớp Google.

## 8. Khuyến nghị cuối cho demo capstone

- **Dùng Goong làm mặc định demo** (đã tích hợp, dữ liệu số nhà VN tốt nhất
  trong 3 nguồn, $100 gift + free tier → chi phí $0). Đã được nhóm kiểm chứng
  từ commit df75b90.
- **Thêm Google khi**: (a) nhóm muốn gợi ý kiểu Combobox shadcn mượt + Place
  Photos/Reviews cho màn hình kết quả, (b) hội đồng hỏi "vì sao không Google",
  (c) mở rộng đa thành phố ngoài VN. Khi đó bật qua env `GOOGLE_MAPS_API_KEY`,
  dùng Places API (New) + session token + kết thúc bằng PD Essentials,
  KHÔNG đụng legacy API.
- Rủi ro Google cần nêu rõ trong báo cáo: chi phí vượt free cap rất nhanh nếu
  quên session token ($336/tháng ở 500 phiên/ngày so với ~$0 khi dùng đúng);
  ToS chỉ cho cache toạ độ 30 ngày; một số SKU yêu cầu hiển thị Places data
  trên Google Map (không tự do render nơi khác — rà Service Specific Terms
  trước khi dùng Place Details Pro); quota project có thể bị giảm bất ngờ.
- Việc này là nghiên cứu — không áp code trong task này; khi áp nhớ mở rộng
  union `source` ở `src/lib/external.ts:9-14` và badge nguồn (hạn chế 5, doc Goong).

## 9. Nguồn tham khảo (truy vấn 17/10/2026)

1. https://developers.google.com/maps/billing-and-pricing/pricing — bảng giá chính thức (bảng SKU §3)
2. https://developers.google.com/maps/documentation/places/web-service/session-pricing — session pricing (§3.1)
3. https://developers.google.com/maps/documentation/places/web-service/using-session-tokens — dùng session token
4. https://developers.google.com/maps/billing-and-pricing/march-2025 + /faq — free tier mới từ 01/03/2025
5. https://developers.google.com/maps/deprecations — trang deprecation chính thức
6. https://masterconcept.ai/news/google-maps-platform-discontinues-legacy-places-directions-and-distance-matrix-apis-what-you-need-to-know — legacy ngừng 05/10/2026 (nguồn thứ cấp)
7. https://cloudfresh.com/en/blog/google-maps-platform-changes-2025 — legacy chặn dự án mới 01/03/2025
8. https://cloud.google.com/maps-platform/terms/maps-service-terms — cache toạ độ ≤ 30 ngày
9. https://mapsplatform.google.com/pricing — $300 trial credit, subscription plans
10. https://goong.io/bang-gia — giá Goong (Forward $3.50, Autocomplete $1.40, tặng $100)
11. https://docs.goong.io/help — Goong autocomplete cũng dùng session token
12. https://gogoduk.com/blog/map-api-viet-nam-tot-nhat — so sánh Google/Goong địa chỉ VN (29/05/2026)
13. https://track-asia.com/en/news/news/top-10-maps-api-providers-for-vietnam-international-local-options — map API cho VN (15/09/2025)
14. https://developers.google.com/maps/api-security-best-practices + https://support.google.com/googleapi/answer/6310037 — bảo mật API key
15. https://www.woosmap.com/blog/google-places-api-pricing + https://www.appunite.com/blog/how-we-reduced-cloud-spends-of-google-place-autocomplete-by-80-a-case-study — phân tích chi phí session thực tế
