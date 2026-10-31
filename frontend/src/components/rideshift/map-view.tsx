'use client'

// Interactive Leaflet map used by both the Trip Planner and the Admin Dashboard.
//
// Two-layer map (Task 30 — theo mẫu RideShift_HaNoi_2Layers.html):
//   Layer 1 (low zoom < 12): Hanoi administrative layer — 126 phường/xã
//     boundaries in deterministic per-ward pastel colors (Task 32: hash by
//     ward code, golden-angle hue stepping — stable across pan/zoom) with a
//     3D pop-up effect on hover/selection (Task 31: the ward rises as an
//     extruded slab whose top face takes the ward's own color, instead of
//     the old thick-border highlight), ward-name labels (zoom 10–11) and a
//     click-to-inspect panel (mã, diện tích, dân số, mật độ + AQI qua
//     backend + nhiệt độ/mưa từ Open-Meteo).
//   Layer 2 (street zoom ≥ 12): the basemap streets take over; the admin
//     layer fades to a faint reference and stops intercepting clicks so that
//     route/markers/pick/draw all work normally.
//
// Basemaps: Esri World Street Map (default, same as the reference demo),
// Esri World Imagery and classic OSM. All previous features are kept:
// LEZ polygons, route polyline, origin/destination markers, transportation
// locations, click-to-draw for new zones (US-31) and click-to-pick (US-01).
//
// Air-quality smooth layer (Task 63 → v3 Task 66 — "lớp AQI mượt"):
//   - TRƯỜNG AQI v3 = nội suy IDW p=2 LIÊN TỤC từ TRẠM ĐO THẬT (Sở NN&MT qua
//     moitruongthudo.vn + WAQI) trên lưới giảm phân giải, phóng bilinear +
//     CSS blur → gradient nhiệt liền mạch KHÔNG đa giác/ô vuông (v2 Voronoi
//     vẫn chia đa giác từng trạm — phản hồi user "phải mượt, có chuyển động"
//     → bỏ, v1 lưới ô vuông 24px lộ mép → đã bỏ).
//   - CHUYỂN ĐỘNG: sóng sin 2 hướng đi chậm qua trường (rAF ~30fps) như bản
//     đồ gió IQAir; fade in/out 450ms khi bật/tắt lớp hoặc đổi trạm.
//   - LOD (Task 65): dưới AQI_FIELD_MIN_ZOOM trường tự ẩn (chỉ còn badge)
//     và fade alpha trong dải ramp — không bao giờ thấy "cục AQI" zoom xa.
//   - Badge trạm đo thật: vòng tròn màu AQI + số, tooltip ghi rõ
//     tên trạm · nguồn · thời gian đo (minh bạch nguồn — US-19).
//   - Vùng phủ: theo thành phố đã chọn (multi-city gate).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Feature, FeatureCollection } from 'geojson'
import { Clock, ExternalLink, Globe, Landmark, Map as MapIcon, Minus, Plus, Satellite, X } from 'lucide-react'
import type { AirQualityInfo, AirQualityStationDto, LezZoneDto, StationDetailDto } from '@/lib/types'
import { isStationAvailable } from '@/lib/types'
import { apiFetch } from '@/lib/api'
import { aqiCategory, formatAqiTime } from '@/lib/aqi-visual'

export type MapMarker = {
  id: string
  lat: number
  lng: number
  label: string
  kind: 'origin' | 'destination' | 'transport' | 'point'
}

export type CityLite = {
  id: string
  name: string
  centerLat: number
  centerLng: number
  defaultZoom: number
  /** bbox [[minLat,minLng],[maxLat,maxLng]] — dùng để LOCK bản đồ trong thành phố */
  bbox?: [[number, number], [number, number]]
}

export type MapViewProps = {
  zones: LezZoneDto[]
  /** thành phố đang khoá (multi-city Task 63) — quyết định tâm bản đồ + ranh giới phường/xã */
  city?: CityLite | null
  /** trạm đo thật cho lớp AQI mượt (Task 63) */
  aqiStations?: AirQualityStationDto[]
  /** bật/tắt trường AQI mượt */
  showAqi?: boolean
  routeCoords?: [number, number][] | null
  markers?: MapMarker[]
  /** admin draw mode: clicking the map adds vertices (takes precedence over pick mode) */
  drawPoints?: [number, number][]
  drawMode?: boolean
  /** click-to-pick (trip planner, US-01): sets origin/destination from a map click */
  onMapClick?: (lat: number, lng: number) => void
  /** show crosshair cursor + enable onMapClick picks while true */
  pickMode?: boolean
  /** fit bounds to this list of points whenever it changes */
  fitBoundsTo?: [number, number][]
  /** optional pixel padding for fitBounds (e.g. avoid the floating planner panel) */
  fitPadding?: { topLeft?: [number, number]; bottomRight?: [number, number] }
  className?: string
}

const HANOI_CENTER: [number, number] = [21.0278, 105.8342]

// ---------------------------------------------------------------------------
// Ward (phường/xã) administrative layer — Task 86 (gộp A′): nguồn duy nhất là
// gis.administrative_regions qua API /api/cities/{code}/wards (388 vùng 3 TP)
// ---------------------------------------------------------------------------

type WardProps = {
  ma_xa: string
  ten_xa: string
  loai: string
  dtich_km2: number
  dan_so: number
  matdo_km2: number
  sap_nhap: string
}

type WardPanel = { ward: WardProps; lat: number; lng: number }

// cache ranh giới theo thành phố: API /api/cities/{code}/wards (gis.administrative_regions)
const wardsCache = new Map<string, FeatureCollection>()

