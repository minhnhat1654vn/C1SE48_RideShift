// Shared admin-only types — RideShift (C1SE.48)
//
// These describe the OPTIONAL `dataset` section that GET /api/admin/analytics
// gains with US-25 (processed "Vehicle at Ha Noi" survey data). They are
// defined locally (instead of src/lib/types.ts) and every field is optional
// from the consumer's point of view, so the dashboard keeps rendering while
// the backend is rolling out the section.

import type { AnalyticsResponse } from '@/lib/types'

/** One executed pipeline run (dataset_run table). */
export type DatasetRunInfo = {
  /** ISO timestamp of the last pipeline execution. */
  ranAt: string
  /** Source CSV the pipeline consumed, e.g. "data/vehicle_at_hanoi.csv". */
  sourceFile: string
  /** Raw rows read from the source file. */
  rowsIn: number
  /** Rows left after cleaning (dedupe / dropna / normalize). */
  rowsClean: number
}

/** One transport mode's share for the reported survey period (decision.dataset_trends). */
export type DatasetTrendRow = {
  modeId: string
  modeName: string
  /** Share of survey trips for this mode in the reported period.
   *  The API reports it as 0–100 % (DB stores a 0..1 fraction).
   *  With cohort-kind data (Kaggle) this is the whole-sample share. */
  share: number
  /** Composite adoption+growth trend index (0..1, higher = rising mode). */
  trendIndex: number | null
  /** Number of cleaned survey rows behind the share. */
  sampleCount: number
}

/** Optional `dataset` section of the admin analytics response. */
export type DatasetSection = {
  lastRun: DatasetRunInfo | null
  /** Latest period label — survey month (monthly scaffold) or age cohort
   *  (Kaggle dataHN.csv, periodKind "cohort"). */
  latestMonth: string | null
  /** "month" = monthly scaffold data, "cohort" = Kaggle age-cohort data. */
  periodKind?: 'month' | 'cohort'
  modeTrend: DatasetTrendRow[]
}

/** Analytics response extended with the optional survey-dataset section. */
export type AnalyticsWithDataset = AnalyticsResponse & {
  dataset?: DatasetSection | null
}

// ---------------------------------------------------------------------------
// CN-40 — Phân tích tác động LEZ (GET /api/admin/lez-impact)
// ---------------------------------------------------------------------------

/** KPI tổng quan của phân tích tác động LEZ. */
export type LezImpactKpis = {
  totalTrips: number
  lezAffectedTrips: number
  lezAffectedPct: number
  affectedDistanceKm: number
  totalDistanceKm: number
  avgDistanceAffectedKm: number
  avgDistanceNormalKm: number
  avgDurationAffectedMin: number
  avgDurationNormalMin: number
  compliantPct: number
}

/** Tác động theo loại phương tiện định đi. */
export type LezImpactByMode = {
  code: string
  name: string
  total: number
  affected: number
  affectedPct: number
  affectedDistanceKm: number
}

/** Xu hướng theo ngày (giờ địa phương Hà Nội, UTC+7). */
export type LezImpactByDay = { date: string; total: number; affected: number }

/** Tác động theo quận xuất phát. */
export type LezImpactByDistrict = {
  district: string
  total: number
  affected: number
  affectedPct: number
}

/** Tác động theo mục đích chuyến đi. */
export type LezImpactByPurpose = {
  purpose: string
  total: number
  affected: number
  affectedPct: number
}

/** Chi tiết tuân thủ từ bảng trip.trip_lez_analyses (có thể rỗng). */
export type LezImpactDetail = {
  analyzedTrips: number
  statusDistribution: { status: string; label: string; count: number }[]
  compliance: { status: string; label: string; count: number }[]
  avgIntersectionPct: number
  avgIntersectionLengthM: number
  topReasons: { reason: string; count: number }[]
}

/** Response của GET /api/admin/lez-impact. */
export type LezImpactResponse = {
  from: string
  to: string
  kpis: LezImpactKpis
  byMode: LezImpactByMode[]
  byDay: LezImpactByDay[]
  byDistrict: LezImpactByDistrict[]
  byPurpose: LezImpactByPurpose[]
  lezDetail: LezImpactDetail
}
