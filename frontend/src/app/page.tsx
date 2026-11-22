'use client'

// RideShift – Smart Transport Transition Advisor (C1SE.48)
// Single-page application: Trip Planner (guest users) + Admin Dashboard.
// Task 63: cổng chọn thành phố (multi-city gate) — khoá tương tác theo
// thành phố, đổi thành phố qua nút ở header.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import { Landmark, Leaf, Loader2, MapPin, MapPinned, ShieldCheck } from 'lucide-react'
import { Toaster as SonnerToaster } from 'sonner'
import { apiFetch } from '@/lib/api'
import type { CityDto, LezZoneDto } from '@/lib/types'
import { FALLBACK_CITIES } from '@/lib/city-fallback'
import { useCityStore } from '@/lib/city-store'
import CityGate from '@/components/rideshift/city-gate'

const TripPlanner = dynamic(() => import('@/components/rideshift/planner'), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Đang tải bộ lập kế hoạch…
    </div>
  ),
})

const AdminDashboard = dynamic(
  () => import('@/components/rideshift/admin-dashboard'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Đang tải bảng điều khiển…
      </div>
    ),
  }
)



const PolicyBulletinView = dynamic(
  () => import('@/components/rideshift/policy-bulletin'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Đang tải bảng tin…
      </div>
    ),
  }
)

type TabKey = 'planner' | 'policy' | 'admin'

/** zone thuộc thành phố đang chọn (null = legacy Hà Nội) */
function zoneInCity(z: LezZoneDto, cityId: string): boolean {
  const zc = (z as LezZoneDto & { cityId?: string | null }).cityId ?? null
  return zc === cityId || (zc === null && cityId === 'hanoi')
}

