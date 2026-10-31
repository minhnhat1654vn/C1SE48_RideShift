'use client'

// CN-40 — Tab "Tác động LEZ" trong Admin (RideShift, C1SE.48).
//
// Gọi GET /api/admin/lez-impact?from&to (require_admin), hiển thị:
//   - 4 KPI card: tổng chuyến / chuyến qua LEZ (+%) / quãng đường bị ảnh hưởng /
//     % tuân thủ (từ trip_lez_analyses)
//   - So sánh chuyến trong/ngoài LEZ (TB quãng đường, TB thời gian)
//   - Biểu đồ tác động theo phương tiện (stacked bar)
//   - Diễn biến theo ngày (bar tổng + bar chuyến qua LEZ)
//   - Top quận xuất phát có chuyến qua LEZ (bar)
//   - Theo mục đích chuyến đi (pie)
//   - Thẻ chi tiết tuân thủ LEZ: route_lez_status, compliance, % chạm TB, lý do
//
// Tab tự chứa (date filter riêng), đọc-đọc, không đụng logic các tab khác.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Leaf,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { apiFetch } from '@/lib/api'
import { TRIP_PURPOSES } from '@/lib/types'
import type { LezImpactResponse } from './types'

const CHART_COLORS = ['#16a34a', '#22c55e', '#0d9488', '#84cc16', '#eab308', '#f97316', '#dc2626']
const PURPOSE_LABELS: Record<string, string> = Object.fromEntries(
  TRIP_PURPOSES.map((p) => [p.value, p.label]),
)
const COMPLIANCE_TONE: Record<string, { ok: boolean }> = {
  compliant: { ok: true },
  not_permitted: { ok: false },
  restricted: { ok: false },
}

/** Local YYYY-MM-DD string (tránh lệch múi UTC của toISOString). */
function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const fmtNum = (v: number): string => v.toLocaleString('vi-VN')
const fmtKm = (v: number): string => `${v.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km`
const fmtMin = (v: number): string => `${v.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} phút`
const fmtPct = (v: number): string => `${v.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`

function KpiCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className="text-emerald-600">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