async function loadWards(cityCode: string): Promise<FeatureCollection | null> {
  const hit = wardsCache.get(cityCode)
  if (hit) return hit
  try {
    const res = await apiFetch(`/api/cities/${encodeURIComponent(cityCode)}/wards`)
    if (!res.ok) return null
    const fc = (await res.json()) as FeatureCollection
    wardsCache.set(cityCode, fc)
    return fc
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Basemaps
// ---------------------------------------------------------------------------

const BASEMAPS = {
  street: {
    label: 'Phố',
    icon: MapIcon,
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Bản đồ &copy; <a href="https://www.esri.com/">Esri</a> &middot; Dữ liệu &copy; OpenStreetMap',
    maxZoom: 19,
  },
  satellite: {
    label: 'Vệ tinh',
    icon: Satellite,
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Ảnh vệ tinh &copy; <a href="https://www.esri.com/">Esri</a>',
    maxZoom: 19,
  },
  osm: {
    label: 'OSM',
    icon: Globe,
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
} as const

type BasemapKey = keyof typeof BASEMAPS

// ---------------------------------------------------------------------------
// Zoom-adaptive admin styles (giống demo: càng zoom sâu lớp hành chính càng mờ)
// ---------------------------------------------------------------------------

const ZOOM_STREET = 12 // ≥ 12: street mode — admin layer nearly invisible
const ZOOM_LABELS = 10 // 10–11: permanent ward-name labels visible

function adminStyle(zoom: number, feature?: Feature): L.PathOptions {
  if (zoom >= ZOOM_STREET) {
    // street mode: keep the faint neutral gray so it never fights the roads
    return { color: '#94a3b8', weight: 0.6, opacity: 0.4, fillColor: '#64748b', fillOpacity: 0.05 }
  }
  const p = feature?.properties as WardProps | undefined
  const c = wardColor(p?.ma_xa || p?.ten_xa || 'ha-noi')
  if (zoom >= ZOOM_LABELS) {
    return { color: c.stroke, weight: 1, opacity: 0.8, fillColor: c.fill, fillOpacity: 0.24 }
  }
  return { color: c.stroke, weight: 1.2, opacity: 0.9, fillColor: c.fill, fillOpacity: 0.4 }
}

// ---------------------------------------------------------------------------
// Task 32 — deterministic per-ward pastel palette
// ---------------------------------------------------------------------------
// Plain Math.random() would repaint on every restyle (pan/zoom flicker), so
// the color is derived from the ward code: FNV-1a hash → hue stepped by the
// golden angle (137.508°) for even, well-separated hues, with slight
// saturation/lightness jitter so the map looks hand-tinted, not rainbow-vomity.

type WardColor = { fill: string; stroke: string; top: string }

const wardColorCache = new Map<string, WardColor>()

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function wardColor(key: string): WardColor {
  const cached = wardColorCache.get(key)
  if (cached) return cached
  const h = hashStr(key)
  const hue = (h * 137.508) % 360
  const sat = 52 + (h % 3) * 7 // 52/59/66 %
  const light = 63 + (h % 2) * 6 // 63/69 %
  const hue1 = hue.toFixed(1)
  const c: WardColor = {
    fill: `hsl(${hue1} ${sat}% ${light}%)`,
    stroke: `hsl(${hue1} 42% 30%)`, // darker same-hue border
    top: `hsl(${hue1} 74% 58%)`, // vivid top face for the 3D pop-up
  }
  wardColorCache.set(key, c)
  return c
}

// Selection highlight — kept only for the ward whose panel is open.
// Plain hover feedback is now the 3D pop-up below (no border thickening).
const WARD_HOVER: L.PathOptions = {
  color: '#0f172a',
  weight: 2.5,
  opacity: 1,
  fillOpacity: 0.45,
}

// ---------------------------------------------------------------------------
// Task 31 — 3D ward pop-up ("nổi" effect, cách 1)
// ---------------------------------------------------------------------------
// The hovered/selected ward is redrawn as an extruded slab rising above the
// flat 2D map. It is faked with stacked SVG copies (the classic d3
// extrusion trick) so it works inside Leaflet with zero new dependencies:
//   copy 0  → dark footprint that STAYS on the ground (the base in shade)
//   1..N-2  → wall copies, each shifted up a bit more (solid side wall)
//   copy N-1 → bright top face that lifts with a CSS drop shadow
// Every copy is a Leaflet polygon sharing one SVG renderer in a dedicated
// pane (zIndex 380 — above the admin layer 350, below LEZ/route/markers
// 400+). The rise is a pure CSS transform transition on each path, driven
// by a per-copy `--lift` custom property, so all copies animate together
// and the wall "grows" smoothly. Two buffers let one ward fall while the
// next one rises during fast mouse sweeps.

const EXT_COPY_COUNT = 11 // index 0 = footprint, 1..9 = walls, 10 = top face
const EXT_LIFT_PX = 12 // total rise height in screen pixels

type ExtLatLngs = L.LatLngExpression[][] | L.LatLngExpression[][][]

function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

type ExtBuffer = {
  key: string | null
  layers: L.Polygon[]
  els: SVGPathElement[]
  hideTimer: number | null
}

class WardExtruder {
  private bufs: ExtBuffer[] = []
  private current: ExtBuffer | null = null
  private labelEl: HTMLElement | null = null

  constructor(
    private map: L.Map,
    private renderer: L.SVG
  ) {
    for (let b = 0; b < 2; b++) {
      const layers: L.Polygon[] = []
      const els: SVGPathElement[] = []
      for (let i = 0; i < EXT_COPY_COUNT; i++) {
        const isTop = i === EXT_COPY_COUNT - 1
        const isFoot = i === 0
        // walls lighten toward the top; the footprint is near-black teal
        const color = isTop
          ? '#2dd4bf'
          : isFoot
            ? '#032622'
            : lerpHex('#0c4a42', '#1c7a6b', (i - 1) / (EXT_COPY_COUNT - 2))
        const pl = L.polygon([HANOI_CENTER], {
          renderer,
          interactive: false,
          bubblingMouseEvents: false,
          fillColor: color,
          color,
          fillOpacity: isTop ? 0.9 : isFoot ? 0.85 : 0.98,
          opacity: 1,
          // walls get a same-color stroke to kill antialiasing seams
          weight: isTop ? 2 : 1,
          lineJoin: 'round',
          fillRule: 'evenodd',
          className: `ward-ext${isTop ? ' ward-ext-top' : ''}`,
        }).addTo(map)
        if (isTop) pl.setStyle({ color: 'rgba(255, 255, 255, 0.95)' })
        const el = (pl as unknown as { _path?: SVGPathElement })._path
        if (el) {
          el.style.setProperty('--lift', `${(-EXT_LIFT_PX * (i / (EXT_COPY_COUNT - 1))).toFixed(2)}px`)
          el.classList.add('ward-ext-off') // hidden until the first lift
          els.push(el)
        }
        layers.push(pl)
      }
      this.bufs.push({ key: null, layers, els, hideTimer: null })
    }
  }

  /** Raise a ward. Same key → no-op (already up). */
  lift(key: string, latlngs: ExtLatLngs, labelEl: HTMLElement | null, topColor?: string): void {
    if (this.current?.key === key) return
    this.drop() // whatever is up starts falling
    // reuse an idle buffer; if both are mid-fall (fast sweep) steal one
    let buf = this.bufs.find((b) => b.hideTimer === null)
    if (!buf) {
      buf = this.bufs[0]
      if (buf.hideTimer !== null) {
        clearTimeout(buf.hideTimer)
        buf.hideTimer = null
      }
    }
    buf.key = key
    this.current = buf
    this.setLabel(labelEl) // hide the flat permanent label of this ward
    if (topColor) buf.layers[EXT_COPY_COUNT - 1].setStyle({ fillColor: topColor })
    buf.layers.forEach((pl) => pl.setLatLngs(latlngs))
    buf.els.forEach((el) => el.classList.remove('ward-ext-off'))
    // wait a frame so the flat state is painted, then rise
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this.current === buf) buf.els.forEach((el) => el.classList.add('lifted'))
      })
    )
  }

  /** Let the current block fall back onto the map (no-op if nothing is up). */
  drop(): void {
    const buf = this.current
    if (!buf) return
    this.current = null
    this.setLabel(null)
    buf.els.forEach((el) => el.classList.remove('lifted'))
    buf.hideTimer = window.setTimeout(() => {
      buf.hideTimer = null
      buf.key = null
      buf.els.forEach((el) => el.classList.add('ward-ext-off'))
    }, 240)
  }

  private setLabel(el: HTMLElement | null): void {
    this.labelEl?.classList.remove('ward-label-hidden')
    this.labelEl = el
    this.labelEl?.classList.add('ward-label-hidden')
  }

  destroy(): void {
    for (const b of this.bufs) {
      if (b.hideTimer !== null) {
        clearTimeout(b.hideTimer)
        b.hideTimer = null
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Task 66 — Trường AQI v3: IDW mượt + chuyển động (không đa giác)
// ---------------------------------------------------------------------------
// Phản hồi user: Voronoi "chia thành từng đa giác" vẫn chưa mượt. v3 bỏ hẳn
// đa giác, chuyển sang trường liên tục kiểu bản đồ nhiệt (như nền IQAir):
//  1. IDW p=2 nội suy GIÁ TRỊ AQI (không phải màu) trên lưới GIẢM PHÂN GIẢI
//     (mỗi ô GRID_PX px = 1 điểm ảnh của canvas nhỏ) rồi tra thang màu 6 mức
//     QCVN 05:2023 → dải màu chuyển sắc đúng chuẩn, không lẫn màu bùn giữa
//     2 trạm khác băng (nội suy màu trực tiếp cho màu xám bùn).
//  2. Canvas nhỏ phóng bilinear (drawImage) lên full viewport + CSS blur →
//     gradient mềm tuyệt đối, không thấy ranh ô (v1 ô vuông 24px bị lộ).
//  3. CHUYỂN ĐỘNG: sóng sin 2 hướng đi chậm qua trường (rAF ~30fps, lưới nhỏ
//     nên chi phí không đáng kể) — trường "thở" như bản đồ gió IQAir; biên độ
//     ±8% và PHA TÍNH TRÊN MAP PX TUYỆT ĐỐI → cùng 1 điểm địa lý luôn cùng
//     cường độ màu, kéo map không làm đổi màu (Task 68).
//  4. Neo địa lý: lưới nội suy snap bội GRID_PX trên map px tuyệt đối → cùng
//     điểm địa lý luôn cùng ô/giá trị. PAN: vòng vẽ chạy liên tục, canvas neo
//     lại theo viewport mỗi khung → hết "mảng AQI load sau" khi kéo (Task 68).
//     ZOOM: dừng vẽ trong animation (zoomstart→zoomend) rồi vẽ lại khớp view.
//  5. Fade in/out 450ms khi bật/tắt lớp hay nạp trạm mới — không bật/tắt gắt.
//  6. LOD Task 65 giữ nguyên: dưới zoom 11 ẩn trường (chỉ badge trạm).
//  7. Clip ranh giới thành phố Task 64 giữ nguyên (cache theo view).

const AQI_FIELD_MIN_ZOOM = 11 // LOD: dưới mức này ẩn trường, chỉ còn badge trạm
const AQI_FIELD_FULL_ZOOM = 12 // từ mức này alpha đầy đủ (fade ramp 11 → 12)
const AQI_FIELD_ALPHA = 0.45 // alpha đỉnh (tại vị trí trạm)
const AQI_FIELD_GRID_PX = 16 // kích thước ô lưới nội suy (px)
const AQI_FIELD_RADIUS_KM = 45 // tầm ảnh hưởng của trạm (ngoài = trong suốt)
const AQI_FIELD_NEAR_KM = 8 // trong bán kính này alpha đầy đủ
const AQI_FIELD_FADE_MS = 450 // fade in/out khi bật/tắt lớp
const AQI_FIELD_FPS = 30 // giới hạn khung hình của vòng vẽ (chạy cả khi pan — Task 68)
const AQI_FIELD_WAVE_MS = 9000 // chu kỳ sóng chuyển động (chậm — tinh tế)
const AQI_FIELD_WAVE_AMPL = 0.08 // biên độ sóng alpha ±8% — màu đọc ổn định (Task 68)
// Task 75: pha sóng neo toạ độ thế giới (project zoom 0) — nhân 2^12 để mẫu
// sóng tại zoom 12 GIỐNG HỆT thiết kế gốc (0.011/0.007 trên map px zoom 12)
const AQI_FIELD_WAVE_K0 = 0.011 * 4096
const AQI_FIELD_WAVE_K0_B = 0.007 * 4096
// Task 77 — supersample backing store ×SS: khi animation zoom CSS-scale canvas
// 2–4×, mỗi px canvas vẫn còn ≥1 px màn hình → không vỡ hạt. Đồng thời canvas
// hiển thị sắc trên màn hình retina (dpr ≥ 2).
const AQI_FIELD_SS = typeof window !== 'undefined' ? Math.max(2, window.devicePixelRatio || 1) : 2
// Task 77 — làm mềm gradient bằng GAUSS THUẦN JS trên canvas field nhỏ (premultiplied,
// separable) — KHÔNG dùng ctx.filter: HeadlessChrome/Safari no-op filter 2D,
// và CSS filter:blur cũ thì nhân theo scale transform khi zoom (xem globals.css).
// Toán tử tuyến tính → blur field trước + phóng bilinear sau ≡ phóng trước + blur
// σ9 CSS px sau (đúng look cũ), và σ tính theo mẫu lưới nên tự co giãn khi lưới
// mịn hơn giữa animation zoom.
function aqiBlurFieldData(data: Uint8ClampedArray, w: number, h: number, sigma: number): void {
  if (sigma <= 0.05 || w < 3 || h < 3) return
  const radius = Math.max(1, Math.min(24, Math.ceil(sigma * 3)))
  const kLen = radius * 2 + 1
  // kernel Gaussian 1D chuẩn hoá
  const kernel = new Float32Array(kLen)
  let kSum = 0
  for (let i = 0; i < kLen; i++) {
    const d = i - radius
    const v = Math.exp(-(d * d) / (2 * sigma * sigma))
    kernel[i] = v
    kSum += v
  }
  for (let i = 0; i < kLen; i++) kernel[i] /= kSum
  const n = w * h
  // premultiply (tránh rỉ màu đen từ ô trong suốt khi blur thẳng RGBA)
  const pm = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255
    pm[i * 4] = data[i * 4] * a
    pm[i * 4 + 1] = data[i * 4 + 1] * a
    pm[i * 4 + 2] = data[i * 4 + 2] * a
    pm[i * 4 + 3] = data[i * 4 + 3]
  }
  const tmp = new Float32Array(n * 4)
  // ngang
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let k = 0; k < kLen; k++) {
        const sx = Math.min(w - 1, Math.max(0, x + k - radius))
        const o = (y * w + sx) * 4
        const kv = kernel[k]
        r += pm[o] * kv; g += pm[o + 1] * kv; b += pm[o + 2] * kv; a += pm[o + 3] * kv
      }
      const o2 = (y * w + x) * 4
      tmp[o2] = r; tmp[o2 + 1] = g; tmp[o2 + 2] = b; tmp[o2 + 3] = a
    }
  }
  // dọc + un-premultiply về thẳng RGBA
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let k = 0; k < kLen; k++) {
        const sy = Math.min(h - 1, Math.max(0, y + k - radius))
        const o = (sy * w + x) * 4
        const kv = kernel[k]
        r += tmp[o] * kv; g += tmp[o + 1] * kv; b += tmp[o + 2] * kv; a += tmp[o + 3] * kv
      }
      const o2 = (y * w + x) * 4
      if (a > 0.5) {
        data[o2] = Math.min(255, r / (a / 255))
        data[o2 + 1] = Math.min(255, g / (a / 255))
        data[o2 + 2] = Math.min(255, b / (a / 255))
      }
      data[o2 + 3] = a
    }
  }
}
const AQI_FIELD_MAX_CELLS = 220000 // trần số ô lưới của 1 lần vẽ (chống treo)

