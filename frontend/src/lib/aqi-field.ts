// Smooth "weather-map" AQI field renderer (client-side canvas math).
//
// Takes scattered AQI samples over Hanoi and interpolates them into a
// continuous colour field (IDW + elliptical pixel-space radii), then clips the
// field to the Hanoi boundary polygon — the flowing, weather-map look instead
// of hard grid squares. Also returns a per-pixel lookup field so the map can
// answer hover/click queries with the interpolated local value.

import type { AqiCell } from './aqi-visual'

export type AqiFieldBounds = { latMin: number; latMax: number; lngMin: number; lngMax: number }

export type AqiField = {
  width: number
  height: number
  bounds: AqiFieldBounds
  /** interpolated AQI per pixel */
  values: Float32Array
  /** per-pixel alpha (0 = outside the city boundary / masked) */
  alpha: Uint8ClampedArray
  dataUrl: string
}

/** Exact bounds the field image covers — the ImageOverlay must use the same. */
export const HANOI_FIELD_BOUNDS: AqiFieldBounds = {
  latMin: 20.55,
  latMax: 21.4,
  lngMin: 105.28,
  lngMax: 106.03,
}

/** Continuous palette: band colours anchored at band edges (weather-map style) */
const AQI_COLOR_STOPS: { v: number; c: [number, number, number] }[] = [
  { v: 0, c: [34, 197, 94] }, // Tốt (green)
  { v: 50, c: [132, 204, 22] }, // lime
  { v: 100, c: [250, 204, 21] }, // Trung bình (yellow)
  { v: 150, c: [249, 115, 22] }, // Kém (orange)
  { v: 200, c: [239, 68, 68] }, // Xấu (red)
  { v: 300, c: [168, 85, 247] }, // Rất xấu (purple)
  { v: 420, c: [127, 29, 29] }, // Nguy hại (dark red)
]

/** Map a (continuous) AQI value to a smooth RGB colour */
export function aqiToRgb(v: number): [number, number, number] {
  if (!Number.isFinite(v)) return [148, 163, 184]
  const stops = AQI_COLOR_STOPS
  if (v <= stops[0].v) return stops[0].c
  const last = stops[stops.length - 1]
  if (v >= last.v) return last.c
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i].v) {
      const a = stops[i - 1]
      const b = stops[i]
      const t = (v - a.v) / (b.v - a.v)
      return [
        Math.round(a.c[0] + (b.c[0] - a.c[0]) * t),
        Math.round(a.c[1] + (b.c[1] - a.c[1]) * t),
        Math.round(a.c[2] + (b.c[2] - a.c[2]) * t),
      ]
    }
  }
  return last.c
}

/** Web-Mercator y for latitude (radians) */
function mercY(latDeg: number): number {
  const r = (Math.max(-85, Math.min(85, latDeg)) * Math.PI) / 180
  return Math.log(Math.tan(Math.PI / 4 + r / 2))
}

/**
 * Build the smooth AQI colour field over Hanoi.
 * @param cells  scattered AQI samples (grid over the city)
 * @param ring   Hanoi boundary ring ([lat, lng]) to clip to (optional)
 */
export function buildAqiField(
  cells: AqiCell[],
  ring: [number, number][] | null,
  opts: { width?: number; bounds?: AqiFieldBounds } = {}
): AqiField | null {
  if (typeof document === 'undefined') return null
  const pts = cells.filter((c) => Number.isFinite(c.aqi))
  if (pts.length === 0) return null

  const b = opts.bounds ?? HANOI_FIELD_BOUNDS
  const W = Math.max(160, Math.min(768, Math.round(opts.width ?? 460)))
  const dLat = b.latMax - b.latMin
  const dLng = b.lngMax - b.lngMin
  if (dLat <= 0 || dLng <= 0) return null
  // match Web-Mercator aspect so the overlay aligns with the map exactly
  const H = Math.max(1, Math.round((W * (mercY(b.latMax) - mercY(b.latMin))) / ((dLng * Math.PI) / 180)))

  const N = W * H
  const pxLng = W / dLng
  const pxLat = H / dLat

  // ---- IDW interpolation via point-scoped accumulation (fast, no clamping) ----
  const valAcc = new Float32Array(N)
  const wAcc = new Float32Array(N)
  const spacingDeg = Math.sqrt((dLat * dLng) / pts.length)
  const radiusDeg = Math.max(0.055, spacingDeg * 1.8)
  const rPxLng = radiusDeg * pxLng
  const rPxLat = radiusDeg * pxLat
  const soft = Math.max(1, 0.06 * Math.min(rPxLat, rPxLng)) ** 2 // avoids 1/0 at exact sample

  let sum = 0
  for (const p of pts) sum += p.aqi
  const meanAqi = sum / pts.length

  for (const p of pts) {
    const cx = (p.lng - b.lngMin) * pxLng
    const cy = (b.latMax - p.lat) * pxLat
    const x0 = Math.max(0, Math.floor(cx - rPxLng))
    const x1 = Math.min(W - 1, Math.ceil(cx + rPxLng))
    const y0 = Math.max(0, Math.floor(cy - rPxLat))
    const y1 = Math.min(H - 1, Math.ceil(cy + rPxLat))
    for (let y = y0; y <= y1; y++) {
      const dy = (y - cy) / rPxLat
      const row = y * W
      for (let x = x0; x <= x1; x++) {
        const dx = (x - cx) / rPxLng
        const d2 = dx * dx + dy * dy
        if (d2 > 1) continue
        const w = 1 / (d2 + soft)
        const i = row + x
        valAcc[i] += w * p.aqi
        wAcc[i] += w
      }
    }
  }

  // ---- colourise ----
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const img = ctx.createImageData(W, H)
  const values = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const v = wAcc[i] > 0 ? valAcc[i] / wAcc[i] : meanAqi
    values[i] = v
    const [r, g, bl] = aqiToRgb(v)
    const o = i * 4
    img.data[o] = r
    img.data[o + 1] = g
    img.data[o + 2] = bl
    img.data[o + 3] = 255
  }
  ctx.putImageData(img, 0, 0)

  // ---- clip to the Hanoi boundary (destination-in keeps only inside pixels) ----
  if (ring && ring.length >= 3) {
    ctx.globalCompositeOperation = 'destination-in'
    ctx.beginPath()
    for (let k = 0; k < ring.length; k++) {
      const [la, ln] = ring[k]
      const x = (ln - b.lngMin) * pxLng
      const y = (b.latMax - la) * pxLat
      if (k === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
  }

  const out = ctx.getImageData(0, 0, W, H)
  const alpha = new Uint8ClampedArray(N)
  for (let i = 0; i < N; i++) alpha[i] = out.data[i * 4 + 3]

  return { width: W, height: H, bounds: b, values, alpha, dataUrl: canvas.toDataURL('image/png') }
}

/** Read the interpolated AQI at a lat/lng (null when outside the clipped field). */
export function sampleAqiField(field: AqiField, lat: number, lng: number): number | null {
  const b = field.bounds
  if (lat < b.latMin || lat > b.latMax || lng < b.lngMin || lng > b.lngMax) return null
  const x = Math.round(((lng - b.lngMin) / (b.lngMax - b.lngMin)) * (field.width - 1))
  const y = Math.round(((b.latMax - lat) / (b.latMax - b.latMin)) * (field.height - 1))
  if (x < 0 || y < 0 || x >= field.width || y >= field.height) return null
  const i = y * field.width + x
  if (field.alpha[i] < 24) return null
  return field.values[i]
}
