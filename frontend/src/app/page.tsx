'use client'

// RideShift – Smart Transport Transition Advisor (C1SE.48)
// Single-page application: Trip Planner (guest users) + Admin Dashboard.

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { BookOpenText, Leaf, Loader2, MapPinned, ShieldCheck } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { LezZoneDto } from '@/lib/types'
import DocsViewer from '@/components/rideshift/docs-viewer'

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

type TabKey = 'planner' | 'admin'

export default function Home() {
  const [tab, setTab] = useState<TabKey>('planner')
  const [docsOpen, setDocsOpen] = useState(false)
  const [zones, setZones] = useState<LezZoneDto[]>([])
  const [zonesVersion, setZonesVersion] = useState(0)

  // (re)load LEZ zones whenever the version changes (e.g. after admin edits)
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
  // If the FastAPI API ever dies, the route respawns it as a child of this
  // Next.js server (the only process tree that survives the sandbox reaper).
  useEffect(() => {
    const ping = () => {
      fetch('/api/backend-keepalive', { cache: 'no-store' }).catch(() => null)
    }
    ping()
    const timer = setInterval(ping, 45_000)
    return () => clearInterval(timer)
  }, [])

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

          <nav className="ml-auto flex items-center gap-2" aria-label="Điều hướng chính">
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
            <button
              type="button"
              onClick={() => setDocsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <BookOpenText className="h-4 w-4" aria-hidden /> Tài liệu
            </button>
          </nav>
        </div>
      </header>

      {/* ---------------- main ---------------- */}
      {tab === 'planner' ? (
        /* map-first full-bleed: bản đồ tràn viền, panel nổi (Task 33 - phương án A) */
        <main className="relative flex-1 overflow-hidden">
          <TripPlanner zones={zones} onZonesChanged={handleZonesChanged} />
        </main>
      ) : (
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
          <AdminDashboard zones={zones} onZonesChanged={handleZonesChanged} />
        </main>
      )}

      {/* ---------------- docs viewer ---------------- */}
      <DocsViewer open={docsOpen} onOpenChange={setDocsOpen} />

      {/* ---------------- footer (sticky bottom; planner dùng app-shell không footer) ---------------- */}
      {tab !== 'planner' && (
        <footer className="mt-auto border-t bg-muted/40 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
          <p className="flex items-center gap-1.5">
            <Leaf className="h-3.5 w-3.5 text-primary" aria-hidden />
            <strong className="font-semibold text-foreground">RideShift</strong> – Trợ lý chuyển đổi
            giao thông thông minh · Dự án tốt nghiệp 1 (CMU-SE 450) · Nhóm C1SE.48 · Trường Quốc tế,
            Đại học Duy Tân
          </p>
          <p>
            Dữ liệu bản đồ © OpenStreetMap · Định tuyến OSRM · Chất lượng không khí Open-Meteo ·{' '}
            <span className="italic">Hà Nội sạch hơn cho một ngày mai tốt đẹp hơn</span>
          </p>
        </div>
      </footer>
      )}
    </div>
  )
}
