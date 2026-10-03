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

/** One transport mode's share in the latest survey month (dataset_trend). */
export type DatasetTrendRow = {
  modeId: string
  modeName: string
  /** Share of survey trips for this mode in the latest month (0..1). */
  share: number
  /** Composite adoption+growth trend index (0..1, higher = rising mode). */
  trendIndex: number
  /** Number of cleaned survey rows behind the share. */
  sampleCount: number
}

/** Optional `dataset` section of the admin analytics response. */
export type DatasetSection = {
  lastRun: DatasetRunInfo | null
  latestMonth: string | null
  modeTrend: DatasetTrendRow[]
}

/** Analytics response extended with the optional survey-dataset section. */
export type AnalyticsWithDataset = AnalyticsResponse & {
  dataset?: DatasetSection | null
}
