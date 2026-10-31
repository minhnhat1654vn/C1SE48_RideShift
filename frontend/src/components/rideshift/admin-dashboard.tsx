'use client'

// RideShift Admin Dashboard — Task 3-b (C1SE.48, Duy Tan University)
//
// Main component: authentication gate + tabbed console.
//   - US-21: admin login / logout (cookie session handled by the server).
//   - US-25 / US-28 / US-35: Overview tab — KPI cards, survey-dataset card
//     (processed Vehicle at Ha Noi data + pipeline re-run), distribution
//     charts, recent trips table and a from/to date range filter.
//   - US-22/31/32: LEZ Zones tab  → ./admin/zones-tab.tsx
//   - US-23/24/32: Policy Rules tab and US-33/34 Modes & Weights tab
//                  → ./admin/rules-modes-tabs.tsx
//
// The parent page owns the live `zones` array and refreshes it whenever this
// component calls `onZonesChanged()`.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { apiFetch } from '@/lib/api'
import {
  Activity,
  BarChart3,
  BookLock,
  CheckCircle2,
  ChevronRight,
  Coins,
  Database,
  Info,
  Leaf,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { LezZoneDto, ModeInfo, PolicyRuleDto } from '@/lib/types'

import type { AnalyticsWithDataset, DatasetTrendRow } from '@/components/rideshift/admin/types'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import ZonesTab from '@/components/rideshift/admin/zones-tab'
import LezImpactTab from '@/components/rideshift/admin/lez-impact-tab'
import { ModesWeightsTab, RulesTab } from '@/components/rideshift/admin/rules-modes-tabs'
import StatsTab from '@/components/rideshift/admin/stats-tab'

// Point type for the US-25 survey trend chart (share % + tooltip extras).
type TrendPoint = DatasetTrendRow & { name: string; sharePct: number }

// Small JSON fetch helper with consistent error extraction (server returns { error }).
async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, {
    credentials: 'include', // cross-origin: localhost:3000 → localhost:8000 cần gửi/nhận cookie phiên
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      (data as { error?: string }).error ?? `Yêu cầu thất bại (mã trạng thái ${res.status}).`
    throw new Error(msg)
  }
  return data as T
}

const SCROLLBAR_CLASS =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-emerald-300/50 [&::-webkit-scrollbar-track]:bg-transparent'

// Green/amber palette for charts (no blue/indigo per design system).
const CHART_COLORS = ['#16a34a', '#22c55e', '#0d9488', '#84cc16', '#eab308', '#f97316', '#dc2626']

type AdminUser = { username: string; fullName: string }
type TabKey = 'overview' | 'stats' | 'lez' | 'zones' | 'rules' | 'modes'

// Phase A — nhóm điều hướng sidebar (demo phương án A): nhóm theo bản chất
// công việc, kèm mô tả (title) và số đếm trực tiếp trên mục.
const NAV_GROUPS: {
  label: string
  items: {
    key: TabKey
    label: string
    icon: typeof Activity
    desc: string
    countOf?: 'zones' | 'rules' | 'modes'
  }[]
}[] = [
  {
    label: 'Theo dõi',
    items: [
      { key: 'overview', label: 'Tổng quan', icon: Activity, desc: 'Số liệu vận hành tổng thể của hệ thống' },
      { key: 'lez', label: 'Tác động LEZ', icon: Leaf, desc: 'Phân tích chuyến đi bị ảnh hưởng bởi vùng phát thải thấp' },
      { key: 'stats', label: 'Thống kê', icon: BarChart3, desc: 'Thống kê thời gian và khoảng cách chuyến đi (CN-39)' },
    ],
  },
  {
    label: 'Cấu hình LEZ',
    items: [
      { key: 'zones', label: 'Vùng LEZ', icon: MapPin, desc: 'Quản lý các vùng phát thải thấp', countOf: 'zones' },
      { key: 'rules', label: 'Quy định', icon: BookLock, desc: 'Quy định hạn chế theo vùng và phương tiện', countOf: 'rules' },
    ],
  },
  {
    label: 'Dữ liệu & mô hình',
    items: [
      { key: 'modes', label: 'Phương tiện & Trọng số', icon: SlidersHorizontal, desc: 'Danh mục phương tiện và trọng số MCDM', countOf: 'modes' },
    ],
  },
]

/** Local YYYY-MM-DD string (avoids UTC off-by-one from toISOString). */
function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const fmtVnd = (v: number): string => `${Math.round(v).toLocaleString('vi-VN')} ₫`

// Vietnamese display text for known backend error messages (UI language: vi).
const VI_ERROR_MAP: Record<string, string> = {
  'Invalid administrator credentials.': 'Tên đăng nhập hoặc mật khẩu không đúng.',
}
const toViError = (msg: string): string => VI_ERROR_MAP[msg] ?? msg

