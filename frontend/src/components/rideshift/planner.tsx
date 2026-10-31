'use client'

// Trip Planner (US-01..US-18) — UI v2 (Task 33, phương án B):
// - Form 3 bước có chỉ báo tiến độ: Điểm đi → Điểm đến → Ưu tiên
// - 4 thanh trượt thô → 4 nút chọn nhanh (Nhanh/Rẻ/Xanh/Cân bằng);
//   thanh trượt chi tiết chuyển vào "Cài đặt nâng cao" gập mặc định
// - Kết quả hiện ngay TRONG panel bên (xếp hạng tuyến + các mục chi tiết
//   gập/mở bằng accordion) — không phải cuộn xuống dưới mất bản đồ
// Giữ nguyên toàn bộ tính năng: chọn trên bản đồ (US-01), vị trí hiện tại
// (US-14), đảo chiều + tự phân tích lại (US-15), phương tiện + giờ đi (US-16),
// mục đích + ưu tiên (US-09), xếp hạng MCDM, tuân thủ LEZ, AQI, tác động.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { apiFetch } from '@/lib/api'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Layers,
  Loader2,
  MapPin,
  Minus,
  RotateCcw,
  Route as RouteIcon,
  Search,
  TriangleAlert,
} from 'lucide-react'
import FeedbackWidget from './feedback-widget'
import type { AirQualityStationDto, AnalyzeResponse, LezZoneDto, ModeInfo, TripPurpose } from '@/lib/types'
import { isStationAvailable } from '@/lib/types'
import { AQI_LEGEND, aqiCategory, formatAqiTime } from '@/lib/aqi-visual'
import type { CityDto } from '@/lib/types'
import { TRIP_PURPOSES, CRITERION_LABELS } from '@/lib/types'
import type { MapMarker } from '@/components/rideshift/map-view'
import {
  AirQualityCard,
  ComparisonTable,
  ComplianceCard,
  ImpactEstimator,
  RecommendationList,
  TripOverviewCard,
  MODE_ICONS,
} from './results'
import type { GeocodeResult } from '@/lib/external'

const MapView = dynamic(() => import('./map-view'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-muted/40">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
})

type LocationSel = { lat: number; lng: number; name: string }

// Vietnamese display lookups (keys stay canonical, US-01/transport points)
const PICK_LABEL: Record<'origin' | 'destination', string> = {
  origin: 'điểm đi',
  destination: 'điểm đến',
}

const LOCATION_TYPE_VI: Record<string, string> = {
  bus_stop: 'bến xe',
  metro: 'metro',
  brt: 'BRT',
  parking: 'bãi đỗ xe',
  ferry: 'phà',
}

// Preference presets (US-09): một chạm thay vì kéo 4 thanh trượt
type PrefKey = 'fastest' | 'cheapest' | 'eco' | 'comfort'
const PRESETS: {
  key: string
  icon: string
  label: string
  prefs: Record<PrefKey, number>
}[] = [
  { key: 'fastest', icon: '⚡', label: 'Nhanh nhất', prefs: { fastest: 90, cheapest: 30, eco: 20, comfort: 30 } },
  { key: 'cheapest', icon: '💰', label: 'Rẻ nhất', prefs: { fastest: 30, cheapest: 90, eco: 40, comfort: 20 } },
  { key: 'eco', icon: '🌿', label: 'Xanh nhất', prefs: { fastest: 20, cheapest: 40, eco: 90, comfort: 30 } },
  { key: 'balanced', icon: '⚖️', label: 'Cân bằng', prefs: { fastest: 50, cheapest: 50, eco: 50, comfort: 50 } },
]

function fmtLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// -------------------------------------------------------------- small pieces

function StepperNav({
  step,
  onGo,
  hasOrigin,
  hasDest,
}: {
  step: 1 | 2 | 3
  onGo: (n: 1 | 2 | 3) => void
  hasOrigin: boolean
  hasDest: boolean
}) {
  const steps = [
    { n: 1 as const, label: 'Điểm đi', done: hasOrigin },
    { n: 2 as const, label: 'Điểm đến', done: hasDest },
    { n: 3 as const, label: 'Ưu tiên', done: false },
  ]
  return (
    <nav className="flex items-center gap-1 pt-1" aria-label="Các bước lập kế hoạch">
      {steps.map((s, i) => (
        <Fragment key={s.n}>
          {i > 0 && <span className="h-px w-2.5 shrink-0 bg-border sm:w-3.5" aria-hidden />}
          <button
            type="button"
            onClick={() => onGo(s.n)}
            aria-current={step === s.n ? 'step' : undefined}
            className="flex shrink-0 items-center gap-1 rounded-full py-0.5 pr-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className={`flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-bold leading-none ${
                s.done
                  ? 'bg-emerald-600 text-white'
                  : step === s.n
                    ? 'border-2 border-emerald-600 bg-background text-emerald-700'
                    : 'border border-border bg-background text-muted-foreground'
              }`}
              aria-hidden
            >
              {s.done ? <Check className="h-2.5 w-2.5" /> : s.n}
            </span>
            <span
              className={`text-[11px] font-medium ${step === s.n ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {s.label}
            </span>
          </button>
        </Fragment>
      ))}
    </nav>
  )
}