/** nội suy màu theo thang AQI 6 mức (aqi-visual) — trả RGB để tô ImageData */
function aqiColorRgb(aqi: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [34, 197, 94]],
    [50, [250, 204, 21]],
    [100, [249, 115, 22]],
    [150, [239, 68, 68]],
    [200, [168, 85, 247]],
    [300, [127, 29, 29]],
  ]
  const a = Math.max(0, Math.min(500, aqi))
  let lo = stops[0]
  let hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (a >= stops[i][0] && a <= stops[i + 1][0]) {
      lo = stops[i]
      hi = stops[i + 1]
      break
    }
  }
  const t = hi[0] === lo[0] ? 0 : (a - lo[0]) / (hi[0] - lo[0])
  return [
    Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * t),
    Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * t),
    Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * t),
  ]
}

class AqiFieldLayer {
  private canvas: HTMLCanvasElement
  /** canvas nội suy giảm phân giải (mỗi ô lưới = 1 px) — phóng bilinear lên */
  private field: HTMLCanvasElement
  private fieldCtx: CanvasRenderingContext2D | null = null
  /** Task 77: bước phóng trung gian (field → mid ×4 → canvas) — 2 lượt bilinear
   *  thay cho CSS blur cũ; kèm ctx.filter blur nếu trình duyệt hỗ trợ */
  private mid: HTMLCanvasElement
  private midCtx: CanvasRenderingContext2D | null = null
  private imgData: ImageData | null = null
  private map: L.Map
  private stations: AirQualityStationDto[] = []
  /** ring GeoJSON ([lng,lat]) dùng để CLIP trường AQI theo ranh giới thành phố */
  private clipRings: number[][][] = []
  /** Task 77: Path2D clip dựng đúng 1 LẦN ở map px zoom 12 — mỗi lần vẽ chỉ
   *  ctx.scale(2^(zoom−12)) ma trận trước khi clip (thẳng giữ nguyên thẳng),
   *  thay vì chiếu lại hàng nghìn đỉnh mỗi lần đổi zoom (longtask zoomend) */
  private clipBase: Path2D | null = null
  /** Task 75: hệ toạ độ của lần paint cuối — zoomanim cần biết vẽ theo zoom
   *  nào để scale canvas BÁM tiles trong animation (xem onZoomAnim).
   *  Task 77: các lần vẽ FORCED (giữa animation) KHÔNG đụng vào mốc này —
   *  canvas phải neo theo view NGHỈ để công thức transform còn đúng. */
  private lastPaintZoom: number | null = null
  private lastCenter: L.LatLng | null = null
  /** Task 77: alpha LOD hiển thị (ease ~180ms) — hết bật/tắt đột ngột khi
   *  zoom vượt ngưỡng 11↔12 */
  private lodAlpha = 0
  private lastLodT: number | null = null
  private rafId = 0
  private lastFrame = 0
  /** đang zoom animation → dừng vẽ (Leaflet biến đổi pane theo scale);
   *  PAN thì vòng vẽ chạy liên tục — canvas neo lại viewport mỗi khung */
  private moving = false
  /** mốc thời gian bật lớp (fade-in) — Infinity = chưa có trạm */
  private sinceOn = Infinity
  /** snapshot trạm khi tắt lớp — vẽ fade-out xong mới clear hẳn */
  private fading: { stations: AirQualityStationDto[]; at: number } | null = null

  constructor(map: L.Map) {
    this.map = map
    map.createPane('aqiPane')
    const pane = map.getPane('aqiPane')
    if (pane) {
      pane.style.zIndex = '370'
      pane.style.pointerEvents = 'none'
    }
    this.canvas = L.DomUtil.create('canvas', 'aqi-field-canvas', pane) as HTMLCanvasElement
    this.field = document.createElement('canvas')
    this.fieldCtx = this.field.getContext('2d')
    this.mid = document.createElement('canvas')
    this.midCtx = this.mid.getContext('2d')
    this.redraw = this.redraw.bind(this)
    map.on('moveend zoomend resize', this.redraw)
    // Task 77: KHÔNG pause trên zoomstart nữa — pinch zoom (mobile) không đi qua
    // animation Leaflet nên vòng vẽ phải chạy liên tục như PAN để canvas bám tay
    // người dùng; chỉ pause khi có animation thật (moving=true trong onZoomAnim)
    // Task 75: canvas phải TỰ transform trong zoom animation như Renderer/GridLayer
    // — pane tùy chỉnh KHÔNG được Leaflet scale giúp; thiếu nó thì trường màu đứng
    // nguyên pixel cũ suốt 250ms animation → màu lệch khỏi bản đồ ("chạy màu"),
    // chỉ bật lại đúng ở zoomend (cảm giác "đơ")
    map.on('zoomanim', this.onZoomAnim)
    this.rafId = requestAnimationFrame(this.loop)
  }

  setStations(stations: AirQualityStationDto[]): void {
    if (stations.length > 0) {
      this.stations = stations
      this.sinceOn = performance.now()
      this.fading = null
    } else if (this.stations.length > 0) {
      // tắt lớp → fade-out mượt từ snapshot cũ rồi mới clear
      this.fading = { stations: this.stations, at: performance.now() }
      this.stations = []
    }
    this.redraw()
  }

  /** Cắt trường AQI theo ranh giới phường/xã của thành phố — màu không tràn ra
   *  ngoài thành phố đã khoá (phản hồi user: "cục AQI tràn ra ngoài rất xấu"). */
  setClip(fc: FeatureCollection | null): void {
    const rings: number[][][] = []
    if (fc) {
      for (const f of fc.features) {
        const g = f.geometry
        if (!g) continue
        if (g.type === 'Polygon') {
          for (const ring of g.coordinates) rings.push(ring)
        } else if (g.type === 'MultiPolygon') {
          for (const poly of g.coordinates) for (const ring of poly) rings.push(ring)
        }
      }
    }
    this.clipRings = rings
    this.clipBase = null // buộc dựng lại Path2D gốc
    this.redraw()
  }

  /** Path2D clip gốc ở map px zoom 12 — dựng 1 lần (Task 77) */
  private ensureClipBase(): Path2D | null {
    if (this.clipBase) return this.clipBase
    let path: Path2D | null = null
    if (this.clipRings.length > 0) {
      path = new Path2D()
      for (const ring of this.clipRings) {
        // GeoJSON ring = [lng, lat] → đổi thứ tự cho Leaflet
        for (let i = 0; i < ring.length; i++) {
          const pt = this.map.project([ring[i][1], ring[i][0]], 12)
          if (i === 0) path.moveTo(pt.x, pt.y)
          else path.lineTo(pt.x, pt.y)
        }
        path.closePath()
      }
    }
    this.clipBase = path
    return path
  }

  /** Task 75 + 77: trong zoom animation, scale + dịch canvas theo đúng công thức
   *  Renderer._updateTransform của Leaflet để màu bám tiles mượt quanh tâm
   *  animation; paint() ở zoomend sẽ setPosition lại (ghi đè transform) → sạch.
   *
   *  Task 77 (fix "đơ + vỡ hạt + chảy màu" triệt để): NGAY KHI animation bắt đầu,
 *  vẽ lại trường ở ĐỘ PHÂN GIẢI ĐÍCH — lưới nội suy mịn hơn 2^Δ (mỗi ô 16/2^Δ px)
 *  nhưng canvas vẫn neo view NGHỈ (không đổi vị trí) → công thức transform cũ
 *  áp nguyên vẹn, màu sắc tại 1 điểm địa lý GIỮ NGUYÊN so với thiết kế. Khi
 *  canvas bị CSS-scale 2–4× giữa animation, nội dung mịn sẵn nên KHÔNG vỡ hạt
 *  "viên gạch" (zoom in); zoom out canvas tự thu nhỏ (dư phân giải) nên không
 *  cần vẽ lại. Kèm theo: bỏ CSS blur(18px) (nhân theo scale → mờ 72px = "chạy
 *  màu") — làm mềm gradient nằm trong pixel canvas (2 lượt bilinear + filter). */
  private onZoomAnim = (e: L.ZoomAnimEvent): void => {
    const canvas = this.canvas
    if (!canvas) return
    this.moving = true // dừng vòng vẽ suốt animation (pan/pinch vẫn vẽ)
    if (this.lastPaintZoom === null || !this.lastCenter) return
    // zoom IN → vẽ lại mịn theo zoom đích (zoom OUT: nội dung cũ tự thu nhỏ mượt)
    if (e.zoom > this.lastPaintZoom) {
      this.paint(performance.now(), e.zoom)
    }
    const map = this.map
    const scale = map.getZoomScale(e.zoom, this.lastPaintZoom)
    if (!Number.isFinite(scale) || scale <= 0) return
    const position = L.DomUtil.getPosition(canvas)
    const viewHalf = map.getSize().multiplyBy(0.5)
    const currentCenterPoint = map.project(this.lastCenter, e.zoom)
    const destCenterPoint = map.project(e.center, e.zoom)
    const centerOffset = destCenterPoint.subtract(currentCenterPoint)
    const topLeftOffset = viewHalf
      .multiplyBy(-scale)
      .add(position)
      .add(viewHalf)
      .subtract(centerOffset)
    L.DomUtil.setTransform(canvas, topLeftOffset, scale)
  }

  private loop = (ts: number): void => {
    this.rafId = requestAnimationFrame(this.loop)
    if (this.moving || document.hidden) return
    if (ts - this.lastFrame < 1000 / AQI_FIELD_FPS) return
    this.lastFrame = ts
    this.paint(ts)
  }

  redraw(): void {
    this.moving = false
    this.paint(performance.now())
  }

