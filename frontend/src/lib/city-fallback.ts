// Danh sách 3 thành phố dự phòng — dùng khi GET /api/cities thất bại sau
// các lần retry (backend chưa boot xong / mạng lỗi). Cổng chọn thành phố
// phải LUÔN hiện đủ 3 TP: Hà Nội ↔ Đà Nẵng ↔ TP.HCM — không bao giờ dừng
// ở một mình Hà Nội (triệu chứng lỗi của bản zip cũ).
// Số liệu khớp seed CITY_SEEDS phía backend (id/name/center/zoom);
// wardCount=0 chỉ là ước lượng hiển thị, sẽ được dữ liệu thật thay thế
// ngay khi API phục hồi.
import type { CityDto } from '@/lib/types'

export const FALLBACK_CITIES: CityDto[] = [
  {
    id: 'hanoi',
    name: 'Hà Nội',
    centerLat: 21.0278,
    centerLng: 105.8342,
    defaultZoom: 12,
    bbox: [
      [20.544283, 105.265352],
      [21.405421, 106.040128],
    ],
    wardCount: 126,
  },
  {
    id: 'danang',
    name: 'Đà Nẵng',
    centerLat: 16.0544,
    centerLng: 108.2022,
    defaultZoom: 12,
    bbox: [
      [15.9, 107.5],
      [16.25, 108.35],
    ],
    wardCount: 94,
  },
  {
    id: 'hcm',
    name: 'TP. Hồ Chí Minh',
    centerLat: 10.7757,
    centerLng: 106.7004,
    defaultZoom: 12,
    bbox: [
      [10.4, 106.4],
      [11.15, 107.05],
    ],
    wardCount: 168,
  },
]
