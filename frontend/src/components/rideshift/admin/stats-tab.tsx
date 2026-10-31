'use client'

// Trip statistics tab — CN-39 (RideShift, C1SE.48)
//
// Thống kê thời gian / khoảng cách của các chuyến đi đã lưu, phục vụ
// GET /api/admin/stats/trips (đọc-đọc, không đụng MCDM/TOPSIS):
//   - KPI tổng quan: trung bình + trung vị + P95, có lọc ngoại lai theo
//     hàng rào Tukey IQR (Q1 − 1.5·IQR ~ Q3 + 1.5·IQR) phía backend.
//   - Histogram khoảng cách & thời gian: số bin do quy tắc Sturges chọn
//     (backend), bin cuối dạng "≥ X" gom ngoại lai để trục không vỡ.
//   - Diễn biến theo ngày (múi giờ Hà Nội) + giờ khởi hành (departure_hour).
//   - Bảng tổng hợp theo phương tiện được đề xuất.
//
// Backend đã truncate/làm tròn số; component chỉ định dạng hiển thị.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import {
  CalendarDays,
  Clock,
  Info,
  Layers,
  Loader2,
  Ruler,
  Route,
  Timer,
  TriangleAlert,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { TripStatsResponse } from '@/components/rideshift/admin/types'

// Cùng bảng màu xanh/vàng với Tổng quan (design system: không xanh dương/indigo).
const CHART_COLORS = ['#16a34a', '#22c55e', '#0d9488', '#84cc16', '#eab308', '#f97316', '#dc2626']