function StepCard({
  n,
  title,
  summary,
  active,
  done,
  onOpen,
  children,
}: {
  n: 1 | 2 | 3
  title: string
  summary: string
  active: boolean
  done: boolean
  onOpen: () => void
  children: React.ReactNode
}) {
  return (
    // Task 74: KHÔNG dùng overflow-hidden ở đây — dropdown gợi ý địa chỉ
    // (absolute, xổ xuống dưới input) nằm trong section, overflow-hidden cắt
    // cụp phần list tràn xuống → "có kết quả nhưng list không xổ hết".
    // Góc bo giữ riêng: header bo trên bằng rounded-t-xl.
    <section className={`rounded-xl border ${active ? 'border-emerald-300 shadow-sm' : ''}`}>
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={active}
        className="flex w-full items-center gap-2.5 rounded-t-xl px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            done
              ? 'bg-emerald-600 text-white'
              : active
                ? 'border-2 border-emerald-600 text-emerald-700'
                : 'border border-border text-muted-foreground'
          }`}
          aria-hidden
        >
          {done ? <Check className="h-3.5 w-3.5" /> : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
          <span className="block truncate text-sm font-medium">{summary}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${active ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {active && <div className="border-t px-3 pb-3 pt-3">{children}</div>}
    </section>
  )
}

// -------------------------------------------------------------- main export

export default function TripPlanner({
  city,
  zones,
  onZonesChanged,
  focusZone,
}: {
  city: CityDto
  zones: LezZoneDto[]
  onZonesChanged?: () => void
  /** Task 79: ranh giới vùng LEZ cần fitBounds khi chưa có tuyến/điểm — truyền
   *  từ tab Chính sách (nút "Xem trên bản đồ"); khi user chọn điểm đi/đến thì
   *  fitPoints của user được ưu tiên */
  focusZone?: [number, number][] | null
}) {
  // ---------------- form state ----------------
  const [originText, setOriginText] = useState('')
  const [destText, setDestText] = useState('')
  const [origin, setOrigin] = useState<LocationSel | null>(null)
  const [destination, setDestination] = useState<LocationSel | null>(null)
  const [origSugs, setOrigSugs] = useState<GeocodeResult[]>([])
  const [destSugs, setDestSugs] = useState<GeocodeResult[]>([])
  const [showOrigSug, setShowOrigSug] = useState(false)
  const [showDestSug, setShowDestSug] = useState(false)
  const [geoLoading, setGeoLoading] = useState<'origin' | 'dest' | null>(null)

  const [modes, setModes] = useState<ModeInfo[]>([])
  const [vehicleId, setVehicleId] = useState('gasoline_motorbike')
  const [purpose, setPurpose] = useState<TripPurpose>('work')
  const [departure, setDeparture] = useState('')
  const [prefs, setPrefs] = useState({ fastest: 50, cheapest: 50, eco: 50, comfort: 50 })
  const [presetKey, setPresetKey] = useState<string | null>('balanced')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const [showTransportPoints, setShowTransportPoints] = useState(true)
  const [locations, setLocations] = useState<{ id: string; name: string; type: string; lat: number; lng: number }[]>([])
  // Task 63: trạm đo thật + lớp AQI mượt + thu gọn panel (yêu cầu 9)
  // Phản hồi user 21/10: AQI chỉ mở cho Hà Nội — Đà Nẵng/TP.HCM chỉ demo
  // tính scalability của DB/API, không có lớp AQI.
  const citySupportsAqi = city.id === 'hanoi'
  const [aqiStations, setAqiStations] = useState<AirQualityStationDto[]>([])
  const [showAqi, setShowAqi] = useState(true)
  // Task 67 — chú giải gập/mở (thiết kế lại footer theo phản hồi user); gập mặc định để form không bị chật
  const [legendOpen, setLegendOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeResponse | null>(null)
  const [decided, setDecided] = useState<string | null>(null)
  const [deciding, setDeciding] = useState(false)
  // US-01: which location field the next map click will fill
  const [pickTarget, setPickTarget] = useState<'origin' | 'destination' | null>(null)

  // UI v2: stepper + panel view
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [panelView, setPanelView] = useState<'form' | 'results'>('form')

  // map-first (phương án A): đệm fitBounds tránh panel nổi trái (desktop)
  // hoặc bottom-sheet dưới (mobile)
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setIsDesktop(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const fitPadding = useMemo<{ topLeft: [number, number]; bottomRight: [number, number] }>(
    () =>
      isDesktop
        ? { topLeft: [448, 40], bottomRight: [40, 40] }
        : { topLeft: [24, 24], bottomRight: [24, Math.round((typeof window !== 'undefined' ? window.innerHeight : 640) * 0.6)] },
    [isDesktop]
  )

  const origTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const destTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Task 73: truy vấn mới nhất theo ô — retry geocode chỉ áp kết quả khi
  // người dùng vẫn đang ở đúng truy vấn đó (không ghi đè kết quả mới hơn)
  const latestQuery = useRef<{ origin: string; dest: string }>({ origin: '', dest: '' })

  // ---------------- data loading ----------------
  useEffect(() => {
    // US-16: default departure time is the current time
    setDeparture(fmtLocalDateTime(new Date()))
    apiFetch('/api/modes')
      .then((r) => r.json())
      .then((d) => {
        const enabled = (d.modes ?? []).filter((m: ModeInfo) => m.enabled)
        setModes(enabled)
        if (enabled.length > 0) setVehicleId(enabled[0].id)
      })
      .catch(() => setError('Không tải được loại phương tiện. Vui lòng tải lại trang.'))
    apiFetch(`/api/locations?city=${encodeURIComponent(city.id)}`)
      .then((r) => r.json())
      .then((d) => setLocations(d.locations ?? []))
      .catch(() => null)
    if (citySupportsAqi) {
      apiFetch(`/api/airquality/stations?city=${encodeURIComponent(city.id)}`)
        .then((r) => r.json())
        .then((d) => setAqiStations(d.stations ?? []))
        .catch(() => null)
    } else {
      setAqiStations([])
    }
  }, [city.id, citySupportsAqi])

  // ---------------- geocode debounce ----------------
  // Task 73: useCallback phải phụ thuộc city.id — trước đây deps [] tạo stale
  // closure: sau khi đổi thành phố, request geocode vẫn gửi city cũ → sai
  // viewbox/lọc vùng
  const fetchSuggestions = useCallback(
    async (q: string, target: 'origin' | 'dest', isRetry = false) => {
      if (q.trim().length < 2) {
        if (target === 'origin') setOrigSugs([])
        else setDestSugs([])
        return
      }
      setGeoLoading(target)
      try {
        const res = await apiFetch(`/api/geocode?q=${encodeURIComponent(q)}&city=${encodeURIComponent(city.id)}`)
        const data = await res.json()
        const sugs: GeocodeResult[] = data.results ?? []
        // retry: chỉ áp kết quả nếu người dùng vẫn đang ở đúng truy vấn này
        const stale = latestQuery.current[target] !== q
        if (!stale) {
          if (target === 'origin') {
            setOrigSugs(sugs)
            setShowOrigSug(true)
          } else {
            setDestSugs(sugs)
            setShowDestSug(true)
          }
        }
        // Task 73: 0 kết quả → tự thử lại 1 lần sau 700ms. Backend KHÔNG cache
        // kết quả rỗng do lỗi mạng (timeout Nominatim tạm thời) nên retry hồi
        // phục được; với 0 kết quả THẬT backend đã cache → retry hầu như miễn phí
        if (!isRetry && sugs.length === 0 && !stale) {
          setTimeout(() => void fetchSuggestions(q, target, true), 700)
        }
      } catch {
        if (!isRetry) setTimeout(() => void fetchSuggestions(q, target, true), 700)
        else if (target === 'origin') setOrigSugs([])
        else setDestSugs([])
      } finally {
        setGeoLoading(null)
      }
    },
    [city.id],
  )

  const onOriginChange = (v: string) => {
    setOriginText(v)
    setOrigin(null)
    latestQuery.current.origin = v
    if (origTimer.current) clearTimeout(origTimer.current)
    origTimer.current = setTimeout(() => fetchSuggestions(v, 'origin'), 350)
  }
  const onDestChange = (v: string) => {
    setDestText(v)
    setDestination(null)
    latestQuery.current.dest = v
    if (destTimer.current) clearTimeout(destTimer.current)
    destTimer.current = setTimeout(() => fetchSuggestions(v, 'dest'), 350)
  }

  const pick = (sel: LocationSel, target: 'origin' | 'dest') => {
    if (target === 'origin') {
      setOrigin(sel)
      setOriginText(sel.name)
      setShowOrigSug(false)
      setStep(destination ? 3 : 2)
    } else {
      setDestination(sel)
      setDestText(sel.name)
      setShowDestSug(false)
      setStep(origin ? 3 : 1)
    }
  }

  // ---------------- pick on map (US-01) ----------------
  const togglePickTarget = (t: 'origin' | 'destination') => {
    if (analyzing) return
    setPickTarget((cur) => (cur === t ? null : t))
  }

  const handleMapPick = (lat: number, lng: number) => {
    if (!pickTarget || analyzing) return
    const sel: LocationSel = {
      lat: Number(lat.toFixed(4)),
      lng: Number(lng.toFixed(4)),
      name: `Điểm đã chọn (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
    }
    const target = pickTarget
    pick(sel, target === 'origin' ? 'origin' : 'dest')
    // clear the validation error that belongs to the field just filled
    setFieldError((prev) =>
      prev && prev.toLowerCase().includes(target === 'origin' ? 'điểm đi' : 'điểm đến') ? null : prev
    )
    setPickTarget(null)
  }

  // Esc cancels map picking
  useEffect(() => {
    if (!pickTarget) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickTarget(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickTarget])

  // ---------------- current location (US-14) ----------------
  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Trình duyệt của bạn không hỗ trợ định vị. Vui lòng nhập điểm đi thủ công.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const sel: LocationSel = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          name: 'Vị trí hiện tại của tôi',
        }
        pick(sel, 'origin')
        setError(null)
      },
      () => {
        setError(
          'Quyền truy cập vị trí bị từ chối hoặc không khả dụng. Bạn vẫn có thể nhập điểm đi thủ công.'
        )
      },
      { enableHighAccuracy: false, timeout: 8000 }
    )
  }

  // ---------------- swap (US-15) ----------------
  const swap = () => {
    const oT = originText
    const o = origin
    const d = destination
    setOriginText(destText)
    setOrigin(d)
    setDestText(oT)
    setDestination(o)
    setStep(() => (!d ? 1 : !o ? 2 : 3))
    // a displayed result belongs to the old direction — re-run for the swapped trip
    if (result && o && d && !analyzing) void analyze(d, o)
  }

  // ---------------- reset / presets ----------------
  const resetPlan = () => {
    setOriginText('')
    setDestText('')
    setOrigin(null)
    setDestination(null)
    setResult(null)
    setDecided(null)
    setFieldError(null)
    setError(null)
    setStep(1)
    setPanelView('form')
    setPickTarget(null)
  }

  const applyPreset = (key: string) => {
    const p = PRESETS.find((x) => x.key === key)
    if (!p) return
    setPrefs(p.prefs)
    setPresetKey(key)
  }

  // ---------------- analyze ----------------
  const analyze = async (originOverride?: LocationSel | null, destOverride?: LocationSel | null) => {
    if (analyzing) return
    const originSel = originOverride ?? origin
    const destSel = destOverride ?? destination
    setFieldError(null)
    setError(null)
    setPickTarget(null)
    if (!originSel) {
      setFieldError('Vui lòng chọn điểm đi từ gợi ý tìm kiếm (hoặc dùng vị trí hiện tại của bạn).')
      setStep(1)
      setPanelView('form')
      return
    }
    if (!destSel) {
      setFieldError('Vui lòng chọn điểm đến từ gợi ý tìm kiếm.')
      setStep(2)
      setPanelView('form')
      return
    }
    setAnalyzing(true)
    setResult(null)
    setDecided(null)
    try {
      const res = await apiFetch('/api/trip/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: originSel,
          destination: destSel,
          vehicleId,
          purpose,
          city: city.id,
          departureTime: departure ? new Date(departure).toISOString() : undefined,
          preferences: prefs,
          saveTrip: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Phân tích tuyến đường thất bại. Vui lòng thử lại.')
        setPanelView('form')
        return
      }
      setResult(data as AnalyzeResponse)
      setPanelView('results')
    } catch {
      setError('Lỗi kết nối tới dịch vụ phân tích. Vui lòng thử lại.')
      setPanelView('form')
    } finally {
      setAnalyzing(false)
    }
  }

  const recordChoice = async (modeId: string) => {
    if (!result?.tripId) return
    setDeciding(true)
    try {
      const res = await apiFetch(`/api/trips/${result.tripId}/choice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chosenModeId: modeId }),
      })
      if (res.ok) setDecided(modeId)
      else setError('Không ghi nhận được lựa chọn của bạn. Vui lòng thử lại.')
    } catch {
      setError('Không ghi nhận được lựa chọn của bạn. Vui lòng thử lại.')
    } finally {
      setDeciding(false)
    }
  }

  // ---------------- map data ----------------
  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = []
    if (origin) list.push({ id: 'o', lat: origin.lat, lng: origin.lng, label: origin.name, kind: 'origin' })
    if (destination)
      list.push({ id: 'd', lat: destination.lat, lng: destination.lng, label: destination.name, kind: 'destination' })
    if (showTransportPoints)
      for (const l of locations)
        list.push({ id: l.id, lat: l.lat, lng: l.lng, label: `${l.name} (${LOCATION_TYPE_VI[l.type] ?? l.type})`, kind: 'transport' })
    return list
  }, [origin, destination, locations, showTransportPoints])

  const fitPoints = useMemo<[number, number][]>(() => {
    if (result) return result.route.coords.length > 400 ? [result.route.coords[0], result.route.coords[result.route.coords.length - 1]] : [origin, destination].filter(Boolean).map((p) => [p!.lat, p!.lng] as [number, number])
    const pts: [number, number][] = []
    if (origin) pts.push([origin.lat, origin.lng])
    if (destination) pts.push([destination.lat, destination.lng])
    return pts
  }, [result, origin, destination])

  const selectedModeName = modes.find((m) => m.id === vehicleId)?.name ?? vehicleId
  const departureLabel = departure
    ? new Date(departure).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
    : 'bây giờ'
  const activePreset = PRESETS.find((p) => p.key === presetKey)

  // ---------------- shared skeletons ----------------
  const analyzingBlock = (
    <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang phân tích tuyến đường…
      </p>
      <Skeleton className="h-14 rounded-lg" />
      <Skeleton className="h-14 rounded-lg" />
      <Skeleton className="h-14 rounded-lg" />
    </div>
  )

  return (
    <div className="absolute inset-0">
      {/* ================= MAP full-bleed (phương án A) ================= */}
      <div className="absolute inset-0">
        {pickTarget && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-[1100] flex justify-center px-3">
            <div
              role="status"
              className="pointer-events-auto rounded-full border border-amber-300 bg-amber-50/95 px-3 py-1 text-center text-xs font-medium text-amber-900 shadow-sm backdrop-blur"
            >
              Bấm vào bản đồ để đặt {PICK_LABEL[pickTarget]}. Nhấn Esc hoặc bấm lại nút để hủy.
            </div>
          </div>
        )}
        <MapView
          zones={zones.filter((z) => z.active)}
          city={city}
          aqiStations={aqiStations}
          showAqi={showAqi && citySupportsAqi}
          routeCoords={result?.route.coords ?? null}
          markers={markers}
          fitBoundsTo={fitPoints.length > 0 ? fitPoints : (focusZone ?? [])}
          fitPadding={fitPadding}
          pickMode={pickTarget !== null}
          onMapClick={pickTarget ? handleMapPick : undefined}
          className="h-full w-full"
        />
      </div>

      {/* nút mở lại khi panel đã thu gọn (yêu cầu 9 — thấy toàn bộ map) */}
      {collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="absolute bottom-3 left-3 z-[1000] inline-flex items-center gap-2 rounded-full border bg-card/95 px-4 py-2.5 text-sm font-semibold shadow-lg backdrop-blur transition-colors hover:bg-accent"
          aria-label="Mở lại bảng lập kế hoạch"
        >
          <RouteIcon className="h-4 w-4 text-emerald-600" /> Lập kế hoạch chuyến đi
          {result && <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] text-white">có kết quả</span>}
        </button>
      )}

      {/* ================= FLOATING PANEL: form / results ================= */}
      <div
        className={`pointer-events-none absolute inset-x-2 bottom-2 z-[1000] flex max-h-[64dvh] flex-col lg:inset-y-3 lg:left-3 lg:right-auto lg:w-[404px] lg:max-h-none ${
          collapsed ? 'hidden' : ''
        }`}
      >
        <Card className="pointer-events-auto flex max-h-full min-h-0 flex-col overflow-hidden rounded-2xl border bg-card/95 shadow-xl backdrop-blur">
        {panelView === 'form' ? (
          <>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <RouteIcon className="h-4 w-4" /> Lập kế hoạch chuyến đi
                  </CardTitle>
                  <CardDescription className="truncate">
                    {city.name} · tìm tuyến &amp; so sánh theo quy định LEZ
                  </CardDescription>
                </div>
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  title="Thu gọn — xem toàn bộ bản đồ"
                  aria-label="Thu gọn bảng lập kế hoạch"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <StepperNav step={step} onGo={setStep} hasOrigin={!!origin} hasDest={!!destination} />
            </CardHeader>
            <CardContent className="min-h-0 space-y-2.5 overflow-y-auto p-4 pt-0">
              {/* ---- bước 1: điểm đi ---- */}
              <StepCard
                n={1}
                title="Điểm đi"
                summary={origin?.name ?? 'Chưa chọn điểm đi'}
                active={step === 1}
                done={!!origin}
                onOpen={() => setStep(1)}
              >
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="origin"
                      placeholder={city.id === 'hanoi' ? 'vd. Hồ Hoàn Kiếm' : `vd. địa danh tại ${city.name}`}
                      value={originText}
                      onChange={(e) => onOriginChange(e.target.value)}
                      onFocus={() => setShowOrigSug(true)}
                      onBlur={() => setTimeout(() => setShowOrigSug(false), 180)}
                      autoComplete="off"
                    />
                    {geoLoading === 'origin' && (
                      <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {showOrigSug && origSugs.length > 0 && (
                      <ul
                        className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover shadow-md"
                        // Task 73: preventDefault giữ focus trong Input — bấm vào
                        // item/cuộn scrollbar không kích blur → list không tự gập
                        // trước khi người dùng kịp xem/xổ hết các kết quả
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        {origSugs.map((s, i) => (
                          <li key={`${s.lat}-${s.lng}-${i}`}>
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                              onMouseDown={() => pick(s, 'origin')}
                            >
                              <MapPin className="mr-1.5 inline h-3.5 w-3.5 text-emerald-600" />
                              {s.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {originText.trim().length >= 3 && geoLoading !== 'origin' && !origin && origSugs.length === 0 && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Không tìm thấy trong {city.name} — khu vực hỗ trợ chỉ giới hạn tại thành phố bạn chọn.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant={pickTarget === 'origin' ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 flex-1 text-xs"
                      aria-pressed={pickTarget === 'origin'}
                      disabled={analyzing}
                      onClick={() => togglePickTarget('origin')}
                    >
                      <MapPin className="mr-1 h-3.5 w-3.5" /> Chọn trên bản đồ
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 flex-1 text-xs text-emerald-700"
                      onClick={useCurrentLocation}
                    >
                      <Crosshair className="mr-1 h-3.5 w-3.5" /> Vị trí của tôi
                    </Button>
                  </div>
                </div>
              </StepCard>

              {/* ---- đảo chiều ---- */}
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-full px-3 text-xs"
                  onClick={swap}
                  title="Đảo chiều điểm đi và điểm đến"
                >
                  <ArrowUpDown className="mr-1 h-3.5 w-3.5" /> Đảo chiều
                </Button>
              </div>

              {/* ---- bước 2: điểm đến ---- */}
              <StepCard
                n={2}
                title="Điểm đến"
                summary={destination?.name ?? 'Chưa chọn điểm đến'}
                active={step === 2}
                done={!!destination}
                onOpen={() => setStep(2)}
              >
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="destination"
                      placeholder={city.id === 'hanoi' ? 'vd. Mỹ Đình' : 'vd. địa điểm đến'}
                      value={destText}
                      onChange={(e) => onDestChange(e.target.value)}
                      onFocus={() => setShowDestSug(true)}
                      onBlur={() => setTimeout(() => setShowDestSug(false), 180)}
                      autoComplete="off"
                    />
                    {geoLoading === 'dest' && (
                      <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {showDestSug && destSugs.length > 0 && (
                      <ul
                        className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover shadow-md"
                        // Task 73: giữ focus như điểm đi — list không tự gập khi
                        // bấm item hoặc kéo scrollbar xem hết kết quả
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        {destSugs.map((s, i) => (
                          <li key={`${s.lat}-${s.lng}-${i}`}>
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                              onMouseDown={() => pick(s, 'dest')}
                            >
                              <MapPin className="mr-1.5 inline h-3.5 w-3.5 text-orange-500" />
                              {s.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {destText.trim().length >= 3 && geoLoading !== 'dest' && !destination && destSugs.length === 0 && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Không tìm thấy trong {city.name} — khu vực hỗ trợ chỉ giới hạn tại thành phố bạn chọn.
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant={pickTarget === 'destination' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 w-full text-xs"
                    aria-pressed={pickTarget === 'destination'}
                    disabled={analyzing}
                    onClick={() => togglePickTarget('destination')}
                  >
                    <MapPin className="mr-1 h-3.5 w-3.5" /> Chọn trên bản đồ
                  </Button>
                </div>
              </StepCard>

              {/* ---- bước 3: ưu tiên ---- */}
              <StepCard
                n={3}
                title="Ưu tiên"
                summary={
                  activePreset
                    ? `${activePreset.icon} ${activePreset.label} · ${selectedModeName}`
                    : `Tuỳ chỉnh · ${selectedModeName}`
                }
                active={step === 3}
                done={false}
                onOpen={() => setStep(3)}
              >
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Mức độ ưu tiên">
                    {PRESETS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        aria-pressed={presetKey === p.key}
                        onClick={() => applyPreset(p.key)}
                        className={`flex flex-col items-center gap-0.5 rounded-xl border-2 px-2 py-2.5 text-xs font-semibold transition-all ${
                          presetKey === p.key
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-900 shadow-[0_0_0_3px_rgba(16,185,129,0.12)] dark:bg-emerald-950/40 dark:text-emerald-100'
                            : 'border-border bg-card text-muted-foreground hover:border-emerald-300 hover:text-foreground'
                        }`}
                      >
                        <span className="text-lg leading-none" aria-hidden>{p.icon}</span>
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full justify-between text-xs">
                        ⚙️ Cài đặt nâng cao
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                        />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-3 pt-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label>Loại phương tiện</Label>
                          <Select value={vehicleId} onValueChange={setVehicleId}>
                            <SelectTrigger aria-label="Loại phương tiện">
                              <SelectValue placeholder="Chọn phương tiện" />
                            </SelectTrigger>
                            {/* z-[1200]: nổi trên panel nổi z-[1000] — nếu không dropdown sẽ bị panel che */}
                            <SelectContent className="z-[1200]">
                              {modes.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {MODE_ICONS[m.id] ?? '•'} {m.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="departure">Giờ xuất phát</Label>
                          <Input
                            id="departure"
                            type="datetime-local"
                            value={departure}
                            onChange={(e) => setDeparture(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Mục đích chuyến đi</Label>
                        <Select value={purpose} onValueChange={(v) => setPurpose(v as TripPurpose)}>
                          <SelectTrigger aria-label="Mục đích chuyến đi">
                            <SelectValue />
                          </SelectTrigger>
                          {/* z-[1200]: nổi trên panel nổi z-[1000] */}
                          <SelectContent className="z-[1200]">
                            {TRIP_PURPOSES.map((p) => (
                              <SelectItem key={p.value} value={p.value}>
                                {p.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
                        <div className="text-sm font-medium">Trọng số chi tiết (MCDM)</div>
                        {(
                          [
                            ['fastest', '⏱ Nhanh nhất'],
                            ['cheapest', '💰 Rẻ nhất'],
                            ['eco', '🌿 Thân thiện môi trường'],
                            ['comfort', '🛋 Tiện nghi'],
                          ] as const
                        ).map(([key, label]) => (
                          <div key={key} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span>{label}</span>
                              <span className="tabular-nums text-muted-foreground">{prefs[key]}</span>
                            </div>
                            <Slider
                              value={[prefs[key]]}
                              min={0}
                              max={100}
                              step={5}
                              aria-label={label}
                              onValueChange={([v]) => {
                                setPrefs((p) => ({ ...p, [key]: v }))
                                setPresetKey(null)
                              }}
                            />
                          </div>
                        ))}
                        <p className="text-[11px] text-muted-foreground">
                          Kéo thanh trượt sẽ bỏ chọn mức ưu tiên nhanh ở trên.
                        </p>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </StepCard>

              {/* ---- lỗi + CTA ---- */}
              {fieldError && (
                <Alert className="border-amber-300 bg-amber-50 text-amber-900 py-2">
                  <TriangleAlert className="h-4 w-4" />
                  <AlertDescription className="text-sm">{fieldError}</AlertDescription>
                </Alert>
              )}
              {error && (
                <Alert variant="destructive" className="py-2">
                  <TriangleAlert className="h-4 w-4" />
                  <AlertDescription className="text-sm">{error}</AlertDescription>
                </Alert>
              )}

              <Button className="w-full" onClick={() => analyze()} disabled={analyzing}>
                {analyzing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Đang phân tích…
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" /> Tìm tuyến đi
                  </>
                )}
              </Button>

              {analyzing && analyzingBlock}
            </CardContent>
          </>
        ) : (
          <>
            {/* ================= RESULTS VIEW ================= */}
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span aria-hidden>🏆</span> Kết quả phân tích
                </CardTitle>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setPanelView('form')}
                  >
                    ← Sửa thông tin
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Lập kế hoạch mới"
                    aria-label="Lập kế hoạch mới"
                    onClick={resetPlan}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Thu gọn — xem toàn bộ bản đồ"
                    aria-label="Thu gọn bảng kết quả"
                    onClick={() => setCollapsed(true)}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <CardDescription className="truncate">
                📍 {origin?.name ?? '—'} → 🏁 {destination?.name ?? '—'}
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 space-y-3 overflow-y-auto p-4 pt-0">
              {analyzing && analyzingBlock}
              {result && (
                <>
                  {result.airQuality?.aqi != null && (
                    <div className="rounded-xl border bg-muted/30 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">🌤 Chất lượng không khí</span>
                        <span className="font-semibold">
                          AQI {result.airQuality.aqi}
                          {result.airQuality.category ? ` · ${result.airQuality.category}` : ''}
                        </span>
                      </div>
                      {result.airQuality.locationLabel && (
                        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                          Nguồn: {result.airQuality.locationLabel}
                          {result.airQuality.source === 'interpolated' ? ' (nội suy)' : ''}
                        </p>
                      )}
                    </div>
                  )}

                  <RecommendationList
                    result={result}
                    onDecide={recordChoice}
                    decided={decided}
                    deciding={deciding}
                  />

                  {/* Task 3-c: phản hồi nhanh về phương tiện được đề xuất (chỉ khi có kết quả phân tích) */}
                  {(result.tripId || result.recommendations.length > 0) && (
                    <div className="mt-3 border-t pt-3">
                      <FeedbackWidget
                        tripId={result.tripId}
                        topModeId={result.recommendations[0]?.modeId}
                        topModeName={result.recommendations[0]?.modeName}
                      />
                    </div>
                  )}

                  <Accordion type="multiple" defaultValue={['trip-ov']}>
                    <AccordionItem value="trip-ov">
                      <AccordionTrigger className="py-3 text-sm">
                        <span className="flex flex-col items-start gap-0.5 text-left">
                          <span>📋 Tổng quan hành trình</span>
                          <span className="text-[11px] font-normal text-muted-foreground">
                            Quãng đường, thời gian di chuyển và tình trạng của tuyến so với các vùng LEZ đi qua
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-3">
                        <TripOverviewCard result={result} />
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="lez">
                      <AccordionTrigger className="py-3 text-sm">
                        <span className="flex flex-col items-start gap-0.5 text-left">
                          <span>🛡 Tuân thủ LEZ</span>
                          <span className="text-[11px] font-normal text-muted-foreground">
                            Phương tiện bạn chọn có bị hạn chế trong vùng phát thải thấp không — kèm quy định, khung giờ và ngày áp dụng
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-3">
                        <ComplianceCard
                          compliance={result.compliance[result.vehicleId]}
                          vehicleName={selectedModeName}
                          departureInfo={departureLabel}
                        />
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="air">
                      <AccordionTrigger className="py-3 text-sm">
                        <span className="flex flex-col items-start gap-0.5 text-left">
                          <span>🌤 Chất lượng không khí</span>
                          <span className="text-[11px] font-normal text-muted-foreground">
                            Chỉ số AQI dọc tuyến, thành phần ô nhiễm và khuyến nghị khi không khí kém
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-3">
                        <AirQualityCard air={result.airQuality} />
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="weights">
                      <AccordionTrigger className="py-3 text-sm">
                        <span className="flex flex-col items-start gap-0.5 text-left">
                          <span>🎛 Trọng số đã áp dụng</span>
                          <span className="text-[11px] font-normal text-muted-foreground">
                            Tỷ trọng từng tiêu chí chấm điểm — do quản trị viên đặt và điều chỉnh theo mức ưu tiên bạn chọn
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-3">
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm">
                              Trọng số cơ bản do quản trị viên thiết lập, điều chỉnh theo ưu tiên của bạn (US-20)
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-1.5">
                            {Object.entries(result.weightsUsed).map(([k, v]) => {
                              const total = Object.values(result.weightsUsed).reduce((s, x) => s + x, 0)
                              return (
                                <div key={k} className="flex items-center gap-2 text-xs">
                                  <span className="w-36 shrink-0 capitalize text-muted-foreground">
                                    {CRITERION_LABELS[k as keyof typeof CRITERION_LABELS] ?? k}
                                  </span>
                                  <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-emerald-500"
                                      style={{ width: `${Math.round((v / total) * 100)}%` }}
                                    />
                                  </div>
                                  <span className="w-10 text-right tabular-nums">
                                    {Math.round((v / total) * 100)}%
                                  </span>
                                </div>
                              )
                            })}
                          </CardContent>
                        </Card>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="compare">
                      <AccordionTrigger className="py-3 text-sm">
                        <span className="flex flex-col items-start gap-0.5 text-left">
                          <span>⚖ So sánh phương án</span>
                          <span className="text-[11px] font-normal text-muted-foreground">
                            Đối chiếu trực tiếp các phương án hàng đầu: thời gian, chi phí, phát thải, tuân thủ LEZ và điểm tổng
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="overflow-x-auto pb-3">
                        <ComparisonTable result={result} />
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="impact">
                      <AccordionTrigger className="py-3 text-sm">
                        <span className="flex flex-col items-start gap-0.5 text-left">
                          <span>🌱 Ước tính tác động</span>
                          <span className="text-[11px] font-normal text-muted-foreground">
                            Nếu chuyển sang phương án được đề xuất — bạn thay đổi bao nhiêu về thời gian, chi phí và lượng CO₂
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-3">
                        <ImpactEstimator result={result} />
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>

                  {error && (
                    <Alert variant="destructive" className="py-2">
                      <TriangleAlert className="h-4 w-4" />
                      <AlertDescription className="text-sm">{error}</AlertDescription>
                    </Alert>
                  )}
                </>
              )}
            </CardContent>
          </>
        )}
        </Card>

        {/* ---- footer: Chú giải & lớp bản đồ (thiết kế lại Task 67 — hàng điều khiển mỏng + chi tiết gập/mở, minh bạch nguồn trạm) ---- */}
        {/* pointer-events-auto: wrapper ngoài đang none (map-first), footer là sibling của Card nên phải tự bật lại */}
        <div className="pointer-events-auto shrink-0 border-t bg-card/95 px-3 py-1.5 text-[11px] text-muted-foreground">
          <Collapsible open={legendOpen} onOpenChange={setLegendOpen}>
            {/* hàng điều khiển: mở/gập chú giải + 2 công tắc lớp (luôn bấm được kể cả khi gập) */}
            <div className="flex items-center justify-between gap-2">
              <CollapsibleTrigger className="flex min-w-0 items-center gap-1.5 rounded-md py-0.5 text-left transition-colors hover:text-foreground">
                <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
                  Chú giải &amp; lớp bản đồ
                </span>
                {legendOpen ? (
                  <ChevronUp className="h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
                )}
              </CollapsibleTrigger>
              <span className="flex shrink-0 items-center gap-2.5">
                {citySupportsAqi && (
                  <span
                    className="inline-flex items-center gap-1"
                    title={`Trường AQI nội suy từ ${aqiStations.filter(isStationAvailable).length} trạm còn số liệu${aqiStations.some((s) => !isStationAvailable(s)) ? ` (ngoài ra ${aqiStations.length - aqiStations.filter(isStationAvailable).length} trạm tạm ngừng không đóng góp)` : ''}`}
                  >
                    <span
                      aria-hidden
                      className="h-2.5 w-4 rounded-full border border-black/10"
                      style={{ background: 'linear-gradient(90deg,#22c55e,#facc15,#f97316,#ef4444,#a855f7)' }}
                    />
                    <Switch
                      id="aqi-toggle"
                      checked={showAqi}
                      onCheckedChange={setShowAqi}
                      aria-label="Bật tắt trường AQI trên bản đồ"
                    />
                  </span>
                )}
                <span className="inline-flex items-center gap-1" title="Bật tắt điểm giao thông">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-teal-600" />
                  <Switch
                    id="transport-toggle"
                    checked={showTransportPoints}
                    onCheckedChange={setShowTransportPoints}
                    aria-label="Bật tắt điểm giao thông trên bản đồ"
                  />
                </span>
              </span>
            </div>
            <CollapsibleContent>
              <div className="space-y-3 pb-1.5 pt-2.5">
                {/* --- thang màu VN-AQI liên tục (đồng bộ với trường AQI mượt trên map) + nguồn từng trạm --- */}
                {citySupportsAqi && (
                  <div>
                    <p className="mb-1.5 font-medium text-foreground/70">Chất lượng không khí · VN-AQI</p>
                    <div
                      aria-hidden
                      className="h-2.5 w-full rounded-full border border-black/10"
                      style={{
                        background:
                          'linear-gradient(90deg,#22c55e 0%,#facc15 20%,#f97316 40%,#ef4444 60%,#a855f7 80%,#7f1d1d 100%)',
                      }}
                    />
                    <div className="mt-1 flex justify-between text-[9px] leading-none tabular-nums" aria-hidden>
                      <span>0</span>
                      <span>50</span>
                      <span>100</span>
                      <span>150</span>
                      <span>200</span>
                      <span>300</span>
                      <span>300+</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-6 gap-0.5" aria-hidden>
                      {AQI_LEGEND.map((b) => (
                        <span key={b.label} className="flex items-center justify-center gap-1 text-[9px] leading-tight">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: b.color }} />
                          {b.label}
                        </span>
                      ))}
                    </div>
                    {/* minh bạch nguồn: từng trạm đo thật — tên, nguồn, giá trị (bấm trạm trên bản đồ để xem chi tiết) */}
                    {aqiStations.length > 0 && (
                      <ul
                        className="mt-2.5 max-h-60 space-y-1 overflow-y-auto border-t border-border/60 pr-1 pt-2 rs-scroll"
                        aria-label="Trạm đo thật và nguồn dữ liệu"
                      >
                        {aqiStations.length > 8 && (
                          <li className="text-[10px] leading-snug text-muted-foreground">
                            {aqiStations.filter(isStationAvailable).length} trạm còn số liệu ·{' '}
                            {aqiStations.length - aqiStations.filter(isStationAvailable).length} trạm tạm ngừng (danh sách cuộn)
                          </li>
                        )}
                        {aqiStations.map((st) => {
                          const ok = isStationAvailable(st)
                          return (
                            <li
                              key={st.id}
                              className={`flex items-center gap-1.5 ${ok ? '' : 'opacity-60'}`}
                              title={`${st.name} — ${st.sourceLabel} · ${ok ? `đo lúc ${formatAqiTime(st.measuredAt)}` : 'tạm ngừng cập nhật số liệu'}`}
                            >
                              <span
                                aria-hidden
                                className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                                style={{ background: ok ? aqiCategory(st.aqi as number).color : '#94a3b8' }}
                              />
                              <span className="min-w-0 flex-1 truncate">{st.name}</span>
                              <span className="shrink-0 rounded border border-border bg-background px-1 py-px text-[9px] leading-tight">
                                {st.source === 'moitruongthudo' ? 'Sở NN&MT' : 'WAQI'}
                              </span>
                              <span
                                className={`w-7 shrink-0 text-right text-[11px] font-semibold tabular-nums ${ok ? 'text-foreground/80' : 'text-muted-foreground/70'}`}
                                aria-label={ok ? `AQI ${st.aqi}` : 'AQI không khả dụng'}
                              >
                                {ok ? st.aqi : '—'}
                              </span>
                            </li>
                          )
                        })}
                        {aqiStations.some((s) => !isStationAvailable(s)) && (
                          <li className="pt-0.5 text-[10px] leading-snug text-muted-foreground">
                            — Trạm xám: tạm ngừng cập nhật số liệu (không đóng góp vào lớp AQI)
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                )}

                {/* --- ý nghĩa màu của từng phần tử trên map --- */}
                <div>
                  <p className="mb-1.5 font-medium text-foreground/70">Phần tử trên bản đồ</p>
                  <div className="space-y-1.5">
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden className="h-2.5 w-4 shrink-0 rounded-sm border border-red-500 bg-red-400/60" />
                      Vùng LEZ — hạn chế xe cá nhân phát thải cao
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden className="h-1 w-4 shrink-0 rounded-full bg-emerald-600" />
                      Tuyến buýt / metro
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-teal-600" />
                      Điểm giao thông — bến xe, metro, BRT, bãi đỗ xe
                    </span>
                    {citySupportsAqi && (
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="h-3 w-4 shrink-0 rounded-full border border-black/10"
                          style={{ background: 'linear-gradient(90deg,#22c55e,#facc15,#f97316,#ef4444,#a855f7)' }}
                        />
                        Trường AQI — màu theo chất lượng không khí khu vực
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </div>
  )
}
