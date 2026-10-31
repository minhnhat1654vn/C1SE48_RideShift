// Shared AQI visual helpers (pure, safe for both client and server).
// Colour scale follows the VN-usable AQI bands: Tốt / Trung bình / Kém / Xấu / Rất xấu / Nguy hại.

export type AqiCell = {
  lat: number
  lng: number
  aqi: number
  pm25: number | null
  pm10: number | null
  time: string // e.g. "2026-09-25T09:00" (local Asia/Bangkok)
}

export type AqiStation = {
  name: string
  lat: number
  lng: number
  aqi: number
}

export type AqiLayerData = {
  cells: AqiCell[]
  stations: AqiStation[]
  /** Hanoi boundary ring ([lat, lng]) used to clip the smooth field + draw the city outline */
  boundary?: { ring: [number, number][]; source: 'nominatim' | 'fallback' } | null
  stepDeg: number // grid cell size in degrees
  fetchedAt: string // ISO timestamp of the fetch
  source: 'open-meteo' | 'cache' | 'none'
  notice?: string
}

export type AqiCategory = { label: string; color: string }

/** Map an AQI value to its Vietnamese category label + display colour */
export function aqiCategory(aqi: number): AqiCategory {
  if (!Number.isFinite(aqi)) return { label: 'Không rõ', color: '#94a3b8' }
  if (aqi <= 50) return { label: 'Tốt', color: '#22c55e' }
  if (aqi <= 100) return { label: 'Trung bình', color: '#facc15' }
  if (aqi <= 150) return { label: 'Kém', color: '#f97316' }
  if (aqi <= 200) return { label: 'Xấu', color: '#ef4444' }
  if (aqi <= 300) return { label: 'Rất xấu', color: '#a855f7' }
  return { label: 'Nguy hại', color: '#7f1d1d' }
}

/** Legend rows (bottom-right of the map) */
export const AQI_LEGEND: { color: string; label: string; range: string }[] = [
  { color: '#22c55e', label: 'Tốt', range: '0–50' },
  { color: '#facc15', label: 'Trung bình', range: '51–100' },
  { color: '#f97316', label: 'Kém', range: '101–150' },
  { color: '#ef4444', label: 'Xấu', range: '151–200' },
  { color: '#a855f7', label: 'Rất xấu', range: '201–300' },
  { color: '#7f1d1d', label: 'Nguy hại', range: '>300' },
]

/** Format a timestamp ("2026-09-25T09:00" or full ISO) → "09:00 ngày 25/9/2026" */
export function formatAqiTime(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(iso ?? '')
  if (!m) return iso
  const [, y, mo, d, t] = m
  return `${t ? `${t} ngày ` : ''}${Number(d)}/${Number(mo)}/${y}`
}
