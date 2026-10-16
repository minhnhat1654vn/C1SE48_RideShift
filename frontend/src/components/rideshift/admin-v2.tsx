'use client'

// Quản trị v2 — dashboard trên schema v2: đăng nhập bcrypt + phiên DB,
// KPI/biểu đồ từ /api/v2/admin/analytics, chỉnh trọng số 7 tiêu chí.
// Form theo hướng dẫn ux: error summary role=alert + focus, validate inline.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  BarChart3,
  Database,
  Loader2,
  LogOut,
  RefreshCw,
  Save,
  ShieldCheck,
  Timer,
  TrendingUp,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  getAnalyticsV2,
  getWeightsV2,
  loginV2,
  logoutV2,
  meV2,
  putWeightsV2,
  type V2Admin,
  type V2Analytics,
  type V2Weight,
} from '@/lib/admin-v2'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function ErrorSummary({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}

function KpiCard({
  label,
  value,
  suffix,
  pct,
  note,
}: {
  label: string
  value: number | string
  suffix?: string
  pct?: number
  note: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {value}
          {suffix && <span className="ml-0.5 text-sm font-medium text-muted-foreground">{suffix}</span>}
        </p>
        {typeof pct === 'number' && (
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={label}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  )
}

function LoginCard({ onLogin }: { onLogin: (a: V2Admin) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const errRef = useRef<HTMLDivElement>(null)

  const submit = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await loginV2(email, password)
      onLogin(r.admin)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Đăng nhập thất bại.')
      errRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }, [email, password, onLogin])

  return (
    <Card className="mx-auto mt-10 max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          Đăng nhập quản trị (v2)
        </CardTitle>
        <CardDescription>
          Phiên hết hạn sau 8 giờ. Đăng xuất sẽ thu hồi phiên trên máy chủ.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div ref={errRef} tabIndex={-1}>
            <ErrorSummary message={error} />
          </div>
        )}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="a2-email">Email</Label>
            <Input
              id="a2-email" type="email" autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)} required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a2-password">Mật khẩu</Label>
            <Input
              id="a2-password" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Đăng nhập
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function Overview({ admin, onLogout }: { admin: V2Admin; onLogout: () => void }) {
  const [data, setData] = useState<V2Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await getAnalyticsV2())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được số liệu.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Xin chào, <strong>{admin.name}</strong> — số liệu tổng hợp từ các chuyến đi ẩn danh (schema v2).
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Làm mới
          </Button>
          <Button size="sm" variant="ghost" onClick={onLogout}>
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            Đăng xuất
          </Button>
        </div>
      </div>

      {error && <ErrorSummary message={error} />}

      {loading && !data && (
        <div className="flex h-40 items-center justify-center text-muted-foreground" role="status">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Đang tải số liệu…
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Tổng chuyến đi" value={data.kpis.totalTrips}
              note="số chuyến đã phân tích (ẩn danh)"
            />
            <KpiCard
              label="Đi qua vùng LEZ" value={data.kpis.lezAffectedPct} suffix="%"
              pct={data.kpis.lezAffectedPct} note="tuyến chạm/cắt vùng đang ACTIVE"
            />
            <KpiCard
              label="Ý định chuyển đổi" value={data.kpis.switchingPct} suffix="%"
              pct={data.kpis.switchingPct} note="đã chọn phương tiện khác xe hiện tại"
            />
            <KpiCard
              label="Đã ghi nhận lựa chọn" value={data.kpis.chosenCount}
              note="trên tổng số chuyến đi"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />
                  Phương án được đề xuất nhiều nhất
                </CardTitle>
                <CardDescription>đếm theo lần chạy phân tích (rank 1)</CardDescription>
              </CardHeader>
              <CardContent>
                {data.topRecommended.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Chưa có dữ liệu khuyến nghị.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={data.topRecommended}
                      layout="vertical"
                      margin={{ left: 8, right: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.4} />
                      <XAxis type="number" allowDecimals={false} fontSize={12} />
                      <YAxis
                        type="category" dataKey="mode" width={130}
                        fontSize={12} tickLine={false} axisLine={false}
                      />
                      <Tooltip />
                      <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
                  Khách chuyển sang phương tiện gì?
                </CardTitle>
                <CardDescription>chỉ tính các chuyến đã ghi nhận lựa chọn</CardDescription>
              </CardHeader>
              <CardContent>
                {data.switchingTo.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Chưa có lượt chuyển đổi nào được ghi nhận.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={data.switchingTo}
                      layout="vertical"
                      margin={{ left: 8, right: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.4} />
                      <XAxis type="number" allowDecimals={false} fontSize={12} />
                      <YAxis
                        type="category" dataKey="vehicleType" width={130}
                        fontSize={12} tickLine={false} axisLine={false}
                      />
                      <Tooltip />
                      <Bar dataKey="count" fill="#0ea5e9" radius={[0, 4, 4, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Timer className="h-4 w-4 text-primary" aria-hidden="true" />
                  Hiệu năng khuyến nghị
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>Số lần chạy: <strong>{data.recommendationStats.runs}</strong></p>
                <p>Thời gian trung bình: <strong>{data.recommendationStats.avgMs} ms</strong></p>
                <p>Chậm nhất: <strong>{data.recommendationStats.maxMs} ms</strong></p>
                <p className="mt-1 text-xs text-muted-foreground">đo trên máy chủ (Phase 7)</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Database className="h-4 w-4 text-primary" aria-hidden="true" />
                  Dữ liệu khảo sát
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>Tổng bản ghi: <strong>{data.dataset.surveyTotal}</strong></p>
                <p>Hợp lệ: <strong>{data.dataset.surveyValid}</strong></p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.dataset.importedAt
                    ? `nạp lúc ${new Date(data.dataset.importedAt).toLocaleString('vi-VN')}`
                    : 'chưa nạp dataset (Q4)'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Theo mục đích chuyến đi</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {data.byPurpose.map((p) => (
                    <li key={p.purpose} className="flex justify-between">
                      <span>{p.purpose}</span>
                      <strong className="tabular-nums">{p.count}</strong>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function WeightsEditor() {
  const [weights, setWeights] = useState<V2Weight[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const errRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await getWeightsV2()
      setWeights(d.weights)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được trọng số.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const total = weights.reduce((s, w) => s + w.weight, 0)
  const ok = Math.abs(total - 1) <= 0.01

  const save = useCallback(async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await putWeightsV2(weights.map((w) => ({ code: w.code, weight: w.weight })))
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu thất bại.')
      errRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }, [weights])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trọng số 7 tiêu chí (tổng phải bằng 1)</CardTitle>
        <CardDescription>
          Admin cấu hình — mỗi lần phân tích sẽ chụp snapshot trọng số này (US-34).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div ref={errRef} tabIndex={-1}>
            <ErrorSummary message={error} />
          </div>
        )}
        {loading && (
          <div className="flex h-24 items-center justify-center text-muted-foreground" role="status">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Đang tải…
          </div>
        )}
        {!loading && (
          <>
            <div className="space-y-3">
              {weights.map((w) => (
                <div
                  key={w.code}
                  className="grid grid-cols-[1fr_7rem_5rem] items-center gap-3 sm:grid-cols-[1fr_9rem_6rem]"
                >
                  <div>
                    <Label htmlFor={`w-${w.code}`} className="text-sm">{w.name}</Label>
                    <p className="text-xs text-muted-foreground">
                      {w.code} · {w.type === 'COST' ? 'càng thấp càng tốt' : 'càng cao càng tốt'}
                    </p>
                  </div>
                  <Input
                    id={`w-${w.code}`}
                    type="number" min={0} max={1} step={0.05}
                    value={w.weight}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0
                      setWeights((ws) =>
                        ws.map((x) => (x.code === w.code ? { ...x, weight: v } : x)),
                      )
                      setSaved(false)
                    }}
                    aria-label={`Trọng số ${w.name}`}
                  />
                  <Badge variant={w.type === 'COST' ? 'destructive' : 'default'} className="justify-center">
                    {w.type}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className={`text-sm font-medium ${ok ? 'text-emerald-700' : 'text-destructive'}`}>
                Tổng: {total.toFixed(2)} / 1.00 {ok ? '✓' : '(chưa đạt)'}
              </p>
              <Button onClick={save} disabled={!ok || saving}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                Lưu trọng số
              </Button>
            </div>
            {saved && (
              <p role="status" className="text-sm text-emerald-700">
                Đã lưu — các lần phân tích mới sẽ dùng trọng số này.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default function AdminV2() {
  const [admin, setAdmin] = useState<V2Admin | null>(null)
  const [checking, setChecking] = useState(true)
  const [subTab, setSubTab] = useState<'overview' | 'weights'>('overview')

  useEffect(() => {
    meV2()
      .then((r) => setAdmin(r.admin))
      .catch(() => setAdmin(null))
      .finally(() => setChecking(false))
  }, [])

  const handleLogout = useCallback(async () => {
    await logoutV2().catch(() => null)
    setAdmin(null)
  }, [])

  if (checking) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground" role="status">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Đang kiểm tra phiên…
      </div>
    )
  }
  if (!admin) return <LoginCard onLogin={setAdmin} />

  return (
    <div className="space-y-4">
      <nav className="flex gap-1 rounded-full border bg-muted/50 p-1" aria-label="Mục quản trị v2">
        {([
          ['overview', 'Tổng quan'],
          ['weights', 'Trọng số'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSubTab(key)}
            aria-current={subTab === key ? 'true' : undefined}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              subTab === key
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      {subTab === 'overview' ? <Overview admin={admin} onLogout={handleLogout} /> : <WeightsEditor />}
    </div>
  )
}