/** Local YYYY-MM-DD string (avoids UTC off-by-one from toISOString). */
function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Small JSON fetch helper — same semantics as the one in admin-dashboard.tsx.
async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, {
    credentials: 'include', // giữ cookie phiên rs_admin_session khi cross-origin
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

const fmtKm = (v: number): string => `${v.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} km`
const fmtMin = (v: number): string => `${v.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} phút`
const fmtKmRaw = (v: number): string => v.toLocaleString('vi-VN', { maximumFractionDigits: 2 })

export default function StatsTab() {
  const defaults = useMemo(
    () => ({ from: isoDate(new Date(Date.now() - 30 * 86400000)), to: isoDate(new Date()) }),
    []
  )
  const [fromInput, setFromInput] = useState(defaults.from)
  const [toInput, setToInput] = useState(defaults.to)
  const [applied, setApplied] = useState(defaults)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [data, setData] = useState<TripStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true)
    setError(null)
    try {
      const d = await apiJson<TripStatsResponse>(`/api/admin/stats/trips?from=${from}&to=${to}`)
      setData(d)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải số liệu thống kê.')
    } finally {
      setLoading(false)
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

  const dist = data?.summary.distance
  const dur = data?.summary.duration
  const totalOutliers = (data?.distanceHistogram.outliers ?? 0) + (data?.durationHistogram.outliers ?? 0)

  const kpis: { label: string; value: string; sub: string; icon: typeof Route }[] = [
    {
      label: 'Tổng số chuyến',
      value: data ? data.trips.toLocaleString('vi-VN') : '—',
      sub: 'trong khoảng thời gian đã chọn',
      icon: Route,
    },
    {
      label: 'Quãng đường trung bình',
      value: dist ? fmtKm(dist.avg) : '—',
      sub: dist ? `trung vị ${fmtKm(dist.median)} · sau lọc IQR` : '—',
      icon: Ruler,
    },
    {
      label: 'Thời gian trung bình',
      value: dur ? fmtMin(dur.avg) : '—',
      sub: dur ? `trung vị ${fmtMin(dur.median)} · sau lọc IQR` : '—',
      icon: Timer,
    },
    {
      label: 'P95 khoảng cách',
      value: dist ? fmtKm(dist.p95) : '—',
      sub: dist ? `95% chuyến ≤ giá trị này` : '—',
      icon: Ruler,
    },
    {
      label: 'P95 thời gian',
      value: dur ? fmtMin(dur.p95) : '—',
      sub: dur ? `95% chuyến ≤ giá trị này` : '—',
      icon: Timer,
    },
    {
      label: 'Tổng quãng đường',
      value: dist ? fmtKm(dist.sum) : '—',
      sub: dur ? `tổng ${fmtMin(dur.sum)} di chuyển` : '—',
      icon: Layers,
    },
  ]

  const hasTrips = (data?.trips ?? 0) > 0

  return (
    <div className="flex flex-col gap-4">
      {/* ---- Bộ lọc khoảng thời gian ---- */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 px-4 py-4">
          <div className="grid gap-1.5">
            <Label htmlFor="stats-from">Từ ngày</Label>
            <Input
              id="stats-from"
              type="date"
              value={fromInput}
              max={toInput}
              onChange={(e) => setFromInput(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="stats-to">Đến ngày</Label>
            <Input
              id="stats-to"
              type="date"
              value={toInput}
              min={fromInput}
              onChange={(e) => setToInput(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={applyRange} disabled={loading}>
            Áp dụng
          </Button>
          <Button variant="outline" onClick={resetRange} disabled={loading}>
            Đặt lại
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

      {/* ---- KPI tổng quan ---- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="gap-2 py-4">
            <CardContent className="px-4">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <kpi.icon className="size-3.5 shrink-0 text-emerald-600" />
                {kpi.label}
              </p>
              {loading && !data ? (
                <Skeleton className="mt-2 h-7 w-20" />
              ) : (
                <p className="mt-1 text-xl font-bold tabular-nums">{kpi.value}</p>
              )}
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={kpi.sub}>
                {kpi.sub}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading && !data && (
        <Card>
          <CardContent className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Đang tính toán thống kê…
          </CardContent>
        </Card>
      )}

      {!loading && !error && !hasTrips && (
        <Card>
          <CardContent className="px-4 py-10 text-center text-sm text-muted-foreground">
            Chưa có chuyến đi nào trong khoảng thời gian này — hãy nới rộng bộ lọc hoặc chạy thử bộ
            lập kế hoạch để tạo dữ liệu.
          </CardContent>
        </Card>
      )}

      {hasTrips && data && (
        <>
          {totalOutliers > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5 shrink-0" />
              Có {totalOutliers} giá trị ngoại lai (hàng rào Tukey IQR) đã được gộp vào bin cuối
              của histogram tương ứng — trung bình/trung vị/P95 không bị chúng kéo lệch.
            </p>
          )}

          {/* ---- 2 histogram: khoảng cách & thời gian ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Ruler className="size-4 text-emerald-600" />
                  Phân bố khoảng cách chuyến đi
                </CardTitle>
                <CardDescription>
                  Số chuyến theo khoảng quãng đường (km) — số bin theo quy tắc Sturges.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.distanceHistogram.bins.length === 0 ? (
                  <p className="flex h-[260px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                    Chưa có dữ liệu khoảng cách.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.distanceHistogram.bins} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10 }}
                        interval={0}
                        angle={-30}
                        textAnchor="end"
                        height={52}
                      />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" name="Số chuyến" radius={[4, 4, 0, 0]}>
                        {data.distanceHistogram.bins.map((b, i) => (
                          <Cell key={b.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Nhỏ nhất {fmtKmRaw(data.summary.distance.min)} · lớn nhất {fmtKmRaw(data.summary.distance.max)} km
                  {data.distanceHistogram.outliers > 0 && ` · ${data.distanceHistogram.outliers} ngoại lai ở bin "≥"`}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Timer className="size-4 text-emerald-600" />
                  Phân bố thời gian di chuyển
                </CardTitle>
                <CardDescription>
                  Số chuyến theo thời gian di chuyển (phút) — số bin theo quy tắc Sturges.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.durationHistogram.bins.length === 0 ? (
                  <p className="flex h-[260px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                    Chưa có dữ liệu thời gian.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.durationHistogram.bins} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10 }}
                        interval={0}
                        angle={-30}
                        textAnchor="end"
                        height={52}
                      />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" name="Số chuyến" radius={[4, 4, 0, 0]}>
                        {data.durationHistogram.bins.map((b, i) => (
                          <Cell key={b.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Nhỏ nhất {fmtKmRaw(data.summary.duration.min)} · lớn nhất {fmtKmRaw(data.summary.duration.max)} phút
                  {data.durationHistogram.outliers > 0 && ` · ${data.durationHistogram.outliers} ngoại lai ở bin "≥"`}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* ---- diễn biến theo ngày ---- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="size-4 text-emerald-600" />
                Diễn biến theo ngày
              </CardTitle>
              <CardDescription>
                Số chuyến mỗi ngày (cột) và thời gian di chuyển trung bình (đường) — giờ địa phương
                Hà Nội.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.byDay.length === 0 ? (
                <p className="flex h-[260px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                  Chưa có dữ liệu theo ngày.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={data.byDay} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={18} />
                    <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      yAxisId="left"
                      dataKey="trips"
                      name="Số chuyến"
                      fill={CHART_COLORS[0]}
                      radius={[4, 4, 0, 0]}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="avgDurationMin"
                      name="TB thời gian (phút)"
                      stroke={CHART_COLORS[4]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* ---- giờ khởi hành ---- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="size-4 text-emerald-600" />
                Giờ khởi hành
              </CardTitle>
              <CardDescription>
                Số chuyến theo giờ khởi hành người dùng chọn — nhìn nhanh giờ cao điểm.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.byHour} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tickFormatter={(h: number) => `${h}h`}
                    tick={{ fontSize: 10 }}
                    interval={1}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={(h) => `${h} giờ`} />
                  <Bar dataKey="trips" name="Số chuyến" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* ---- theo phương tiện được đề xuất ---- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="size-4 text-emerald-600" />
                Thống kê theo phương tiện được đề xuất
              </CardTitle>
              <CardDescription>
                Trung bình khoảng cách/thời gian gắn với khuyến nghị hàng đầu của từng chuyến.
              </CardDescription>
              {data.byMode.length > 0 && (
                <CardAction>
                  <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                    {data.byMode.length} phương tiện
                  </Badge>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {data.byMode.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Chưa có dữ liệu.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Phương tiện</TableHead>
                      <TableHead className="text-right">Chuyến</TableHead>
                      <TableHead className="text-right">TB khoảng cách</TableHead>
                      <TableHead className="text-right">TB thời gian</TableHead>
                      <TableHead className="text-right">Tổng quãng đường</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byMode.map((m) => (
                      <TableRow key={m.modeId}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.trips}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtKm(m.avgDistanceKm)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMin(m.avgDurationMin)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtKm(m.totalDistanceKm)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