/** So sánh nhỏ: chuyến qua LEZ vs ngoài LEZ (mũi tên chênh lệch %). */
function CompareChip({
  label,
  affected,
  normal,
  fmt,
}: {
  label: string
  affected: number
  normal: number
  fmt: (v: number) => string
}) {
  const diff = normal > 0 ? Math.round(((affected - normal) / normal) * 100) : 0
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-2 text-sm">
        <span className="font-semibold tabular-nums text-emerald-700">{fmt(affected)}</span>
        <span className="text-muted-foreground">vs</span>
        <span className="tabular-nums">{fmt(normal)}</span>
        <span className={`ml-auto text-xs tabular-nums ${diff > 0 ? 'text-orange-600' : diff < 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
          {diff > 0 ? `+${diff}%` : `${diff}%`}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">qua LEZ so với ngoài LEZ</p>
    </div>
  )
}

export default function LezImpactTab() {
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 29 * 86400_000)))
  const [to, setTo] = useState(() => isoDate(new Date()))
  const [applied, setApplied] = useState<{ from: string; to: string }>(() => ({
    from: isoDate(new Date(Date.now() - 29 * 86400_000)),
    to: isoDate(new Date()),
  }))
  const [data, setData] = useState<LezImpactResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (range: { from: string; to: string }) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/admin/lez-impact?from=${range.from}&to=${range.to}`)
      if (!res.ok) {
        let msg = `Lỗi ${res.status}`
        try {
          const j = await res.json()
          if (typeof j?.detail === 'string') msg = j.detail
        } catch { /* giữ msg mặc định */ }
        throw new Error(msg)
      }
      setData((await res.json()) as LezImpactResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(applied)
  }, [applied, load])

  const applyFilter = () => {
    if (from > to) {
      setError('Ngày bắt đầu phải trước ngày kết thúc.')
      return
    }
    setApplied({ from, to })
  }
  const resetFilter = () => {
    const f = isoDate(new Date(Date.now() - 29 * 86400_000))
    const t = isoDate(new Date())
    setFrom(f)
    setTo(t)
    setApplied({ from: f, to: t })
  }

  // ---- dữ liệu biểu đồ (useMemo tránh tính lại mỗi render)
  const modeChartData = useMemo(
    () =>
      (data?.byMode ?? []).map((m) => ({
        name: m.name,
        'Qua LEZ': m.affected,
        'Ngoài LEZ': m.total - m.affected,
      })),
    [data],
  )
  const dayChartData = useMemo(
    () =>
      (data?.byDay ?? []).map((d) => ({
        date: d.date.slice(5), // MM-DD cho gọn
        'Tổng chuyến': d.total,
        'Qua LEZ': d.affected,
      })),
    [data],
  )
  const districtChartData = useMemo(
    () => (data?.byDistrict ?? []).slice(0, 8).map((d) => ({ name: d.district, 'Qua LEZ': d.affected })),
    [data],
  )
  const purposeChartData = useMemo(
    () =>
      (data?.byPurpose ?? [])
        .filter((p) => p.affected > 0)
        .map((p) => ({ name: PURPOSE_LABELS[p.purpose] ?? p.purpose, value: p.affected })),
    [data],
  )

  const k = data?.kpis
  const detail = data?.lezDetail

  return (
    <div className="space-y-4">
      {/* ---- bộ lọc thời gian ---- */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Từ ngày</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Đến ngày</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={applyFilter}
          disabled={loading}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Áp dụng
        </button>
        <button
          onClick={resetFilter}
          disabled={loading}
          className="rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          Đặt lại
        </button>
        <button
          onClick={() => void load(applied)}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          title="Tải lại số liệu"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Làm mới
        </button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : null}

      {data && k ? (
        <>
          {/* ---- KPI ---- */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Tổng số chuyến"
              value={fmtNum(k.totalTrips)}
              sub={data ? `${data.from.slice(0, 10)} → ${data.to.slice(0, 10)}` : undefined}
              icon={<Leaf className="h-4 w-4" />}
            />
            <KpiCard
              label="Chuyến qua LEZ"
              value={fmtNum(k.lezAffectedTrips)}
              sub={`${fmtPct(k.lezAffectedPct)} tổng số chuyến`}
              icon={<Leaf className="h-4 w-4" />}
            />
            <KpiCard
              label="Quãng đường qua LEZ"
              value={fmtKm(k.affectedDistanceKm)}
              sub={`trên tổng ${fmtKm(k.totalDistanceKm)}`}
              icon={<Leaf className="h-4 w-4" />}
            />
            <KpiCard
              label="Tuân thủ LEZ"
              value={fmtPct(k.compliantPct)}
              sub={detail && detail.analyzedTrips > 0 ? `trên ${fmtNum(detail.analyzedTrips)} tuyến phân tích` : 'chưa có tuyến phân tích chi tiết'}
              icon={<ShieldCheck className="h-4 w-4" />}
            />
          </div>

          {/* ---- so sánh trong/ngoài LEZ ---- */}
          <div className="grid gap-4 sm:grid-cols-2">
            <CompareChip label="TB quãng đường chuyến" affected={k.avgDistanceAffectedKm} normal={k.avgDistanceNormalKm} fmt={fmtKm} />
            <CompareChip label="TB thời gian chuyến" affected={k.avgDurationAffectedMin} normal={k.avgDurationNormalMin} fmt={fmtMin} />
          </div>

          {/* ---- biểu đồ theo phương tiện ---- */}
          <div className="rounded-xl border bg-card p-4">
            <h3 className="mb-1 text-sm font-semibold">Tác động theo phương tiện</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Số chuyến qua LEZ so với ngoài LEZ, theo loại phương tiện người dùng định đi
            </p>
            {modeChartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Chưa có dữ liệu.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={modeChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Qua LEZ" stackId="a" fill="#16a34a" radius={[0, 0, 4, 4]} />
                    <Bar dataKey="Ngoài LEZ" stackId="a" fill="#d1d5db" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* ---- diễn biến theo ngày ---- */}
          <div className="rounded-xl border bg-card p-4">
            <h3 className="mb-1 text-sm font-semibold">Diễn biến theo ngày</h3>
            <p className="mb-3 text-xs text-muted-foreground">Số chuyến mỗi ngày (giờ Hà Nội) và số chuyến đi qua vùng LEZ</p>
            {dayChartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Chưa có dữ liệu.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dayChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Tổng chuyến" fill="#0d9488" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="Qua LEZ" stroke="#dc2626" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ---- theo quận xuất phát ---- */}
            <div className="rounded-xl border bg-card p-4">
              <h3 className="mb-1 text-sm font-semibold">Chuyến qua LEZ theo quận xuất phát</h3>
              <p className="mb-3 text-xs text-muted-foreground">Top quận có nhiều chuyến bị ảnh hưởng nhất</p>
              {districtChartData.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Chưa có dữ liệu.</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={districtChartData} layout="vertical" margin={{ left: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                      <Tooltip />
                      <Bar dataKey="Qua LEZ" radius={[0, 4, 4, 0]}>
                        {districtChartData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* ---- theo mục đích chuyến đi ---- */}
            <div className="rounded-xl border bg-card p-4">
              <h3 className="mb-1 text-sm font-semibold">Chuyến qua LEZ theo mục đích</h3>
              <p className="mb-3 text-xs text-muted-foreground">Tỷ trọng các mục đích chuyến đi bị ảnh hưởng</p>
              {purposeChartData.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Chưa có dữ liệu.</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={purposeChartData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                        {purposeChartData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* ---- chi tiết tuân thủ (trip_lez_analyses) ---- */}
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Chi tiết tuân thủ LEZ theo tuyến</h3>
                <p className="text-xs text-muted-foreground">
                  Từ phân tích lộ trình từng chuyến (trip_lez_analyses)
                </p>
              </div>
              {detail && detail.analyzedTrips > 0 ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  TB chạm {fmtPct(detail.avgIntersectionPct)} · TB dài {fmtKm(detail.avgIntersectionLengthM / 1000)}
                </span>
              ) : null}
            </div>
            {!detail || detail.analyzedTrips === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Chưa có phân tích chi tiết nào trong khoảng thời gian này — dữ liệu sẽ tự đầy lên
                khi người dùng lập kế hoạch đi qua vùng LEZ.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Vị trí tuyến so với vùng LEZ</p>
                    <div className="flex flex-wrap gap-2">
                      {detail.statusDistribution.map((s) => (
                        <span key={s.status} className="rounded-full border bg-muted/40 px-3 py-1 text-xs">
                          {s.label}: <b className="tabular-nums">{fmtNum(s.count)}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Mức độ tuân thủ quy định</p>
                    <div className="flex flex-wrap gap-2">
                      {detail.compliance.map((c) => {
                        const ok = COMPLIANCE_TONE[c.status]?.ok
                        return (
                          <span
                            key={c.status}
                            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs ${
                              ok === true
                                ? 'bg-emerald-100 text-emerald-800'
                                : ok === false
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {ok === true ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                            {c.label}: <b className="tabular-nums">{fmtNum(c.count)}</b>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </div>
                {detail.topReasons.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Lý do phổ biến khi không tuân thủ</p>
                    <ul className="space-y-1 text-sm">
                      {detail.topReasons.map((r) => (
                        <li key={r.reason} className="flex items-start gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                          <span>{r.reason}</span>
                          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">×{fmtNum(r.count)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* ---- bảng theo phương tiện ---- */}
          <div className="overflow-hidden rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Phương tiện</th>
                  <th className="px-4 py-3 text-right font-medium">Tổng chuyến</th>
                  <th className="px-4 py-3 text-right font-medium">Qua LEZ</th>
                  <th className="px-4 py-3 text-right font-medium">Tỷ lệ</th>
                  <th className="px-4 py-3 text-right font-medium">Quãng đường qua LEZ</th>
                </tr>
              </thead>
              <tbody>
                {data.byMode.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Chưa có dữ liệu.</td>
                  </tr>
                ) : (
                  data.byMode.map((m) => (
                    <tr key={m.code} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{m.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtNum(m.total)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{fmtNum(m.affected)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtPct(m.affectedPct)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtKm(m.affectedDistanceKm)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  )
}
