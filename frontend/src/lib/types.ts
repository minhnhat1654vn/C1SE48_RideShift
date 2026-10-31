// Shared API contract types between frontend and backend

import type { LatLng } from './geo'
import type { Criterion, CriterionVector } from './mcdm'
import type { RouteResult } from './external'

export type { LatLng, Criterion, CriterionVector }

// Air quality payload returned by the backend (US-08/US-19). Numeric,
// category and measuredAt fields are null when the upstream provider is
// unreachable and no cache/estimate can be produced — the UI must degrade
// to an "unavailable" notice instead of rendering numbers.
export type AirQualitySource =
  | 'station' // trạm đo thật (Sở NNN&MT / WAQI)
  | 'interpolated' // nội suy IDW từ trạm thật
  | 'open-meteo' // mô hình CAMS (Open-Meteo)
  | 'live' // legacy
  | 'cache' // cache cũ + notice
  | 'estimate' // simulate (chỉ khi mọi nguồn chết)
  | 'unavailable'

export type AirQualityInfo = {
  aqi: number | null
  pm25: number | null
  pm10: number | null
  category: string | null
  measuredAt: string | null
  source: AirQualitySource
  notice: string | null
  locationLabel: string | null
}

export type AirQualityStationDto = {
  id: string
  name: string
  lat: number
  lng: number
  /** null khi trạm tạm ngừng cập nhật (hiển thị màu xám, không đóng góp lớp AQI) */
  aqi: number | null
  /** false = trạm không còn số liệu (WAQI trả '-'); mặc định true khi thiếu */
  available?: boolean
  source: 'moitruongthudo' | 'waqi'
  sourceLabel: string
  measuredAt: string
  /** Task 99 — panel chi tiết trạm (kiểu PAM Air) */
  address?: string | null
  url?: string | null
}

export const isStationAvailable = (st: AirQualityStationDto): boolean =>
  st.available !== false && st.aqi != null

/** Task 99 — GET /api/airquality/stations/{id}: chi tiết trạm + lịch sử 24h */
export type StationDetailDto = {
  station: AirQualityStationDto
  /** chuỗi điểm theo giờ ({time, aqi}) — Sở NN&MT khi có, fallback mô hình CAMS tại vị trí trạm; null = trạm tạm ngừng (không có lịch sử) */
  history: { time: string; aqi: number }[] | null
  lowest: number | null
  highest: number | null
  /** nguồn của chuỗi lịch sử (Sở đo thật / CAMS) — minh bạch trong API, UI không hiển thị */
  historySource: string | null
  /** thang của chuỗi lịch sử: 'vn' cho trạm Sở, 'us' cho WAQI */
  aqiScale: 'vn' | 'us'
  available: boolean
  fetchedAt: string
}

export type CityDto = {
  id: string
  name: string
  centerLat: number
  centerLng: number
  defaultZoom: number
  bbox: [[number, number], [number, number]]
  wardCount: number
}

export type ModeInfo = {
  id: string
  name: string
  description: string | null
  icon: string
  avgSpeedKmh: number
  baseCostVnd: number
  costPerKmVnd: number
  co2PerKmG: number
  baseAccessibility: number
  baseConvenience: number
  waitMinutes: number
  enabled: boolean
  sortOrder: number
}

export type LezZoneDto = {
  id: string
  name: string
  description: string | null
  coordinates: [number, number][] // [[lat,lng], ...]
  active: boolean
}

export type LezZoneCheck = {
  zoneId: string
  name: string
  insideRatio: number
  status: 'outside' | 'partial' | 'within'
}

export type ComplianceResult = {
  modeId: string
  status: 'compliant' | 'conditionally_restricted' | 'not_permitted'
  reason: string | null
  rules: {
    zoneId: string
    zoneName: string
    restrictionType: 'banned' | 'conditional'
    condition: string | null
    startTime: string
    endTime: string
    days: string
  }[]
}

export type CriterionScore = {
  criterion: Criterion
  label: string
  raw: number
  normalized: number // 0..1, higher = better
  contribution: number // weighted TOPSIS contribution
  weightPct: number
  display: string // formatted raw value
}

export type Recommendation = {
  modeId: string
  modeName: string
  icon: string
  score: number
  rank: number
  travelTimeMin: number
  costVnd: number
  co2Kg: number
  compliance: ComplianceResult
  criteria: CriterionScore[]
}