  /** Vẽ 1 khung trường AQI.
   *
   *  Tham số `targetZoom` (Task 77) chỉ dùng giữa animation zoom (onZoomAnim):
   *  vẽ lại NỘI DUNG mịn theo zoom ĐÍCH (lưới 16/2^Δ px) nhưng canvas vẫn neo
   *  view NGHỈ (lastCenter/lastPaintZoom giữ nguyên — không setPosition, không
   *  đụng mốc neo) để công thức transform Task 75 áp nguyên vẹn. Lưới mịn snap
   * đúng bội ô của zoom đích (16/2^Δ × 2^Δ = 16 px tại zoom đích) nên lần vẽ
   * lại ở zoomend ra CÙNG MÀU — không bật/tắt đột ngột. */
  private paint(t: number, targetZoom?: number): void {
    const map = this.map
    const canvas = this.canvas
    if (!canvas) return
    const size = map.getSize()
    if (size.x === 0 || size.y === 0) return
    const forced =
      targetZoom != null && this.lastPaintZoom !== null && this.lastCenter !== null
    const viewZoom = forced ? (this.lastPaintZoom as number) : map.getZoom()
    const viewCenter = forced ? (this.lastCenter as L.LatLng) : map.getCenter()
    if (!forced) {
      // Task 75: lưu mốc neo của view NGHỈ TRƯỚC các return sớm — zoomanim cần;
      // lần vẽ FORCED phải giữ mốc cũ (canvas neo view nghỉ, chỉ đổi nội dung)
      this.lastPaintZoom = viewZoom
      this.lastCenter = viewCenter
    }
    // backing store supersample ×SS (Task 77) — CSS px vẫn = size để Leaflet
    // layout như cũ; style.width/height ghim tránh canvas phình theo attribute
    const bw = Math.round(size.x * AQI_FIELD_SS)
    const bh = Math.round(size.y * AQI_FIELD_SS)
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
      canvas.style.width = size.x + 'px'
      canvas.style.height = size.y + 'px'
    }
    if (!forced) {
      // neo canvas theo góc trái-trên của khung nhìn (trong layer point space)
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]))
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(AQI_FIELD_SS, 0, 0, AQI_FIELD_SS, 0, 0)
    ctx.clearRect(0, 0, size.x, size.y)
    // ---- LOD: zoom quá xa → ẩn trường (chỉ badge trạm) — Task 65; Task 77
    //      ease ~180ms để hết bật/tắt đột ngột khi vượt ngưỡng 11↔12 ----
    const lodZoom = targetZoom != null ? targetZoom : viewZoom
    const lodTarget = Math.max(
      0,
      Math.min(1, (lodZoom - AQI_FIELD_MIN_ZOOM) / (AQI_FIELD_FULL_ZOOM - AQI_FIELD_MIN_ZOOM)),
    )
    if (forced) {
      this.lodAlpha = lodTarget
    } else {
      if (this.lastLodT === null) this.lastLodT = t
      const dt = Math.max(0, Math.min(500, t - this.lastLodT))
      this.lastLodT = t
      const k = 1 - Math.exp(-dt / 60) // hằng số thời gian 60ms ≈ hội tụ 180ms
      this.lodAlpha += (lodTarget - this.lodAlpha) * k
      if (Math.abs(lodTarget - this.lodAlpha) < 0.004) this.lodAlpha = lodTarget
    }
    if (this.lodAlpha <= 0) return
    // ---- chọn bộ trạm hiển thị + alpha master (fade in/out 450ms) ----
    let stations = this.stations
    let master = Math.min(1, (t - this.sinceOn) / AQI_FIELD_FADE_MS)
    if (this.fading) {
      const k = (t - this.fading.at) / AQI_FIELD_FADE_MS
      if (k >= 1) this.fading = null
      else {
        stations = this.fading.stations
        master = 1 - k
      }
    }
    if (stations.length === 0 || master <= 0) return

    // ---- gốc tuyệt đối của viewport trong map px (Web Mercator tại zoom neo —
    //      forced dùng view NGHỈ, không phải view đích) — NÉO ĐỊA LÝ (Task 68) ----
    const origin = map.project(viewCenter, viewZoom).subtract(size.divideBy(2))
    // Task 77: bước lưới mịn hơn 2^Δ khi vẽ forced (zoom in) — mỗi ô lưới canvas
    // chiếm 16/2^Δ px view nghỉ = đúng 16 px tại zoom đích → CSS-scale 2^Δ xong
    // vẫn ra ô 16px màn hình (native) — hết "viên gạch"; snap bội spacing bảo
    // đảm cùng 1 điểm địa lý luôn cùng ô với lần vẽ zoomend sau đó (không snap màu)
    let spacing = AQI_FIELD_GRID_PX
    if (forced && targetZoom != null && targetZoom > viewZoom) {
      spacing = AQI_FIELD_GRID_PX / Math.pow(2, targetZoom - viewZoom)
    }
    if ((size.x * size.y) / (spacing * spacing) > AQI_FIELD_MAX_CELLS) {
      spacing = Math.sqrt((size.x * size.y) / AQI_FIELD_MAX_CELLS)
    }
    const gridOriginX = Math.floor(origin.x / spacing) * spacing
    const gridOriginY = Math.floor(origin.y / spacing) * spacing
    const offX = origin.x - gridOriginX // ∈ [0, spacing)
    const offY = origin.y - gridOriginY
    const gw = Math.max(2, Math.ceil((size.x + offX) / spacing))
    const gh = Math.max(2, Math.ceil((size.y + offY) / spacing))
    if (this.field.width !== gw || this.field.height !== gh) {
      this.field.width = gw
      this.field.height = gh
      this.imgData = null
    }
    const fctx = this.fieldCtx
    if (!fctx) return
    if (!this.imgData || this.imgData.width !== gw || this.imgData.height !== gh) {
      this.imgData = fctx.createImageData(gw, gh)
    }
    const data = this.imgData.data

    // trạm → map px tuyệt đối tại zoom neo (không phụ thuộc vị trí kéo)
    // CHỈ trạm còn số liệu (available) — trạm xám tạm ngừng KHÔNG đóng góp
    // vào trường nội suy (yêu cầu 28/10: trạm không AQI không góp lớp AQI)
    const pts = stations
      .filter((s) => isStationAvailable(s))
      .map((s) => {
        const p = map.project([s.lat, s.lng], viewZoom)
        return { x: p.x, y: p.y, aqi: s.aqi as number }
      })
    const mPerPx =
      (156543.03392 * Math.cos((viewCenter.lat * Math.PI) / 180)) / Math.pow(2, viewZoom)
    const kmPerPx = mPerPx / 1000
    const rPx = AQI_FIELD_RADIUS_KM / kmPerPx
    const rPx2 = rPx * rPx
    const nearPx = AQI_FIELD_NEAR_KM / kmPerPx
    const span = Math.max(1, rPx - nearPx)
    const waveT = ((t % (AQI_FIELD_WAVE_MS * 2)) / (AQI_FIELD_WAVE_MS * 2)) * Math.PI * 2

    for (let j = 0; j < gh; j++) {
      const my = gridOriginY + (j + 0.5) * spacing
      for (let i = 0; i < gw; i++) {
        const mx = gridOriginX + (i + 0.5) * spacing
        let sumW = 0
        let sumV = 0
        let dNear2 = Infinity
        for (let s = 0; s < pts.length; s++) {
          const dx = mx - pts[s].x
          const dy = my - pts[s].y
          const d2 = dx * dx + dy * dy
          if (d2 > rPx2) continue
          if (d2 < dNear2) dNear2 = d2
          const w = 1 / (d2 + 40) // IDW p=2 + ε tránh chia 0 tại tâm trạm
          sumW += w
          sumV += w * pts[s].aqi
        }
        const idx = (j * gw + i) * 4
        if (!Number.isFinite(dNear2)) continue // ngoài tầm mọi trạm → trong suốt
        // mép mềm: đầy đủ trong nearPx, suy biến tuyến tính về 0 tại rPx
        const edge = 1 - (Math.sqrt(dNear2) - nearPx) / span
        if (edge <= 0) continue
        // sóng chuyển động: 2 sin lệch pha/tần số đi chéo qua trường — Task 75:
        // PHA neo TOẠ ĐỘ THẾ GIỚI (project zoom 0 = map px ÷ 2^zoom) × 2^12, để
        // mẫu sóng KHÔNG nhảy pha khi zoom (trước đây neo map px của zoom hiện
        // tại → mỗi bậc zoom pha ×2 → sóng "chạy" đột ngột khi zoom in/out);
        // tại zoom 12 mẫu sóng giống hệt thiết kế gốc
        const waveWorld = Math.pow(2, -viewZoom)
        const waveX = mx * waveWorld
        const waveY = my * waveWorld
        const wave =
          0.5 * Math.sin(waveT - (waveX + waveY) * AQI_FIELD_WAVE_K0) +
          0.5 * Math.sin(waveT * 0.63 + (waveX - waveY) * AQI_FIELD_WAVE_K0_B)
        const value = sumW > 0 ? sumV / sumW : 0
        const rgb = aqiColorRgb(value)
        const alpha =
          AQI_FIELD_ALPHA *
          this.lodAlpha *
          master *
          edge *
          (1 - AQI_FIELD_WAVE_AMPL + AQI_FIELD_WAVE_AMPL * wave)
        data[idx] = rgb[0]
        data[idx + 1] = rgb[1]
        data[idx + 2] = rgb[2]
        data[idx + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
      }
    }
    // Task 77: GAUSS premultiplied trên dữ liệu lưới NHỎ trước khi phóng —
    // σ 9 CSS px quy về mẫu lưới (9/spacing); blur trước + phóng bilinear sau ≡
    // look cũ (phóng + blur σ9), chạy mọi trình duyệt (không phụ thuộc ctx.filter)
    aqiBlurFieldData(data, gw, gh, 9 / spacing)
    fctx.putImageData(this.imgData, 0, 0)
    // ---- clip ranh giới thành phố: Path2D gốc zoom 12 + ctx.scale ma trận
    //      2^(zoom−12) (Task 77 — không chiếu lại đỉnh mỗi zoom) ----
    const clipBase = this.ensureClipBase()
    ctx.save()
    ctx.translate(-origin.x, -origin.y) // sang hệ map px tuyệt đối tại zoom neo
    if (clipBase) {
      ctx.scale(Math.pow(2, viewZoom - 12), Math.pow(2, viewZoom - 12)) // đỉnh zoom-12 → zoom neo
      ctx.clip(clipBase)
    }
    ctx.setTransform(AQI_FIELD_SS, 0, 0, AQI_FIELD_SS, 0, 0) // về canvas space — clip đã khoá device space
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // Task 77: 2 lượt phóng bilinear (field → mid ×4 → canvas) — bậc thang màu
    // giữa 2 lần nội suy được làm tròn thêm (bilinear² ≈ cubic), cộng với Gauss
    // phía trên cho gradient mềm như CSS blur(18px) cũ nhưng NẰM TRONG pixel,
    // transform zoom KHÔNG nhân độ mờ (hết "chạy màu" khi animation)
    const mctx = this.midCtx
    if (mctx) {
      const mw = gw * 4
      const mh = gh * 4
      if (this.mid.width !== mw || this.mid.height !== mh) {
        this.mid.width = mw
        this.mid.height = mh
      }
      mctx.imageSmoothingEnabled = true
      mctx.imageSmoothingQuality = 'high'
      mctx.clearRect(0, 0, mw, mh)
      mctx.drawImage(this.field, 0, 0, mw, mh)
      ctx.drawImage(this.mid, -offX, -offY, gw * spacing, gh * spacing)
    } else {
      ctx.drawImage(this.field, -offX, -offY, gw * spacing, gh * spacing)
    }
    ctx.restore()
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId)
    this.map.off('moveend zoomend resize', this.redraw)
    this.map.off('zoomanim', this.onZoomAnim)
  }
}

