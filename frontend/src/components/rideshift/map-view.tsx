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

import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Feature, FeatureCollection } from 'geojson'
import { Globe, Landmark, Map as MapIcon, Minus, Plus, Satellite, X } from 'lucide-react'
import type { AirQualityInfo, LezZoneDto } from '@/lib/types'
import { apiFetch } from '@/lib/api'

export type MapMarker = {
  id: string
  lat: number
  lng: number
  label: string
  kind: 'origin' | 'destination' | 'transport' | 'point'
}

export type MapViewProps = {
  zones: LezZoneDto[]
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
// Ward (phường/xã) administrative layer — /data/hanoi-wards.geojson (126 vùng)
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

let wardsCache: FeatureCollection | null = null

async function loadWards(): Promise<FeatureCollection | null> {
  if (wardsCache) return wardsCache
  try {
    const res = await fetch('/data/hanoi-wards.geojson')
    if (!res.ok) return null
    wardsCache = (await res.json()) as FeatureCollection
    return wardsCache
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
  const labelElsRef = useRef<Map<string, HTMLElement>>(new Map())
  const basemapLayersRef = useRef<Record<BasemapKey, L.TileLayer> | null>(null)
  const syncAdminRef = useRef<() => void>(() => {})

  const [basemap, setBasemap] = useState<BasemapKey>('street')
  const [adminOn, setAdminOn] = useState(true)
  const [zoomLevel, setZoomLevel] = useState(12)
  const [wardsState, setWardsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [panel, setPanel] = useState<WardPanel | null>(null)

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
    const map = L.map(containerRef.current, {
      center: HANOI_CENTER,
      zoom: 12,
      zoomControl: false, // custom zoom buttons in the bottom-right stack
      scrollWheelZoom: true,
    })
    zoomRef.current = 12

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
  useEffect(() => {
    let cancelled = false
    void loadWards().then((fc) => {
      const map = mapRef.current
      if (cancelled || !fc || !map) {
        if (!cancelled && !fc) setWardsState('error')
        return
      }

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
      syncAdminRef.current()
    })
    return () => {
      cancelled = true
    }
  }, [])

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
  }, [renderKey, zones, routeCoords, markers, drawPoints])

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
      aria-label="Bản đồ tương tác Hà Nội với các vùng LEZ, ranh giới phường/xã và tuyến đường"
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
          onClose={closePanel}
        />
      )}

      {/* ---- zoom/mode hint (bottom-left; above the controls on mobile) ---- */}
      <div className="pointer-events-none absolute bottom-[92px] left-3 z-[900] max-w-[70%] rounded-full border bg-card/95 px-3 py-1.5 text-[11px] font-medium shadow-sm backdrop-blur sm:bottom-3 sm:max-w-[75%]">
        {wardsState === 'loading' ? (
          '⏳ Đang tải ranh giới hành chính Hà Nội…'
        ) : wardsState === 'error' ? (
          '⚠️ Không tải được ranh giới hành chính'
        ) : adminMode ? (
          <>
            🏛️ <b>Chế độ hành chính</b>
            <span className="hidden sm:inline"> — rê chuột để nổi vùng · bấm để xem chỉ số</span> · Zoom {zoomLevel}
          </>
        ) : (
          <>
            🛣️ <b>Chế độ đường phố</b>
            <span className="hidden sm:inline"> — thu nhỏ để xem ranh giới hành chính</span> · Zoom {zoomLevel}
          </>
        )}
      </div>

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

function WardPanelCard({ panel, onClose }: { panel: WardPanel; onClose: () => void }) {
  const [aqi, setAqi] = useState<AirQualityInfo | null>(null)
  const [aqiState, setAqiState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [weather, setWeather] = useState<{ temp: number | null; rain: number | null } | null>(null)

  useEffect(() => {
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
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,precipitation&timezone=Asia%2FBangkok`
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
          AQI: Open-Meteo qua backend (cache 30 phút) · Thời tiết: Open-Meteo
        </p>
      </div>
    </aside>
  )
}