export default function AdminDashboard({
  zones,
  onZonesChanged,
}: {
  zones: LezZoneDto[]
  onZonesChanged: () => void
}) {
  const [user, setUser] = useState<AdminUser | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  // Mode catalogue — used for friendly names in the Overview tables/charts
  // and as the vehicle options for the Policy Rules tab.
  const [modes, setModes] = useState<ModeInfo[]>([])

  // Phase A: drawer điều hướng mobile; Phase B: danh sách quy định (badge + cảnh báo)
  const [navOpen, setNavOpen] = useState(false)
  const [rules, setRules] = useState<PolicyRuleDto[] | null>(null)

  // ---- US-21: check the existing session cookie on mount ----
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const d = await apiJson<{ user: AdminUser | null }>('/api/admin/me')
        if (!cancelled) setUser(d.user)
      } catch {
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setAuthChecked(true)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  // ---- load (or reload) the mode catalogue ----
  const loadModes = useCallback(async () => {
    try {
      const d = await apiJson<{ modes: ModeInfo[] }>('/api/admin/modes')
      setModes(d.modes)
    } catch {
      // Non-critical: tables fall back to raw mode ids.
    }
  }, [])

  useEffect(() => {
    if (!user) return
    void loadModes()
  }, [user, loadModes])

  // ---- Phase A/B: danh sách quy định (badge sidebar + cảnh báo "Cần chú ý") ----
  const loadRules = useCallback(async () => {
    try {
      const d = await apiJson<{ rules: PolicyRuleDto[] }>('/api/admin/rules')
      setRules(d.rules)
    } catch {
      // Non-critical: badge/cảnh báo chỉ là chỉ dẫn, bỏ qua lỗi.
    }
  }, [])

  useEffect(() => {
    if (!user) return
    void loadRules()
  }, [user, activeTab, loadRules])

  const handleLogout = async () => {
    try {
      await apiJson<{ ok: boolean }>('/api/admin/logout', { method: 'POST' })
    } catch {
      // Even if the request fails, drop the local session view.
    }
    setUser(null)
    setModes([])
    setActiveTab('overview')
  }

  // ---- session still being verified ----
  if (!authChecked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Loader2 className="size-6 animate-spin text-emerald-600" />
        <p className="text-sm">Đang kiểm tra phiên quản trị viên…</p>
      </div>
    )
  }

  // ---- US-21: not signed in → login gate ----
  if (!user) {
    return <LoginScreen onLoggedIn={(u) => setUser(u)} />
  }

  const modeName = (id: string) => modes.find((m) => m.id === id)?.name ?? id

  const countFor = (c?: 'zones' | 'rules' | 'modes') =>
    c === 'zones' ? zones.length : c === 'rules' ? rules?.length : c === 'modes' ? modes.length : undefined

  // Nav dùng chung cho sidebar desktop và drawer mobile (Phase A)
  const renderNav = () => (
    <div className="space-y-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400/80">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const count = countFor(item.countOf)
              const active = activeTab === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  title={item.desc}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    setActiveTab(item.key)
                    setNavOpen(false)
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors ${
                    active
                      ? 'bg-emerald-700 text-white shadow-sm'
                      : 'text-emerald-200/90 hover:bg-emerald-900/60 hover:text-white'
                  }`}
                >
                  <item.icon className="size-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {count != null && (
                    <span className="ml-auto rounded-full bg-emerald-900/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-100">
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )

  const currentLabel =
    NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === activeTab)?.label ?? ''

  return (
    <div className="flex min-h-dvh bg-background">
      {/* ---------------- Sidebar (desktop) — Phase A ---------------- */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-emerald-950 text-emerald-100 lg:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Leaf className="size-5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold text-white">RideShift Admin</p>
            <p className="text-[11px] text-emerald-300/80">Cố vấn giao thông · C1SE.48</p>
          </div>
        </div>
        <nav aria-label="Điều hướng quản trị" className="flex-1 overflow-y-auto px-3 pb-4">
          {renderNav()}
        </nav>
        <div className="border-t border-emerald-900/80 px-4 py-3">
          <p className="truncate text-xs font-semibold text-white" title={user.fullName}>
            {user.fullName}
          </p>
          <p className="truncate text-[11px] text-emerald-300/80">@{user.username}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full border-emerald-800 bg-transparent text-emerald-200 hover:bg-emerald-900 hover:text-white"
            onClick={() => void handleLogout()}
          >
            <LogOut /> Đăng xuất
          </Button>
        </div>
      </aside>

      {/* ---------------- Drawer mobile — Phase A ---------------- */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="flex w-64 flex-col border-emerald-900 bg-emerald-950 p-0 text-emerald-100">
          <SheetHeader className="border-b border-emerald-900/80 px-4 py-4 text-left">
            <SheetTitle className="flex items-center gap-2.5 text-white">
              <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
                <Leaf className="size-4" />
              </span>
              RideShift Admin
            </SheetTitle>
            <SheetDescription className="text-[11px] text-emerald-300/80">
              Bảng điều khiển quản trị
            </SheetDescription>
          </SheetHeader>
          <nav aria-label="Điều hướng quản trị" className="flex-1 overflow-y-auto px-3 py-4">
            {renderNav()}
          </nav>
          <div className="border-t border-emerald-900/80 px-4 py-3">
            <p className="truncate text-xs font-semibold text-white" title={user.fullName}>
              {user.fullName}
            </p>
            <p className="truncate text-[11px] text-emerald-300/80">@{user.username}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full border-emerald-800 bg-transparent text-emerald-200 hover:bg-emerald-900 hover:text-white"
              onClick={() => void handleLogout()}
            >
              <LogOut /> Đăng xuất
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------------- Header: hamburger + breadcrumb ---------------- */}
        <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex w-full items-center gap-2 px-4 py-3 sm:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Mở menu điều hướng"
              onClick={() => setNavOpen(true)}
            >
              <Menu className="size-5" />
            </Button>
            <p className="min-w-0 truncate text-sm text-muted-foreground">
              Quản trị
              <span className="mx-1.5 text-border">/</span>
              <span className="font-semibold text-foreground">{currentLabel}</span>
            </p>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <Badge
                variant="outline"
                className="hidden border-emerald-200 bg-emerald-50 text-emerald-700 md:inline-flex dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
              >
                @{user.username}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="lg:hidden"
                onClick={() => void handleLogout()}
              >
                <LogOut /> Đăng xuất
              </Button>
            </div>
          </div>
        </header>

        {/* ---------------- Nội dung tab ---------------- */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
            <TabsContent value="overview" className="mt-0">
              <OverviewSection
                modeName={modeName}
                zones={zones}
                rules={rules}
                onNavigate={(tab) => setActiveTab(tab)}
              />
            </TabsContent>
            <TabsContent value="lez" className="mt-0">
              <LezImpactTab />
            </TabsContent>
            <TabsContent value="stats" className="mt-0">
              <StatsTab />
            </TabsContent>
            <TabsContent value="zones" className="mt-0">
              <ZonesTab zones={zones} onZonesChanged={onZonesChanged} />
            </TabsContent>
            <TabsContent value="rules" className="mt-0">
              <RulesTab zones={zones} modes={modes} />
            </TabsContent>
            <TabsContent value="modes" className="mt-0">
              <ModesWeightsTab onModesChanged={loadModes} />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  )
}

/* =====================================================================
 * Login gate — US-21
 * ===================================================================== */

function LoginScreen({ onLoggedIn }: { onLoggedIn: (user: AdminUser) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const d = await apiJson<{ user: AdminUser }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      })
      onLoggedIn(d.user)
    } catch (err) {
      setError(toViError(err instanceof Error ? err.message : 'Đăng nhập thất bại. Vui lòng thử lại.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-emerald-50 via-background to-background px-4 dark:from-emerald-950/30">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-1 flex size-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <ShieldCheck className="size-6" />
          </div>
          <CardTitle className="text-xl">Đăng nhập quản trị viên</CardTitle>
          <CardDescription>
            RideShift — Cố vấn chuyển đổi giao thông thông minh. Quản lý vùng LEZ, quy định và cài
            đặt xếp hạng.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Submitting via the form enables Enter-key submit (US-21) */}
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
            <div className="grid gap-1.5">
              <Label htmlFor="admin-username">Tên đăng nhập</Label>
              <Input
                id="admin-username"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="admin-password">Mật khẩu</Label>
              <Input
                id="admin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                <TriangleAlert className="size-4 shrink-0" /> {error}
              </p>
            )}
            <Button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={submitting || !username.trim() || !password}
            >
              {submitting ? <Loader2 className="animate-spin" /> : <LogIn />} Đăng nhập
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Tài khoản demo mặc định: <span className="font-mono">admin / admin123</span>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

/** Phase B — mũi tên so sánh với kỳ trước (cùng độ dài). */
function DeltaBadge({
  cur,
  prev,
  goodWhen,
}: {
  cur: number
  prev: number | null
  goodWhen: 'up' | 'down'
}) {
  if (prev == null || prev === 0 || !isFinite(prev) || !isFinite(cur)) return null
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  if (Math.abs(pct) < 0.05) return null
  const up = pct > 0
  const good = (up && goodWhen === 'up') || (!up && goodWhen === 'down')
  return (
    <span
      title="So với kỳ trước cùng độ dài"
      className={`ml-1 align-middle text-[11px] font-semibold ${
        good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
      }`}
    >
      {up ? '▲' : '▼'} {Math.abs(pct).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%
    </span>
  )
}

/** Phase B — tải CSV (BOM để Excel mở tiếng Việt đúng). */
function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map(esc).join(';')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/* =====================================================================
 * Overview tab — US-28 analytics + US-35 date filter
 * ===================================================================== */

function OverviewSection({
  modeName,
  zones,
  rules,
  onNavigate,
}: {
  modeName: (id: string) => string
  zones: LezZoneDto[]
  rules: PolicyRuleDto[] | null // null = chưa tải được (lỗi mạng/mất phiên) — không rút ra cảnh báo nghiệp vụ
  onNavigate: (tab: TabKey) => void
}) {
  const defaults = useMemo(
    () => ({ from: isoDate(new Date(Date.now() - 30 * 86400000)), to: isoDate(new Date()) }),
    []
  )
  const [fromInput, setFromInput] = useState(defaults.from)
  const [toInput, setToInput] = useState(defaults.to)
  const [applied, setApplied] = useState(defaults)
  const [rangeError, setRangeError] = useState<string | null>(null)
  // AnalyticsWithDataset = AnalyticsResponse + the optional US-25 survey
  // `dataset` section; typing it locally keeps rendering safe while the
  // backend rolls the field out.
  const [data, setData] = useState<AnalyticsWithDataset | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ---- Phase B: cập nhật-lúc, kỳ trước để so sánh ▲▼, hôm nay, AQI, tìm chuyến ----
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [prevKpis, setPrevKpis] = useState<AnalyticsWithDataset['kpis'] | null>(null)
  const [todayTrips, setTodayTrips] = useState<number | null>(null)
  const [aqi, setAqi] = useState<{ aqi: number | null; category: string | null } | null>(null)
  const [tripQuery, setTripQuery] = useState('')

  // ---- US-25: pipeline re-run state ----
  const [reprocessing, setReprocessing] = useState(false)
  const [reprocessResult, setReprocessResult] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true)
    setError(null)
    try {
      const d = await apiJson<AnalyticsWithDataset>(`/api/admin/analytics?from=${from}&to=${to}`)
      setData(d)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? toViError(err.message) : 'Không thể tải số liệu phân tích.')
    } finally {
      setLoading(false)
    }

    // ---- Phase B: KPI kỳ trước (cùng độ dài) để so sánh ▲▼ — lỗi bỏ qua ----
    try {
      const fromD = new Date(`${from}T00:00:00`)
      const toD = new Date(`${to}T00:00:00`)
      const lenDays = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1)
      const prevTo = isoDate(new Date(fromD.getTime() - 86400000))
      const prevFrom = isoDate(new Date(fromD.getTime() - lenDays * 86400000))
      const p = await apiJson<AnalyticsWithDataset>(`/api/admin/analytics?from=${prevFrom}&to=${prevTo}`)
      setPrevKpis(p.kpis)
    } catch {
      setPrevKpis(null)
    }

    // ---- Phase B: chuyến hôm nay + AQI Hà Nội (bổ trợ, lỗi bỏ qua) ----
    try {
      const today = isoDate(new Date())
      const t = await apiJson<AnalyticsWithDataset>(`/api/admin/analytics?from=${today}&to=${today}`)
      setTodayTrips(t.kpis.totalTrips)
    } catch {
      setTodayTrips(null)
    }
    try {
      const a = await apiJson<{ airQuality: { aqi: number | null; category: string | null } }>(
        '/api/airquality?lat=21.0285&lng=105.8542',
      )
      setAqi({ aqi: a.airQuality.aqi, category: a.airQuality.category })
    } catch {
      setAqi(null)
    }
  }, [])

  useEffect(() => {
    void load(applied.from, applied.to)
  }, [applied, load])

  const applyRange = () => {
    if (fromInput > toInput) {
      setRangeError('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.')
      return
    }
    setRangeError(null)
    setApplied({ from: fromInput, to: toInput })
  }

  const resetRange = () => {
    setRangeError(null)
    setFromInput(defaults.from)
    setToInput(defaults.to)
    setApplied(defaults)
  }

  // ---- US-25: re-run the pandas pipeline on the survey CSV, then refetch ----
  const handleReprocess = async () => {
    if (reprocessing) return
    setReprocessing(true)
    setReprocessResult(null)
    try {
      await apiJson<Record<string, unknown>>('/api/admin/dataset/reprocess', { method: 'POST' })
      setReprocessResult({ ok: true, text: 'Pipeline hoàn tất — số liệu dữ liệu đã được làm mới.' })
      await load(applied.from, applied.to)
    } catch (err) {
      setReprocessResult({
        ok: false,
        text: err instanceof Error ? toViError(err.message) : 'Không thể xử lý lại dữ liệu.',
      })
    } finally {
      setReprocessing(false)
    }
  }

  const k = data?.kpis

  const kpis: { label: string; value: string; sub?: string; icon: typeof Route; delta?: ReactNode }[] = [
    {
      label: 'Tổng số chuyến',
      value: k ? k.totalTrips.toLocaleString('vi-VN') : '—',
      sub: 'trong khoảng thời gian đã chọn',
      icon: Route,
      delta: <DeltaBadge cur={k?.totalTrips ?? 0} prev={prevKpis?.totalTrips ?? null} goodWhen="up" />,
    },
    {
      label: 'Bị ảnh hưởng bởi LEZ',
      value: k ? `${k.lezAffectedPct.toFixed(1)}%` : '—',
      sub: 'tuyến đi qua vùng LEZ',
      icon: MapPin,
      delta: <DeltaBadge cur={k?.lezAffectedPct ?? 0} prev={prevKpis?.lezAffectedPct ?? null} goodWhen="down" />,
    },
    {
      label: 'Thời gian di chuyển trung bình',
      value: k ? `${k.avgTimeMin.toFixed(1)} phút` : '—',
      sub: 'của khuyến nghị hàng đầu',
      icon: Activity,
      delta: <DeltaBadge cur={k?.avgTimeMin ?? 0} prev={prevKpis?.avgTimeMin ?? null} goodWhen="down" />,
    },
    {
      label: 'Chi phí trung bình',
      value: k ? fmtVnd(k.avgCostVnd) : '—',
      sub: 'của khuyến nghị hàng đầu',
      icon: Coins,
      delta: <DeltaBadge cur={k?.avgCostVnd ?? 0} prev={prevKpis?.avgCostVnd ?? null} goodWhen="down" />,
    },
    {
      label: 'Ý định chuyển đổi',
      value: k ? `${k.switchingPct.toFixed(1)}%` : '—',
      sub: 'người dùng chọn phương tiện khác',
      icon: TrendingUp,
      delta: <DeltaBadge cur={k?.switchingPct ?? 0} prev={prevKpis?.switchingPct ?? null} goodWhen="up" />,
    },
    {
      label: 'Được đề xuất nhiều nhất',
      value: k?.mostRecommended ? k.mostRecommended.name : '—',
      sub: k?.mostRecommended ? `${k.mostRecommended.count} chuyến` : 'chưa có dữ liệu',
      icon: Leaf,
    },
  ]

  // ---- Phase B: danh sách "Cần chú ý" từ dữ liệu cấu hình + pipeline ----
  // Lưu ý: chỉ đưa ra cảnh báo nghiệp vụ khi dữ liệu tương ứng TẢI THÀNH CÔNG
  // (analytics/rules khác null). Khi fetch lỗi (vd mất phiên), dữ liệu là null
  // — hiển thị cảnh báo "pipeline trống / vùng không có quy định" sẽ là báo
  // động giả, vì không ai biết DB thực sự trống hay chưa.
  const notices: { tone: 'warn' | 'info'; text: string; tab?: TabKey }[] = []
  const datasetLastRun = data?.dataset?.lastRun ?? null
  if (data !== null && !datasetLastRun) {
    notices.push({ tone: 'warn', text: 'Pipeline dữ liệu khảo sát chưa từng chạy — dữ liệu xu hướng đang trống.' })
  } else if (datasetLastRun) {
    const days = Math.floor((Date.now() - new Date(datasetLastRun.ranAt).getTime()) / 86400000)
    if (days >= 7) {
      notices.push({ tone: 'warn', text: `Pipeline dữ liệu khảo sát đã ${days} ngày chưa chạy lại.` })
    }
  }
  if (rules !== null) {
    zones
      .filter((z) => z.active && !rules.some((r) => r.zoneId === z.id && r.active))
      .forEach((z) =>
        notices.push({ tone: 'warn', text: `Vùng "${z.name}" đang hoạt động nhưng chưa có quy định nào.`, tab: 'rules' }),
      )
  }
  const offZones = zones.filter((z) => !z.active).length
  if (offZones > 0) notices.push({ tone: 'info', text: `${offZones} vùng LEZ đang tạm tắt.`, tab: 'zones' })
  const offRules = rules?.filter((r) => !r.active).length ?? 0
  if (offRules > 0) notices.push({ tone: 'info', text: `${offRules} quy định đang tạm tắt.`, tab: 'rules' })

  // ---- Phase B: lọc bảng chuyến đi gần đây ----
  const q = tripQuery.trim().toLowerCase()
  const filteredTrips =
    data?.trips.filter((t) =>
      q
        ? `${t.originName} ${t.destName} ${modeName(t.vehicleId)} ${modeName(t.topModeId)} ${t.purpose}`
            .toLowerCase()
            .includes(q)
        : true,
    ) ?? []

  const pieData = (data?.modeDistribution ?? []).map((d) => ({
    ...d,
    name: d.name || modeName(d.modeId),
  }))
  const districtData = data?.byDistrict ?? []
  const purposeData = (data?.byPurpose ?? []).map((p) => ({
    ...p,
    purpose: p.purpose.charAt(0).toUpperCase() + p.purpose.slice(1),
  }))
  const switchingData = (data?.switching ?? []).map((s) => ({ ...s, name: modeName(s.modeId) }))

  // ---- US-25: processed survey dataset (optional section) ----
  const dataset = data?.dataset ?? null
  const lastRun = dataset?.lastRun ?? null
  const ranAtDate = lastRun ? new Date(lastRun.ranAt) : null
  const lastRunLabel =
    ranAtDate && !Number.isNaN(ranAtDate.getTime())
      ? ranAtDate.toLocaleString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Chưa bao giờ'

  const datasetKpis: { label: string; value: string }[] = [
    { label: 'Chạy pipeline gần nhất', value: lastRunLabel },
    {
      label: 'Số dòng sạch',
      value: lastRun ? lastRun.rowsClean.toLocaleString('vi-VN') : '—',
    },
    { label: 'Dòng đầu vào', value: lastRun ? lastRun.rowsIn.toLocaleString('vi-VN') : '—' },
    {
      label: dataset?.periodKind === 'cohort' ? 'Kỳ dữ liệu cuối' : 'Tháng mới nhất',
      value: dataset?.latestMonth ?? '—',
    },
  ]

  // Dataset pipeline rewrites decision.dataset_trends each run (unique per mode+period) —
  // de-dupe by modeId (values are identical) so the chart shows 7 clean bars.
  const seenModes = new Set<string>()
  const trendData: TrendPoint[] = (dataset?.modeTrend ?? [])
    .filter((t) => {
      if (seenModes.has(t.modeId)) return false
      seenModes.add(t.modeId)
      return true
    })
    .map((t) => ({
      ...t,
      name: t.modeName || modeName(t.modeId),
      // API trả share dạng % (0–100) ở CẢ hai nhánh (monthly scaffold lẫn
      // cohort Kaggle) — backend đã nhân 100 từ tỉ lệ 0..1 trong DB.
      sharePct: Math.round(t.share * 10) / 10,
    }))

  return (
    <div className="flex flex-col gap-4">
      {/* ---- US-35: date range filter ---- */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 px-4 py-4">
          <div className="grid gap-1.5">
            <Label htmlFor="analytics-from">Từ ngày</Label>
            <Input
              id="analytics-from"
              type="date"
              value={fromInput}
              max={toInput}
              onChange={(e) => setFromInput(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="analytics-to">Đến ngày</Label>
            <Input
              id="analytics-to"
              type="date"
              value={toInput}
              min={fromInput}
              onChange={(e) => setToInput(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={applyRange}
            disabled={loading}
          >
            Áp dụng
          </Button>
          <Button variant="outline" onClick={resetRange} disabled={loading}>
            Đặt lại
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Làm mới số liệu phân tích"
            onClick={() => setApplied((prev) => ({ ...prev }))}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} />
          </Button>
          <span className="ml-auto self-center text-xs text-muted-foreground">
            {applied.from} → {applied.to}
            {lastUpdated && (
              <>
                {' '}· Cập nhật{' '}
                {lastUpdated.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </>
            )}
          </span>
        </CardContent>
      </Card>
      {rangeError && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
          <TriangleAlert className="size-4 shrink-0" /> {rangeError}
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
          <TriangleAlert className="size-4 shrink-0" /> {error}
        </p>
      )}

      {/* ---- Phase B: dải sức khỏe hệ thống ---- */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-gradient-to-br from-emerald-700 to-emerald-600 p-4 text-white shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-100">
            Chuyến hôm nay
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{todayTrips ?? '—'}</p>
          <p className="text-[11px] text-emerald-100/90">toàn hệ thống</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
          <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
            Ý định chuyển đổi
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-900 dark:text-emerald-100">
            {k ? `${k.switchingPct.toFixed(1)}%` : '—'}
          </p>
          <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
            người dùng chọn phương tiện khác
          </p>
        </div>
        <div
          className={`rounded-xl border p-4 ${
            aqi?.aqi != null && aqi.aqi > 100
              ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
              : aqi?.aqi != null && aqi.aqi > 50
                ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
                : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40'
          }`}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            AQI Hà Nội hiện tại
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{aqi?.aqi ?? '—'}</p>
          <p className="text-[11px] text-muted-foreground">
            {aqi?.category ?? (aqi?.aqi != null ? 'theo giờ đo gần nhất' : 'không có dữ liệu')}
          </p>
        </div>
      </div>

      {/* ---- Phase B: cần chú ý ---- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <span aria-hidden>🔔</span> Cần chú ý
            {notices.length > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {notices.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Cảnh báo tự động từ dữ liệu cấu hình và pipeline hiện tại — bấm để nhảy tới mục liên quan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {notices.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="size-4 shrink-0" /> Mọi thứ đang ổn — không có cảnh báo nào.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {notices.map((n, i) => (
                <li key={i}>
                  <button
                    type="button"
                    disabled={!n.tab}
                    onClick={() => n.tab && onNavigate(n.tab)}
                    className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      n.tone === 'warn'
                        ? 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950'
                        : 'border-border bg-card text-foreground hover:bg-accent/60'
                    } ${n.tab ? '' : 'cursor-default'}`}
                  >
                    {n.tone === 'warn' ? (
                      <TriangleAlert className="size-4 shrink-0 text-amber-600" />
                    ) : (
                      <Info className="size-4 shrink-0 text-teal-600" />
                    )}
                    <span className="min-w-0 flex-1">{n.text}</span>
                    {n.tab && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---- KPI cards (US-28) ---- */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {loading && !data
          ? Array.from({ length: 6 }, (_, i) => (
              <Card key={i} className="gap-0 py-4">
                <div className="flex flex-col gap-2 px-4">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </Card>
            ))
          : kpis.map((kpi) => (
              <Card key={kpi.label} className="gap-0 py-4">
                <div className="flex items-start justify-between gap-2 px-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {kpi.label}
                    </p>
                    <p className="mt-1 break-words text-base font-semibold tabular-nums sm:text-lg" title={kpi.value}>
                      {kpi.value}
                    </p>
                    {kpi.delta}
                    <p className="mt-0.5 text-xs text-muted-foreground">{kpi.sub}</p>
                  </div>
                  <div className="shrink-0 rounded-lg bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    <kpi.icon className="size-4" />
                  </div>
                </div>
              </Card>
            ))}
      </div>

      {/* ---- US-35: survey dataset card ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="size-4 text-emerald-600" />
            Dữ liệu khảo sát
          </CardTitle>
          <CardDescription>
            Dữ liệu khảo sát “Vehicle at Ha Noi” đã qua xử lý — nguồn của tiêu chí Xu hướng và các
            thị phần phương tiện bên dưới (US-25).
          </CardDescription>
          <CardAction>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={reprocessing}>
                  {reprocessing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Xử lý
                  lại dữ liệu
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Xử lý lại dữ liệu khảo sát?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Chạy lại pipeline dữ liệu trên data/vehicle_at_hanoi.csv? Thao tác này sẽ tính
                    toán lại thị phần phương tiện theo tháng, các chỉ số xu hướng và báo cáo chạy
                    được hiển thị tại đây.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Hủy</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleReprocess()}>
                    Chạy lại
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* KPI row: last run, clean rows, rows in, latest month */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {datasetKpis.map((kpi) => (
              <div key={kpi.label} className="rounded-lg border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {kpi.label}
                </p>
                <p className="mt-1 truncate text-sm font-semibold tabular-nums" title={kpi.value}>
                  {kpi.value}
                </p>
              </div>
            ))}
          </div>

          {/* Inline pending / success / error feedback for the pipeline run */}
          {reprocessing && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin shrink-0" /> Đang xử lý lại dữ liệu…
            </p>
          )}
          {reprocessResult && !reprocessing && (
            <p
              role={reprocessResult.ok ? 'status' : 'alert'}
              className={`flex items-center gap-1.5 text-sm font-medium ${
                reprocessResult.ok
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-destructive'
              }`}
            >
              {reprocessResult.ok ? (
                <CheckCircle2 className="size-4 shrink-0" />
              ) : (
                <TriangleAlert className="size-4 shrink-0" />
              )}
              {reprocessResult.text}
            </p>
          )}

          {/* Monthly mode-share bar chart for the latest survey month */}
          {trendData.length === 0 ? (
            <p className="flex h-[260px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
              Chưa có dữ liệu xu hướng.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trendData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10 }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={58}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip content={<DatasetTrendTooltip />} />
                <Bar dataKey="sharePct" name="Thị phần" radius={[4, 4, 0, 0]}>
                  {trendData.map((t, i) => (
                    <Cell key={t.modeId} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}

          {trendData.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {dataset?.periodKind === 'cohort'
                ? 'Thị phần phương tiện trong toàn bộ mẫu khảo sát'
                : 'Thị phần phương tiện cho tháng khảo sát mới nhất'}
              {dataset?.periodKind === 'cohort'
                ? lastRun
                  ? (
                    <>
                      {' '}(<span className="font-medium text-foreground">{lastRun.rowsClean.toLocaleString('vi-VN')}</span> dòng)
                    </>
                  )
                  : null
                : dataset?.latestMonth
                  ? (
                    <>
                      {' '}<span className="font-medium text-foreground">{dataset.latestMonth}</span>
                    </>
                  )
                  : null}
              {lastRun?.sourceFile ? (
                <> {' '}· nguồn <span className="font-mono">{lastRun.sourceFile}</span></>
              ) : null}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- Charts (US-28) ---- */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Phân bố phương tiện được đề xuất</CardTitle>
            <CardDescription>
              Tỷ lệ chuyến đi theo phương tiện được đề xuất hàng đầu.
            </CardDescription>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                disabled={pieData.length === 0}
                onClick={() =>
                  downloadCsv(
                    `rideshift-phan-bo-phuong-tien-${applied.from}_${applied.to}.csv`,
                    ['Phương tiện', 'Số chuyến'],
                    pieData.map((p) => [p.name, p.count]),
                  )
                }
              >
                ⤓ Xuất CSV
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="count"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={88}
                    paddingAngle={2}
                    strokeWidth={1}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={entry.modeId} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Số chuyến theo quận xuất phát</CardTitle>
            <CardDescription>Điểm xuất phát của các chuyến đi đã phân tích.</CardDescription>
          </CardHeader>
          <CardContent>
            {districtData.length === 0 ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={districtData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="district"
                    tick={{ fontSize: 10 }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={58}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Số chuyến" radius={[4, 4, 0, 0]}>
                    {districtData.map((d, i) => (
                      <Cell key={d.district} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Số chuyến theo mục đích</CardTitle>
            <CardDescription>Phân bố theo mục đích chuyến đi đã chọn.</CardDescription>
          </CardHeader>
          <CardContent>
            {purposeData.length === 0 ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={purposeData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="purpose" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Số chuyến" radius={[4, 4, 0, 0]}>
                    {purposeData.map((p, i) => (
                      <Cell key={p.purpose} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mẫu hình chuyển đổi</CardTitle>
            <CardDescription>
              Phương tiện mà người dùng chuyển sang sau khi xem khuyến nghị (dữ liệu ý định chuyển
              đổi).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {switchingData.length === 0 ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={switchingData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10 }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={58}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Số lượt chuyển" radius={[4, 4, 0, 0]}>
                    {switchingData.map((s, i) => (
                      <Cell key={s.modeId} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---- Recent trips table (US-28) ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Chuyến đi đã phân tích gần đây</CardTitle>
          <CardDescription>
            Kết quả phân tích từng chuyến đi trong khoảng thời gian đã chọn (mới nhất trước, tối
            đa 500 bản ghi).
          </CardDescription>
          <CardAction className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={tripQuery}
                onChange={(e) => setTripQuery(e.target.value)}
                placeholder="Tìm chuyến…"
                aria-label="Tìm chuyến đi"
                className="h-8 w-40 pl-8 text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!data || filteredTrips.length === 0}
              onClick={() =>
                downloadCsv(
                  `rideshift-chuyen-di-${applied.from}_${applied.to}.csv`,
                  [
                    'Thời gian',
                    'Điểm đi',
                    'Điểm đến',
                    'Quãng đường (km)',
                    'Phương tiện',
                    'Mục đích',
                    'Đề xuất hàng đầu',
                    'LEZ',
                    'Chuyển đổi',
                  ],
                  filteredTrips.map((t) => [
                    new Date(t.createdAt).toLocaleString('vi-VN'),
                    t.originName,
                    t.destName,
                    t.distanceKm.toFixed(1),
                    modeName(t.vehicleId),
                    t.purpose,
                    modeName(t.topModeId),
                    t.lezAffected ? 'Bị ảnh hưởng' : 'Ngoài vùng',
                    t.switched ? 'Đã chuyển' : '',
                  ]),
                )
              }
            >
              ⤓ Xuất CSV
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !data || data.trips.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Chưa có chuyến đi nào trong khoảng thời gian này. Hãy phân tích chuyến đi trong
              trang lập kế hoạch để tạo dữ liệu thống kê.
            </p>
          ) : filteredTrips.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Không có chuyến nào khớp tìm kiếm — thử từ khóa khác hoặc xóa ô tìm kiếm.
            </p>
          ) : (
            <>
              {tripQuery && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Tìm thấy {filteredTrips.length}/{data.trips.length} chuyến khớp "{tripQuery}".
                </p>
              )}
              <div className={`max-h-96 overflow-y-auto rounded-md border ${SCROLLBAR_CLASS}`}>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>Thời gian</TableHead>
                    <TableHead>Điểm đi → Điểm đến</TableHead>
                    <TableHead className="text-right">Quãng đường</TableHead>
                    <TableHead>Phương tiện</TableHead>
                    <TableHead>Mục đích</TableHead>
                    <TableHead>Đề xuất hàng đầu</TableHead>
                    <TableHead>LEZ</TableHead>
                    <TableHead>Chuyển đổi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTrips.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        {new Date(t.createdAt).toLocaleString('vi-VN', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell className="max-w-[230px]">
                        <span
                          className="block truncate text-xs"
                          title={`${t.originName} → ${t.destName}`}
                        >
                          {t.originName} → {t.destName}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                        {t.distanceKm.toFixed(1)} km
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {modeName(t.vehicleId)}
                      </TableCell>
                      <TableCell className="text-xs capitalize">{t.purpose}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs font-medium">
                        {modeName(t.topModeId)}
                      </TableCell>
                      <TableCell>
                        {t.lezAffected ? (
                          <Badge variant="destructive" className="text-[10px]">
                            Bị ảnh hưởng
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            Ngoài vùng
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {t.switched ? (
                          <Badge className="bg-emerald-600 text-[10px] text-white hover:bg-emerald-600">
                            Đã chuyển
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** Friendly placeholder for charts without data. */
function ChartEmpty() {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
      Không có dữ liệu trong khoảng thời gian đã chọn.
    </div>
  )
}

/** Custom US-25 tooltip: share % plus the trend index and sample count. */
function DatasetTrendTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload?: TrendPoint }[]
}) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{p.name}</p>
      <p className="text-muted-foreground">
        Thị phần: <span className="font-medium text-foreground tabular-nums">{p.sharePct.toFixed(1)}%</span>
      </p>
      <p className="text-muted-foreground">
        Chỉ số xu hướng:{' '}
        <span className="font-medium text-foreground tabular-nums">
          {(p.trendIndex ?? 0).toFixed(2)}
        </span>
      </p>
      <p className="text-muted-foreground">
        Số mẫu:{' '}
        <span className="font-medium text-foreground tabular-nums">
          {p.sampleCount.toLocaleString('vi-VN')}
        </span>
      </p>
    </div>
  )
}