// ---------------------------------------------------------------------------
// Shared AQI tone + number formatting helpers (ward info panel)
// ---------------------------------------------------------------------------

function aqiTone(aqi: number): { label: string; className: string } {
  if (aqi <= 50) return { label: 'Tốt', className: 'text-emerald-600' }
  if (aqi <= 100) return { label: 'Trung bình', className: 'text-amber-600' }
  if (aqi <= 150) return { label: 'Kém — nhóm nhạy cảm', className: 'text-orange-600' }
  if (aqi <= 200) return { label: 'Xấu', className: 'text-red-600' }
  return { label: 'Rất xấu', className: 'text-red-700' }
}

function fmtNumber(v: number | null | undefined, suffix = ''): string {
  if (v == null || Number.isNaN(v)) return '—'
  return `${Number(v).toLocaleString('vi-VN')}${suffix}`
}

export default function MapView({
  zones,
  city,
  aqiStations = [],
  showAqi = false,
  routeCoords,
  markers = [],
  drawPoints,
  drawMode = false,
  onMapClick,
  pickMode = false,
  fitBoundsTo,
  fitPadding,
  className,
}: MapViewProps) {
  const cityName = city?.name ?? 'Hà Nội'
  const center: [number, number] = city
    ? [city.centerLat, city.centerLng]
    : HANOI_CENTER
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<L.LayerGroup | null>(null)

  // keep latest callbacks/props in refs without mutating during render
  const clickHandlerRef = useRef<((lat: number, lng: number) => void) | undefined>(undefined)
  const drawModeRef = useRef(false)
  const pickModeRef = useRef(false)
  const adminOnRef = useRef(true)
  const zoomRef = useRef(12)

  // admin layers + state
  const visualLayerRef = useRef<L.GeoJSON | null>(null)
  const hitLayerRef = useRef<L.GeoJSON | null>(null)
  const selectedRef = useRef<L.Path | null>(null)
  const selectedWardRef = useRef<{ key: string; latlngs: ExtLatLngs } | null>(null)
  const extRef = useRef<WardExtruder | null>(null)
  const aqiFieldRef = useRef<AqiFieldLayer | null>(null)
  const labelElsRef = useRef<Map<string, HTMLElement>>(new Map())
  const basemapLayersRef = useRef<Record<BasemapKey, L.TileLayer> | null>(null)
  const syncAdminRef = useRef<() => void>(() => {})

  const [basemap, setBasemap] = useState<BasemapKey>('street')
  const [adminOn, setAdminOn] = useState(true)
  const [zoomLevel, setZoomLevel] = useState(12)
  const [wardsState, setWardsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [panel, setPanel] = useState<WardPanel | null>(null)
  // Task 99 — panel chi tiết trạm kiểu PAM Air (click badge trạm)
  const [stationPanel, setStationPanel] = useState<{
    station: AirQualityStationDto
    detail: StationDetailDto | null
    state: 'loading' | 'ok' | 'error'
  } | null>(null)

  const openStationPanel = useCallback(
    (st: AirQualityStationDto) => {
      // Trạm tạm ngừng: chỉ thông tin cơ bản đã có trong DTO — không gọi API
      // lịch sử (user 28/10 chiều: "đã không hoạt động rồi thì lấy đâu ra
      // thông tin AQI" — không min/max, không biểu đồ 24h).
      if (!isStationAvailable(st)) {
        setStationPanel({ station: st, detail: null, state: 'ok' })
        return
      }
      const cityId = city?.id ?? 'hanoi'
      setStationPanel({ station: st, detail: null, state: 'loading' })
      apiFetch(
        `/api/airquality/stations/${encodeURIComponent(st.id)}?city=${encodeURIComponent(cityId)}`
      )
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status))
          return (await r.json()) as StationDetailDto
        })
        .then((d) =>
          setStationPanel((cur) =>
            cur && cur.station.id === st.id ? { station: cur.station, detail: d, state: 'ok' } : cur
          )
        )
        .catch(() =>
          setStationPanel((cur) =>
            cur && cur.station.id === st.id ? { station: cur.station, detail: null, state: 'error' } : cur
          )
        )
    },
    [city]
  )

  // demo dispatch hook removed (Task 43 — US demo tour taken down)

  // ---- sync latest handlers into refs (after render commit) ----
  useEffect(() => {
    clickHandlerRef.current = onMapClick
    drawModeRef.current = drawMode
    pickModeRef.current = pickMode
    adminOnRef.current = adminOn
  }, [onMapClick, drawMode, pickMode, adminOn])

  // ---- init map once ----
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    // LOCK vùng thành phố (multi-city Task 63 + phản hồi user):
    // pan luôn bị giới hạn trong bbox thành phố (viscosity 1.0 = tường cứng);
    // minZoom chặn zoom out ra khỏi tầm nhìn của thành phố.
    // Task 65: bbox bị KẸP lại quanh tâm thành phố (max half-span) — Đà Nẵng
    // (đặc khu Hoàng Sa) / TP.HCM (đặc khu Côn Đảo) có phường đảo cách đất
    // liền hàng chục km khiến bbox gốc trải ra biển → lock theo bbox gốc
    // cho phép pan ra đảo, vô nghĩa với LEZ đô thị.
    const LOCK_MAX_HALF_SPAN_LAT = 0.5
    const LOCK_MAX_HALF_SPAN_LNG = 0.7
    let cityBounds: L.LatLngBounds | null = null
    if (city?.bbox) {
      const cLat = city.centerLat ?? (city.bbox[0][0] + city.bbox[1][0]) / 2
      const cLng = city.centerLng ?? (city.bbox[0][1] + city.bbox[1][1]) / 2
      const south = Math.max(city.bbox[0][0], cLat - LOCK_MAX_HALF_SPAN_LAT)
      const west = Math.max(city.bbox[0][1], cLng - LOCK_MAX_HALF_SPAN_LNG)
      const north = Math.min(city.bbox[1][0], cLat + LOCK_MAX_HALF_SPAN_LAT)
      const east = Math.min(city.bbox[1][1], cLng + LOCK_MAX_HALF_SPAN_LNG)
      cityBounds = L.latLngBounds([south, west], [north, east])
    }
    const map = L.map(containerRef.current, {
      center,
      zoom: city?.defaultZoom ?? 12,
      zoomControl: false, // custom zoom buttons in the bottom-right stack
      scrollWheelZoom: true,
      maxBounds: cityBounds ? cityBounds.pad(0.1) : undefined,
      maxBoundsViscosity: 1.0,
      minZoom: Math.max(3, (city?.defaultZoom ?? 12) - 1),
    })
    zoomRef.current = city?.defaultZoom ?? 12

    // basemap tile layers (Esri street default — same as reference demo)
    const makeLayer = (cfg: (typeof BASEMAPS)[BasemapKey]) =>
      L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: cfg.maxZoom })
    const bLayers: Record<BasemapKey, L.TileLayer> = {
      street: makeLayer(BASEMAPS.street),
      satellite: makeLayer(BASEMAPS.satellite),
      osm: makeLayer(BASEMAPS.osm),
    }
    bLayers.street.addTo(map)
    basemapLayersRef.current = bLayers

    // dedicated pane BELOW the default overlay pane (zIndex 400) so LEZ
    // polygons, route polylines and markers always render above the admin layer
    map.createPane('adminPane')
    const pane = map.getPane('adminPane')
    if (pane) pane.style.zIndex = '350'

    // dedicated pane for the 3D ward pop-up (Task 31): above the admin layer
    // (350) so the lifted block covers its flat neighbours, below the overlay
    // pane (400) so LEZ/route/markers stay on top; never intercepts events
    map.createPane('extrusionPane')
    const extPane = map.getPane('extrusionPane')
    if (extPane) {
      extPane.style.zIndex = '380'
      extPane.style.pointerEvents = 'none'
    }
    extRef.current = new WardExtruder(map, L.svg({ pane: 'extrusionPane', padding: 0.5 }))
    aqiFieldRef.current = new AqiFieldLayer(map)

    layersRef.current = L.layerGroup().addTo(map)
    map.on('click', (e: L.LeafletMouseEvent) => {
      // admin draw-mode clicks take precedence; pick-mode (US-01) only fires
      // when draw mode is inactive so one click never triggers both handlers
      if (drawModeRef.current) {
        clickHandlerRef.current?.(e.latlng.lat, e.latlng.lng)
        return
      }
      if (pickModeRef.current) clickHandlerRef.current?.(e.latlng.lat, e.latlng.lng)
    })
    map.on('zoomend', () => {
      zoomRef.current = map.getZoom()
      setZoomLevel(map.getZoom())
      syncAdminRef.current()
    })
    mapRef.current = map
    // force invalidate after mount to fix sizing issues
    setTimeout(() => map.invalidateSize(), 150)
    return () => {
      extRef.current?.destroy()
      extRef.current = null
      aqiFieldRef.current?.destroy()
      aqiFieldRef.current = null
      map.remove()
      mapRef.current = null
      layersRef.current = null
      visualLayerRef.current = null
      hitLayerRef.current = null
      selectedRef.current = null
      selectedWardRef.current = null
      labelElsRef.current = new Map()
      basemapLayersRef.current = null
    }
  }, [])

  // ---- build the two admin sub-layers once wards geojson is available ----
  // (phụ thuộc city — đổi thành phố sẽ nạp ranh giới mới, Task 63)
  useEffect(() => {
    let cancelled = false
    void loadWards(city?.id ?? 'hanoi').then((fc) => {
      const map = mapRef.current
      if (cancelled || !fc || !map) {
        if (!cancelled && !fc) setWardsState('error')
        return
      }

      // dọn lớp cũ (đổi thành phố)
      if (visualLayerRef.current) map.removeLayer(visualLayerRef.current)
      if (hitLayerRef.current) map.removeLayer(hitLayerRef.current)
      visualLayerRef.current = null
      hitLayerRef.current = null
      selectedRef.current = null
      selectedWardRef.current = null
      setPanel(null)

      // 1) visual layer — non-interactive, canvas, always on the map.
      //    Carries the permanent ward-name labels (CSS-toggled by zoom).
      //    (cast: Leaflet's GeoJSONOptions type omits `renderer`)
      const visual = L.geoJSON(fc, {
        pane: 'adminPane',
        renderer: L.canvas({ pane: 'adminPane', padding: 0.3 }),
        interactive: false,
        bubblingMouseEvents: false,
        style: (f) => adminStyle(zoomRef.current, f),
        onEachFeature: (feature: Feature, layer: L.Layer) => {
          const p = feature.properties as WardProps | undefined
          if (p?.ten_xa) {
            layer.bindTooltip(p.ten_xa, {
              permanent: true,
              direction: 'center',
              className: 'ward-label',
            })
          }
        },
      } as L.GeoJSONOptions).addTo(map)

      // 2) hit layer — interactive SVG twin. Added/removed by syncAdmin()
      //    so it never swallows clicks needed for pick/draw/street mode.
      const hit = L.geoJSON(fc, {
        pane: 'adminPane',
        renderer: L.svg({ pane: 'adminPane', padding: 0.5 }),
        style: (f) => adminStyle(zoomRef.current, f),
        onEachFeature: (feature: Feature, layer: L.Layer) => {
          const p = feature.properties as WardProps | undefined
          if (p?.ten_xa) {
            layer.bindTooltip(p.ten_xa, { sticky: true, direction: 'top', className: 'ward-tip' })
          }
          layer.on('mouseover', () => {
            // 3D pop-up replaces the old thick-border hover highlight
            if (p?.ma_xa) {
              const ll = (layer as L.Polygon).getLatLngs() as ExtLatLngs
              extRef.current?.lift(p.ma_xa, ll, labelElsRef.current.get(p.ma_xa) ?? null, wardColor(p.ma_xa).top)
            }
          })
          layer.on('mouseout', () => {
            if (selectedRef.current !== layer) {
              // keep the selected ward lifted while its panel is open
              const sel = selectedWardRef.current
              if (sel) {
                extRef.current?.lift(sel.key, sel.latlngs, labelElsRef.current.get(sel.key) ?? null, wardColor(sel.key).top)
              } else {
                extRef.current?.drop()
              }
            }
          })
          layer.on('click', () => {
            const path = layer as L.Path
            if (selectedRef.current && selectedRef.current !== path) {
              hit.resetStyle(selectedRef.current)
            }
            selectedRef.current = path
            path.setStyle(WARD_HOVER)
            const ll = (layer as L.Polygon).getLatLngs() as ExtLatLngs
            if (p?.ma_xa) {
              selectedWardRef.current = { key: p.ma_xa, latlngs: ll }
              extRef.current?.lift(p.ma_xa, ll, labelElsRef.current.get(p.ma_xa) ?? null, wardColor(p.ma_xa).top)
            }
            // every ward feature is a (Multi)Polygon — cast for getBounds()
            const center = (layer as unknown as L.Polygon).getBounds().getCenter()
            setPanel({
              ward: p as WardProps,
              lat: center.lat,
              lng: center.lng,
            })
          })
        },
      } as L.GeoJSONOptions)

      visualLayerRef.current = visual
      hitLayerRef.current = hit

      // cache the permanent-label DOM elements by ward code (Task 31: the
      // lifted ward hides its flat label so the popped block owns the name)
      const labelEls = new Map<string, HTMLElement>()
      visual.eachLayer((l) => {
        const f = (l as unknown as { feature?: Feature }).feature
        const p = f?.properties as WardProps | undefined
        const el = (l as L.Polygon).getTooltip()?.getElement()
        if (p?.ma_xa && el) labelEls.set(p.ma_xa, el)
      })
      labelElsRef.current = labelEls

      setWardsState('ready')
      // cắt trường AQI theo ranh giới thành phố vừa nạp
      aqiFieldRef.current?.setClip(fc)
      syncAdminRef.current()
    })
    return () => {
      cancelled = true
    }
  }, [city?.id])

  // ---- sync admin hit layer with zoom/mode/toggle ----
  useEffect(() => {
    const syncAdmin = () => {
      const map = mapRef.current
      const hit = hitLayerRef.current
      const visual = visualLayerRef.current
      if (!map || !hit || !visual) return
      const z = map.getZoom()
      const wantHit = adminOnRef.current && z < ZOOM_STREET && !drawModeRef.current && !pickModeRef.current
      if (wantHit && !map.hasLayer(hit)) hit.addTo(map)
      else if (!wantHit && map.hasLayer(hit)) {
        map.removeLayer(hit)
        extRef.current?.drop() // street/draw/pick mode — never leave a block floating
      }
      // per-ward colors depend on zoom — restyle every feature of both layers
      const restyle = (gj: L.GeoJSON) => {
        gj.eachLayer((l) => {
          const f = (l as unknown as { feature?: Feature }).feature
          ;(l as L.Path).setStyle(adminStyle(z, f))
        })
      }
      restyle(visual)
      restyle(hit)
    }
    syncAdminRef.current = syncAdmin
    syncAdmin()
  }, [adminOn, drawMode, pickMode, wardsState])

  // ---- đồng bộ trạm đo thật → trường AQI mượt (Task 63) ----
  useEffect(() => {
    const field = aqiFieldRef.current
    if (!field) return
    field.setStations(showAqi ? aqiStations : [])
  }, [aqiStations, showAqi, wardsState])

  // ---- basemap switching ----
  useEffect(() => {
    const map = mapRef.current
    const layers = basemapLayersRef.current
    if (!map || !layers) return
    ;(Object.keys(layers) as BasemapKey[]).forEach((key) => {
      if (key === basemap) {
        if (!map.hasLayer(layers[key])) layers[key].addTo(map)
      } else if (map.hasLayer(layers[key])) {
        map.removeLayer(layers[key])
      }
    })
  }, [basemap])

  const closePanel = () => {
    setPanel(null)
    const hit = hitLayerRef.current
    const selected = selectedRef.current
    if (hit && selected) hit.resetStyle(selected)
    selectedRef.current = null
    selectedWardRef.current = null
    extRef.current?.drop()
  }

  // Esc closes the ward panel (unless the planner pick mode wants Esc first)
  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pickModeRef.current) closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel])

  // ---- redraw dynamic layers ----
  const renderKey = useMemo(
    () =>
      JSON.stringify({
        z: zones.map((z) => [z.id, z.active, z.coordinates]),
        r: routeCoords ? routeCoords.length : 0,
        m: markers,
        d: drawPoints,
      }),
    [zones, routeCoords, markers, drawPoints]
  )

  useEffect(() => {
    const map = mapRef.current
    const group = layersRef.current
    if (!map || !group) return
    group.clearLayers()

    // LEZ polygons
    for (const zone of zones) {
      if (!zone.active) continue
      const latlngs = zone.coordinates.map(([lat, lng]) => [lat, lng]) as [number, number][]
      L.polygon(latlngs, {
        color: '#dc2626',
        weight: 2,
        fillColor: '#ef4444',
        fillOpacity: 0.18,
      })
        .bindTooltip(`<strong>${zone.name}</strong><br/>Vùng phát thải thấp (LEZ)`, { sticky: true })
        .addTo(group)
    }

    // route polyline
    if (routeCoords && routeCoords.length > 1) {
      L.polyline(routeCoords, {
        color: '#bbf7d0',
        weight: 12,
        opacity: 0.35,
        lineCap: 'round',
      }).addTo(group)
      L.polyline(routeCoords, {
        color: '#16a34a',
        weight: 5,
        opacity: 0.85,
        lineCap: 'round',
      }).addTo(group)
    }

    // badge trạm đo thật (Task 63): vòng tròn màu AQI + số — tooltip minh bạch nguồn
    // 28/10 Task 99: (1) trạm tạm ngừng số liệu → badge XÁM, không tham gia lớp AQI;
    // (2) CLICK trạm mở PANEL CHI TIẾT kiểu PAM Air (tên, VN AQI, giờ cập nhật,
    // min/max 24h + biểu đồ lịch sử 24h) — thay cho popup HTML cũ
    if (showAqi) {
      for (const st of aqiStations) {
        const ok = isStationAvailable(st)
        const cat = ok ? aqiCategory(st.aqi as number) : null
        const icon = L.divIcon({
          className: 'rideshift-marker',
          html:
            `<div style="background:${ok ? cat!.color : '#94a3b8'};color:${ok ? '#fff' : '#e2e8f0'};` +
            `width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;` +
            `font-size:${ok ? '11px' : '15px'};font-weight:800;box-shadow:0 1px 5px rgba(0,0,0,.35);` +
            `border:2.5px solid white${ok ? '' : ';opacity:.85'}">${ok ? st.aqi : '–'}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        })
        const timeLabel = st.measuredAt
        L.marker([st.lat, st.lng], { icon, zIndexOffset: ok ? 500 : 400 })
          .bindTooltip(
            `<strong>${st.name}</strong><br/>` +
            (ok
              ? `AQI ${st.aqi} · ${cat!.label}<br/>`
              : `<span style=\"color:#94a3b8\">Tạm ngừng cập nhật số liệu</span><br/>`) +
            `<span style="color:#64748b">${st.sourceLabel}</span><br/>` +
            `<span style="color:#64748b">${ok ? 'Đo lúc' : 'Cập nhật cuối'}: ${timeLabel}</span><br/>` +
            `<span style="color:#94a3b8;font-size:10px">Bấm để xem chi tiết trạm</span>`,
            { direction: 'top', offset: [0, -4] }
          )
          .on('click', () => openStationPanel(st))
          .addTo(group)
      }
    }

    // markers
    for (const mk of markers) {
      const style: Record<string, { color: string; glyph: string }> = {
        origin: { color: '#16a34a', glyph: 'A' },
        destination: { color: '#ea580c', glyph: 'B' },
        transport: { color: '#0d9488', glyph: 'ⓢ' },
        point: { color: '#64748b', glyph: '•' },
      }
      const s = style[mk.kind] ?? style.point
      const icon = L.divIcon({
        className: 'rideshift-marker',
        html: `<div style="background:${s.color};color:white;width:26px;height:26px;border-radius:50% 50% 50% 4px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.4);border:2px solid white;transform:rotate(-45deg)"><span style="transform:rotate(45deg)">${s.glyph}</span></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 24],
      })
      L.marker([mk.lat, mk.lng], { icon })
        .bindTooltip(mk.label, { direction: 'top' })
        .addTo(group)
    }

    // draw vertices preview
    if (drawPoints && drawPoints.length > 0) {
      L.polyline([...drawPoints, drawPoints[0]], {
        color: '#b45309',
        weight: 2,
        dashArray: '6 4',
        fillOpacity: 0,
      }).addTo(group)
      for (const [lat, lng] of drawPoints) {
        L.circleMarker([lat, lng], {
          radius: 5,
          color: '#b45309',
          fillColor: '#f59e0b',
          fillOpacity: 1,
        }).addTo(group)
      }
    }

    void renderKey
  }, [renderKey, zones, routeCoords, markers, drawPoints, aqiStations, showAqi, openStationPanel])

  // ---- fit bounds ----
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (fitBoundsTo && fitBoundsTo.length > 1) {
      const bounds = L.latLngBounds(fitBoundsTo)
      if (fitPadding && (fitPadding.topLeft || fitPadding.bottomRight)) {
        map.fitBounds(bounds, {
          paddingTopLeft: fitPadding.topLeft ?? [0, 0],
          paddingBottomRight: fitPadding.bottomRight ?? [0, 0],
        })
      } else {
        map.fitBounds(bounds.pad(0.25))
      }
    } else if (fitBoundsTo && fitBoundsTo.length === 1) {
      map.setView(fitBoundsTo[0], 14)
    }
  }, [fitBoundsTo, fitPadding])

  // ---- derived UI state ----
  const adminMode = adminOn && wardsState === 'ready' && zoomLevel < ZOOM_STREET
  const labelsOn = adminMode && zoomLevel >= ZOOM_LABELS

  return (
    <div
      className={`${className ?? ''} ${labelsOn ? 'ward-labels-on' : ''}`}
      style={{ position: 'relative', zIndex: 0 }}
      role="application"
      aria-label={`Bản đồ tương tác ${cityName} với các vùng LEZ, ranh giới phường/xã, trường chất lượng không khí và tuyến đường`}
    >
      <div
        ref={containerRef}
        style={{ position: 'absolute', inset: 0, cursor: pickMode ? 'crosshair' : undefined }}
      />

      {/* ---- ward info panel (layer 1: click a phường/xã) ---- */}
      {panel && (
        <WardPanelCard
          key={`${panel.ward.ma_xa}-${panel.lat.toFixed(5)}-${panel.lng.toFixed(5)}`}
          panel={panel}
          showAqiSection={city?.id === 'hanoi'}
          onClose={closePanel}
        />
      )}

      {/* ---- station detail panel (Task 99 — click badge trạm AQI, kiểu PAM Air) ---- */}
      {stationPanel && (
        <StationPanelCard
          key={stationPanel.station.id}
          station={stationPanel.station}
          detail={stationPanel.detail}
          state={stationPanel.state}
          onClose={() => setStationPanel(null)}
        />
      )}

      {/* ---- ward loading/error status (bottom-left; chỉ hiện khi đang tải / lỗi — Task 67 bỏ caption chế độ) ---- */}
      {(wardsState === 'loading' || wardsState === 'error') && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-[92px] left-3 z-[900] max-w-[70%] rounded-full border bg-card/95 px-3 py-1.5 text-[11px] font-medium shadow-sm backdrop-blur sm:bottom-3 sm:max-w-[75%]"
        >
          {wardsState === 'loading'
            ? `⏳ Đang tải ranh giới hành chính ${cityName}…`
            : '⚠️ Không tải được ranh giới hành chính'}
        </div>
      )}

      {/* ---- layer controls (bottom-right) ---- */}
      <div className="absolute bottom-3 right-3 z-[900] flex flex-col items-end gap-2">
        {/* custom zoom buttons (zoomControl: false — avoids the floating planner panel at top-left) */}
        <div className="flex flex-col overflow-hidden rounded-lg border bg-card/95 shadow-sm backdrop-blur">
          <button
            type="button"
            aria-label="Phóng to bản đồ"
            title="Phóng to"
            onClick={() => mapRef.current?.zoomIn()}
            className="flex h-8 w-8 items-center justify-center border-b text-foreground transition-colors hover:bg-accent"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Thu nhỏ bản đồ"
            title="Thu nhỏ"
            onClick={() => mapRef.current?.zoomOut()}
            className="flex h-8 w-8 items-center justify-center text-foreground transition-colors hover:bg-accent"
          >
            <Minus className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setAdminOn((v) => !v)}
          aria-pressed={adminOn}
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm backdrop-blur transition-colors ${
            adminOn
              ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
              : 'border-border bg-card/95 text-foreground hover:bg-accent'
          }`}
        >
          <Landmark className="h-3.5 w-3.5" aria-hidden />
          Ranh giới hành chính
        </button>
        <div
          role="radiogroup"
          aria-label="Nền bản đồ"
          className="flex h-8 items-center gap-1 overflow-hidden rounded-lg border bg-card/95 p-1 shadow-sm backdrop-blur"
        >
          {(Object.keys(BASEMAPS) as BasemapKey[]).map((key) => {
            const cfg = BASEMAPS[key]
            const Icon = cfg.icon
            const active = basemap === key
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setBasemap(key)}
                className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors ${
                  active ? 'bg-emerald-600 text-white' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {cfg.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ward stats panel — remounted per selected ward (key = ma_xa + center), so
// state initializers replace effect-time setState resets.
// AQI: backend /api/airquality (cache-first). Weather: Open-Meteo direct.
// ---------------------------------------------------------------------------

function WardPanelCard({
  panel,
  showAqiSection,
  onClose,
}: {
  panel: WardPanel
  /** AQI chỉ mở cho Hà Nội (Đà Nẵng/TP.HCM chỉ demo scalability — không có trạm) */
  showAqiSection: boolean
  onClose: () => void
}) {
  const [aqi, setAqi] = useState<AirQualityInfo | null>(null)
  const [aqiState, setAqiState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [weather, setWeather] = useState<{ temp: number | null; rain: number | null } | null>(null)

  // AQI (chỉ Hà Nội — Đà Nẵng/TP.HCM chỉ demo scalability, không có trạm)
  useEffect(() => {
    if (!showAqiSection) return
    let alive = true
    const { lat, lng } = panel
    apiFetch(`/api/airquality?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setAqi((d?.airQuality as AirQualityInfo | undefined) ?? null)
        setAqiState('ok')
      })
      .catch(() => {
        if (alive) setAqiState('error')
      })
    return () => {
      alive = false
    }
  }, [panel, showAqiSection])

  // weather (Open-Meteo direct — mọi thành phố)
  useEffect(() => {
    let alive = true
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${panel.lat.toFixed(4)}&longitude=${panel.lng.toFixed(4)}&current=temperature_2m,precipitation&timezone=Asia%2FBangkok`
    )
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setWeather({
          temp: d?.current?.temperature_2m ?? null,
          rain: d?.current?.precipitation ?? null,
        })
      })
      .catch(() => {
        if (alive) setWeather({ temp: null, rain: null })
      })
    return () => {
      alive = false
    }
  }, [panel])

  return (
    <aside
      className="absolute right-3 top-3 z-[900] w-[282px] max-w-[calc(100%-24px)] overflow-hidden rounded-xl border bg-card/95 shadow-lg backdrop-blur"
      role="dialog"
      aria-label={`Chỉ số khu vực ${panel.ward.ten_xa}`}
    >
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold leading-tight">{panel.ward.ten_xa}</h3>
          <span className="mt-1 inline-block rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-800 dark:bg-teal-900/40 dark:text-teal-200">
            {panel.ward.loai || 'Khu vực'}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng bảng chỉ số"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <dl className="px-4 py-2 text-xs">
        <div className="flex items-center justify-between border-b border-border/60 py-1.5 last:border-0">
          <dt className="text-muted-foreground">Mã khu vực</dt>
          <dd className="font-medium">{panel.ward.ma_xa || '—'}</dd>
        </div>
        <div className="flex items-center justify-between border-b border-border/60 py-1.5 last:border-0">
          <dt className="text-muted-foreground">Diện tích</dt>
          <dd className="font-medium">{fmtNumber(panel.ward.dtich_km2, ' km²')}</dd>
        </div>
        <div className="flex items-center justify-between border-b border-border/60 py-1.5 last:border-0">
          <dt className="text-muted-foreground">Dân số</dt>
          <dd className="font-medium">{fmtNumber(panel.ward.dan_so, ' người')}</dd>
        </div>
        <div className="flex items-center justify-between border-b border-border/60 py-1.5 last:border-0">
          <dt className="text-muted-foreground">Mật độ</dt>
          <dd className="font-medium">{fmtNumber(panel.ward.matdo_km2, ' người/km²')}</dd>
        </div>
      </dl>

      {panel.ward.sap_nhap ? (
        <p className="px-4 pb-2 text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium">Sáp nhập từ: </span>
          {panel.ward.sap_nhap}
        </p>
      ) : null}

      <div className="border-t px-4 py-2.5 text-xs">
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Môi trường · theo tâm vùng
        </h4>
        {showAqiSection && (
          <div className="flex items-center justify-between py-1">
            <span className="text-muted-foreground">AQI (US)</span>
            <span className="font-medium">
              {aqiState === 'loading' ? (
                'Đang tải…'
              ) : aqiState === 'error' || !aqi || aqi.aqi == null ? (
                'Không có dữ liệu'
              ) : (
                <>
                  {aqi.aqi}{' '}
                  <span className={aqiTone(aqi.aqi).className}>{aqiTone(aqi.aqi).label}</span>
                </>
              )}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between py-1">
          <span className="text-muted-foreground">Nhiệt độ</span>
          <span className="font-medium">
            {weather == null ? 'Đang tải…' : weather.temp != null ? `${weather.temp} °C` : 'Không có dữ liệu'}
          </span>
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-muted-foreground">Lượng mưa</span>
          <span className="font-medium">
            {weather == null ? 'Đang tải…' : weather.rain != null ? `${weather.rain} mm` : 'Không có dữ liệu'}
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          {showAqiSection
            ? 'AQI: trạm đo thật gần nhất → nội suy → mô hình Open-Meteo (cache 30 phút, US-19) · '
            : ''}
          Thời tiết: Open-Meteo
        </p>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Task 99 + 100 — Station detail modal (kiểu PAM Air): tên trạm + địa chỉ/toạ độ,
// VN AQI to + hạng màu, thời gian cập nhật, min/max 24h và biểu đồ lịch sử
// AQI 24 giờ. Task 100: hiện GIỮA màn hình, nền xung quanh mờ đi (giống cổng
// chọn thành phố) — đóng bằng nút X, Esc hoặc click nền mờ.
// Mở bằng cách CLICK badge trạm trên bản đồ.
// ---------------------------------------------------------------------------

/** "2026-10-27T13:00" | "13:00" | "13" → "13:00"
 *  Chuỗi ISO UTC (quan trắc tích luỹ, có "+00:00"/"Z") được quy đổi sang
 *  giờ Việt Nam (UTC+7) trước khi bóc nhãn — chuỗi của Sở đã là giờ VN. */
function hourLabelOf(t: string): string {
  const s = t ?? ''
  if (/[+-]00:00$|Z$/.test(s)) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) {
      const vn = new Date(d.getTime() + 7 * 3600_000)
      return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`
    }
  }
  let m = /T(\d{1,2}:\d{2})/.exec(s)
  if (m) return m[1]
  m = /(\d{1,2}:\d{2})/.exec(s)
  if (m) return m[1]
  if (/^\d{1,2}$/.test(s)) return `${s.padStart(2, '0')}:00`
  return s
}

function StationHistoryChart({ points }: { points: { time: string; aqi: number }[] }) {
  // 28/10 chiều — hover cột hiện ngay chỉ số (thay <title> native chậm và
  // khó thấy): mỗi cột có vùng đếm đúc cả chiều cao biểu đồ, tooltip nổi
  // ngay trên cột đang hover.
  const [hover, setHover] = useState<number | null>(null)
  const W = 320
  const H = 104
  const padL = 24
  const padR = 4
  const padT = 6
  const padB = 14
  const iw = W - padL - padR
  const ih = H - padT - padB
  if (points.length === 0) return null
  const maxVal = Math.max(...points.map((p) => p.aqi))
  // làm tròn max lên mốc 50 gần nhất (thang 0–50–100–150–200–300…)
  const max = Math.max(50, Math.ceil((maxVal * 1.12) / 50) * 50)
  const y = (v: number) => padT + ih * (1 - Math.min(v, max) / max)
  const bw = iw / points.length
  const ticks = [50, 100, 150, 200, 300].filter((t) => t < max)
  // nhãn trục x: đầu, cách nhau ~1/5 số cột, và cột cuối
  const step = Math.max(1, Math.ceil(points.length / 5))
  const labelIdx = new Set<number>()
  for (let i = 0; i < points.length; i += step) labelIdx.add(i)
  labelIdx.add(points.length - 1)

  // vị trí tooltip (giữ trong khung, không tràn mép)
  const hp = hover != null ? points[hover] : null
  const tipW = 108
  const tipH = 17
  const tipX =
    hp != null
      ? Math.min(
          W - padR - tipW,
          Math.max(padL, padL + hover! * bw + bw / 2 - tipW / 2)
        )
      : 0
  const tipY = hp != null ? Math.max(2, y(hp.aqi) - tipH - 3) : 0

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full text-foreground"
      role="img"
      aria-label="Biểu đồ lịch sử AQI theo giờ — di chuột lên cột để xem chỉ số"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(t)}
            y2={y(t)}
            stroke="currentColor"
            strokeOpacity={0.14}
            strokeDasharray="3 3"
          />
          <text x={padL - 3} y={y(t) + 3} textAnchor="end" fontSize={8} fill="currentColor" fillOpacity={0.55}>
            {t}
          </text>
        </g>
      ))}
      {points.map((p, i) => {
        const cat = aqiCategory(p.aqi)
        const on = hover === i
        return (
          <g key={i}>
            <rect
              x={padL + i * bw + 0.5}
              y={y(p.aqi)}
              width={Math.max(1, bw - 1)}
              height={Math.max(1, padT + ih - y(p.aqi))}
              fill={cat.color}
              rx={bw > 3 ? 1 : 0}
              opacity={hover == null || on ? 1 : 0.45}
            />
            {/* vùng hover đúc cả cột — dễ trúng hơn cột mảnh */}
            <rect
              x={padL + i * bw}
              y={padT}
              width={bw}
              height={ih}
              fill="transparent"
              style={{ cursor: 'help' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((cur) => (cur === i ? null : cur))}
              onClick={(e) => {
                e.stopPropagation()
                setHover(i) // chạm trên màn cảm ứng
              }}
            />
          </g>
        )
      })}
      {hp != null && (
        <g pointerEvents="none">
          <rect
            x={tipX}
            y={tipY}
            width={tipW}
            height={tipH}
            rx={4}
            fill="#0f172a"
            fillOpacity={0.92}
          />
          <text
            x={tipX + tipW / 2}
            y={tipY + 12}
            textAnchor="middle"
            fontSize={9}
            fontWeight={700}
            fill="#fff"
          >
            {`${hourLabelOf(hp.time)} · AQI ${hp.aqi} · ${aqiCategory(hp.aqi).label}`}
          </text>
        </g>
      )}
      {[...labelIdx].map((i) => (
        <text
          key={i}
          x={padL + i * bw + bw / 2}
          y={H - 3}
          textAnchor="middle"
          fontSize={8}
          fill="currentColor"
          fillOpacity={0.55}
        >
          {hourLabelOf(points[i].time)}
        </text>
      ))}
    </svg>
  )
}

function StationPanelCard({
  station,
  detail,
  state,
  onClose,
}: {
  station: AirQualityStationDto
  detail: StationDetailDto | null
  state: 'loading' | 'ok' | 'error'
  onClose: () => void
}) {
  const ok = isStationAvailable(station)
  const cat = ok ? aqiCategory(station.aqi as number) : null
  const headerBg = ok ? cat!.color : '#64748b'
  // trạm Sở báo VN AQI (thang VN); WAQI báo AQI thang US EPA
  const aqiLabel = station.source === 'moitruongthudo' ? 'VN AQI' : 'AQI (WAQI)'
  const history = detail?.history ?? null
  const lowest = detail?.lowest ?? null
  const highest = detail?.highest ?? null

  // Esc đóng modal (giống cổng chọn thành phố)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // PORTAL ra document.body: map container có stacking context riêng
  // (position:relative + z-index:0) nên overlay fixed bên trong sẽ bị các
  // panel z-1000 đè lên — portal đưa modal ra cấp trang như cổng chọn thành phố.
  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Chi tiết trạm quan trắc ${station.name}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
    <aside className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border bg-card shadow-2xl rs-scroll">
      {/* ---- header màu theo hạng AQI (kiểu PAM Air) ---- */}
      <div style={{ background: headerBg }} className="px-4 py-3 text-white">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 pr-4 text-sm font-bold leading-snug">{station.name}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng chi tiết trạm"
            className="-mr-1 shrink-0 rounded-md p-1 text-white/85 transition-colors hover:bg-white/20 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/85">
          {station.address ?? `(${station.lat.toFixed(5)}, ${station.lng.toFixed(5)})`}
        </p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white/80">{aqiLabel}</div>
            <div className="text-[34px] font-extrabold leading-none">
              {ok ? station.aqi : 'N/A'}
            </div>
            <div className="mt-1 text-[11px] font-medium">
              {ok ? cat!.label : 'AQI không khả dụng'}
            </div>
          </div>
          <div className="flex flex-col items-end text-[11px] text-white/90">
            <span className="inline-flex items-center gap-1 font-medium">
              <Clock className="h-3 w-3" aria-hidden />
              {ok ? 'Đo lúc' : 'Cập nhật cuối'}
            </span>
            <span>{formatAqiTime(station.measuredAt)}</span>
          </div>
        </div>
      </div>

      {/* ---- body ---- */}
      <div className="px-4 py-3 text-xs">
        {/* Trạm tạm ngừng: CHỈ thông tin cơ bản — không có min/max hay lịch sử
            24h (user 28/10 chiều: đã không hoạt động thì không có số liệu AQI) */}
        {!ok && (
          <>
            <p className="leading-relaxed text-muted-foreground">
              Trạm <span className="font-medium text-foreground">{station.name}</span> hiện{' '}
              <span className="font-medium">tạm ngừng cập nhật số liệu</span> (nguồn{' '}
              {station.sourceLabel} không còn trả AQI cho trạm này).
            </p>
            {station.url && (
              <a
                href={station.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline dark:text-emerald-400"
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                Xem trang trạm gốc
              </a>
            )}
          </>
        )}

        {ok && state === 'loading' && (
          <div className="flex items-center gap-2 py-4 text-muted-foreground" role="status">
            <span
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"
              aria-hidden
            />
            Đang tải lịch sử 24 giờ của trạm…
          </div>
        )}

        {ok && state === 'error' && (
          <p className="py-2 leading-snug text-muted-foreground" role="alert">
            Không tải được lịch sử 24h của trạm. Thông tin hiện tại: nguồn{' '}
            <span className="font-medium">{station.sourceLabel}</span>.
          </p>
        )}

        {ok && state === 'ok' && (
          <>
            <div className="mb-2.5 grid grid-cols-2 gap-2">
              <div className="rounded-lg border bg-background/60 px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Thấp nhất 24h
                </div>
                <div
                  className="text-lg font-bold leading-tight"
                  style={{ color: lowest != null ? aqiCategory(lowest).color : undefined }}
                >
                  {lowest ?? '—'}
                </div>
              </div>
              <div className="rounded-lg border bg-background/60 px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Cao nhất 24h
                </div>
                <div
                  className="text-lg font-bold leading-tight"
                  style={{ color: highest != null ? aqiCategory(highest).color : undefined }}
                >
                  {highest ?? '—'}
                </div>
              </div>
            </div>

            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Lịch sử AQI (24 giờ gần nhất)
            </h4>
            {history && history.length > 0 ? (
              <StationHistoryChart points={history} />
            ) : (
              <p className="py-2 leading-snug text-muted-foreground">
                Chưa có dữ liệu lịch sử 24 giờ cho trạm này.
              </p>
            )}

            {station.url && (
              <a
                href={station.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline dark:text-emerald-400"
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                Xem trang trạm gốc
              </a>
            )}
          </>
        )}
      </div>
    </aside>
    </div>,
    document.body
  )
}