export type AnalyzeRequest = {
  origin: { lat: number; lng: number; name?: string }
  destination: { lat: number; lng: number; name?: string }
  vehicleId: string
  purpose: string
  departureTime?: string // ISO
  preferences?: { fastest?: number; cheapest?: number; eco?: number; comfort?: number } // 0..100 sliders
  saveTrip?: boolean
}

export type AnalyzeResponse = {
  tripId?: string
  vehicleId: string
  route: {
    coords: LatLng[]
    distanceKm: number
    durationMin: number
    source: 'osrm' | 'estimated'
  }
  origin: { lat: number; lng: number; name: string }
  destination: { lat: number; lng: number; name: string }
  lez: {
    overall: 'outside' | 'partial' | 'within' | 'none'
    zones: LezZoneCheck[]
    affected: boolean
  }
  compliance: Record<string, ComplianceResult> // per modeId
  airQuality: AirQualityInfo
  recommendations: Recommendation[]
  weightsUsed: Record<string, number>
}

export type TripRecordDto = {
  id: string
  originName: string
  destName: string
  originDistrict: string
  distanceKm: number
  durationMin: number
  vehicleId: string
  purpose: string
  lezAffected: boolean
  topModeId: string
  topScore: number
  avgCostVnd: number
  avgTimeMin: number
  chosenModeId: string | null
  switched: boolean
  createdAt: string
}

export type AnalyticsResponse = {
  from: string
  to: string
  kpis: {
    totalTrips: number
    lezAffectedPct: number
    avgTimeMin: number
    avgCostVnd: number
    switchingPct: number
    mostRecommended: { modeId: string; name: string; count: number } | null
  }
  modeDistribution: { modeId: string; name: string; count: number }[]
  byDistrict: { district: string; count: number; avgScore: number }[]
  byPurpose: { purpose: string; count: number; topModeId: string | null }[]
  switching: { modeId: string; name: string; count: number }[]
  trips: TripRecordDto[]
}

export type PolicyRuleDto = {
  id: string
  zoneId: string
  modeId: string
  restrictionType: 'banned' | 'conditional'
  condition: string | null
  startTime: string
  endTime: string
  days: string
  active: boolean
}

export type TripPurpose = 'work' | 'school' | 'shopping' | 'leisure' | 'other'

export const TRIP_PURPOSES: { value: TripPurpose; label: string }[] = [
  { value: 'work', label: 'Đi làm / Công tác' },
  { value: 'school', label: 'Đi học / Học tập' },
  { value: 'shopping', label: 'Mua sắm' },
  { value: 'leisure', label: 'Giải trí / Giao lưu' },
  { value: 'other', label: 'Khác' },
]

// Convenience / accessibility modifiers per purpose (behavioral context, US-09)
export const PURPOSE_CONVENIENCE: Record<string, Record<string, number>> = {
  work: { gasoline_motorbike: 0.08, electric_motorbike: 0.06, private_car: 0.04, bus: -0.05, taxi: 0.03, bicycle: -0.02, walking: -0.08 },
  school: { gasoline_motorbike: 0.05, electric_motorbike: 0.05, private_car: -0.05, bus: 0.12, taxi: -0.02, bicycle: 0.06, walking: 0.02 },
  shopping: { gasoline_motorbike: 0.04, electric_motorbike: 0.03, private_car: 0.08, bus: -0.03, taxi: 0.1, bicycle: 0.0, walking: 0.02 },
  leisure: { gasoline_motorbike: 0.0, electric_motorbike: 0.04, private_car: -0.02, bus: 0.05, taxi: 0.08, bicycle: 0.12, walking: 0.1 },
  other: {},
}

// Static trend priors (survey-derived Vehicle at Ha Noi Dataset baseline)
export const TREND_PRIOR: Record<string, number> = {
  gasoline_motorbike: 0.62,
  electric_motorbike: 0.14,
  private_car: 0.1,
  bus: 0.08,
  taxi: 0.04,
  bicycle: 0.01,
  walking: 0.01,
}

export const CRITERION_LABELS: Record<Criterion, string> = {
  travelTime: 'Thời gian di chuyển',
  cost: 'Chi phí ước tính',
  lezCompliance: 'Tuân thủ LEZ',
  accessibility: 'Khả năng tiếp cận',
  convenience: 'Sự tiện lợi',
  environment: 'Tác động môi trường',
  trend: 'Xu hướng khảo sát',
}