export default function Home() {
  const [tab, setTab] = useState<TabKey>('planner')
  /** Task 79: ranh giới vùng LEZ cần bay tới trên bản đồ (từ tab Chính sách) */
  const [mapFocus, setMapFocus] = useState<[number, number][] | null>(null)
  const [zones, setZones] = useState<LezZoneDto[]>([])
  const [zonesVersion, setZonesVersion] = useState(0)

  // ---- multi-city (Task 63) ----
  const cityId = useCityStore((s) => s.cityId)
  const gateOpen = useCityStore((s) => s.gateOpen)
  const selectCity = useCityStore((s) => s.selectCity)
  const openGate = useCityStore((s) => s.openGate)
  const closeGate = useCityStore((s) => s.closeGate)
  const [cities, setCities] = useState<CityDto[]>([])
  const [citiesLoading, setCitiesLoading] = useState(true)
  // apiDegraded: GET /api/cities thất bại sau retry (hoặc backend trả danh
  // sách fallback) → hiển thị cảnh báo + vẫn cho chọn city từ danh sách tĩnh
  const [apiDegraded, setApiDegraded] = useState(false)
  // mounted: client-side snapshot (true) vs server snapshot (false) — tránh
  // hydration mismatch với state persist localStorage của zustand
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  useEffect(() => {
    // Retry ×3 (cách nhau 2.5s): lần boot Docker đầu backend còn đang seed
    // (schema + 388 phường/xã + pipeline Kaggle) — nếu bỏ cuộc ngay, cổng
    // chọn thành phố trống vĩnh viễn cho tới khi F5.
    let cancelled = false
    const load = (attempt: number) => {
      apiFetch('/api/cities')
        .then((r) => {
          if (!r.ok) throw new Error(`/api/cities ${r.status}`)
          return r.json()
        })
        .then((d) => {
          if (cancelled) return
          setCities(d.cities ?? [])
          // backend trả danh sách fallback tĩnh (bảng City chưa sẵn sàng)
          // → cũng coi như degraded để người dùng được cảnh báo rõ ràng
          setApiDegraded(Boolean(d.fallback))
          setCitiesLoading(false) // thành công: tắt loading NGAY (không chờ hết retry)
        })
        .catch(() => {
          if (!cancelled && attempt < 3) window.setTimeout(() => load(attempt + 1), 2500)
          else if (!cancelled) {
            // KHÔNG bao giờ rỗng: vẫn hiện đủ 3 TP từ danh sách tĩnh để
            // người dùng chọn/đổi được thành phố (Hà Nội ↔ Đà Nẵng ↔ TP.HCM)
            setCities(FALLBACK_CITIES)
            setApiDegraded(true)
            setCitiesLoading(false)
          }
        })
    }
    load(1)
    return () => {
      cancelled = true
    }
  }, [])

  const city = cities.find((c) => c.id === cityId) ?? null

  // (re)load LEZ zones — all=1 cho admin; planner tự lọc theo thành phố
  useEffect(() => {
    let cancelled = false
    apiFetch('/api/zones?all=1')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setZones(data.zones ?? [])
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [zonesVersion])

  const handleZonesChanged = useCallback(() => {
    setZonesVersion((v) => v + 1)
  }, [])

  // Tự phục hồi backend: pings /api/backend-keepalive when mounted and periodically.
  useEffect(() => {
    const ping = () => {
      fetch('/api/backend-keepalive', { cache: 'no-store' }).catch(() => null)
    }
    ping()
    const timer = setInterval(ping, 45_000)
    return () => clearInterval(timer)
  }, [])

  // Chưa chọn thành phố (hoặc đang mở lại cổng) → chặn tương tác bằng overlay
  const showGate = mounted && (!cityId || gateOpen)
  const plannerZones = city ? zones.filter((z) => zoneInCity(z, city.id)) : []

  return (
    <div
      className={
        tab === 'planner'
          ? 'flex h-dvh flex-col overflow-hidden bg-background'
          : 'flex min-h-screen flex-col bg-background'
      }
    >
      {/* ---------------- header ---------------- */}
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Leaf className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-tight">
                Ride<span className="text-primary">Shift</span>
              </h1>
              <p className="text-[11px] leading-tight text-muted-foreground">
                Trợ lý chuyển đổi giao thông thông minh
              </p>
            </div>
          </div>
          <nav className="ml-auto flex flex-wrap items-center justify-end gap-2" aria-label="Điều hướng chính">
            {/* chip thành phố (yêu cầu 6 — bấm để mở lại cổng chọn thành phố) */}
            {city && (
              <button
                type="button"
                onClick={openGate}
                title="Đổi thành phố"
                aria-label={`Đang khoá theo ${city.name} — bấm để đổi thành phố`}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-900 transition-colors hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
              >
                <MapPin className="h-4 w-4 text-emerald-600" aria-hidden />
                {city.name}
              </button>
            )}
            <div className="flex items-center gap-1 rounded-full border bg-muted/50 p-1">
            <button
              type="button"
              onClick={() => setTab('planner')}
              aria-current={tab === 'planner' ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                tab === 'planner'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <MapPinned className="h-4 w-4" aria-hidden /> Lập kế hoạch
            </button>
            <button
              type="button"
              onClick={() => setTab('policy')}
              aria-current={tab === 'policy' ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                tab === 'policy'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Landmark className="h-4 w-4" aria-hidden /> Chính sách
            </button>
            <button
              type="button"
              onClick={() => setTab('admin')}
              aria-current={tab === 'admin' ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                tab === 'admin'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ShieldCheck className="h-4 w-4" aria-hidden /> Quản trị
            </button>
            </div>
          </nav>
        </div>
      </header>

      {/* ---------------- main ---------------- */}
      {tab === 'planner' ? (
        /* map-first full-bleed: bản đồ tràn viền, panel nổi (Task 33 - phương án A) */
        <main className="relative flex-1 overflow-hidden">
          {city ? (
            <TripPlanner
              key={city.id}
              city={city}
              zones={plannerZones}
              onZonesChanged={handleZonesChanged}
              focusZone={mapFocus}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Đang tải…
            </div>
          )}
        </main>
      ) : tab === 'policy' ? (
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
          <PolicyBulletinView
            onViewOnMap={(zoneId) => {
              // Task 79: nhảy sang tab Lập kế hoạch + fitBounds ranh giới vùng
              const z = zones.find((zz) => zz.id === zoneId)
              if (z?.coordinates?.length) {
                setMapFocus(z.coordinates)
                setTab('planner')
              }
            }}
          />
        </main>
      ) : (
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
          <AdminDashboard zones={zones} onZonesChanged={handleZonesChanged} />
        </main>
      )}

      {/* ---------------- cảnh báo API degraded ---------------- */}
      {mounted && apiDegraded && (
        <div
          role="status"
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        >
          ⚠️ Chưa kết nối được dữ liệu từ backend FastAPI — đang dùng danh sách thành phố dự phòng.
          Bản đồ/phường/xã có thể thiếu. Kiểm tra: <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/60">docker compose logs backend</code> hoặc F5 sau vài phút.
        </div>
      )}


      {/* ---------------- toast host (sonner — dùng bởi chuông thông báo + phản hồi đề xuất) ---------------- */}
      <SonnerToaster />

      {/* ---------------- cổng chọn thành phố (yêu cầu 5/6) ---------------- */}
      {showGate && (
        <CityGate
          cities={cities}
          current={cityId}
          loading={citiesLoading}
          degraded={apiDegraded}
          onConfirm={(id) => selectCity(id)}
          onCancel={gateOpen && cityId ? closeGate : undefined}
        />
      )}

      {/* ---------------- footer (sticky bottom; planner dùng app-shell không footer) ---------------- */}
      {tab !== 'planner' && (
        <footer className="mt-auto border-t bg-muted/40 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
          <p className="flex items-center gap-1.5">
            <Leaf className="h-3.5 w-3.5 text-primary" aria-hidden />
            <strong className="font-semibold text-foreground">RideShift</strong>
          </p>
        </div>
      </footer>
      )}
    </div>
  )
}
