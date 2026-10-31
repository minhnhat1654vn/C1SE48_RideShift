'use client'

// Chính sách vùng phát thải thấp — thiết kế lần 3 (Task 81, 26/10/2026).
//
// TRIẾT LÝ: người dùng thông thường không nghĩ theo "vùng LEZ" hay "quy định" —
// họ chỉ có MỘT câu hỏi trong đầu: "XE CỦA TÔI CÓ BỊ CẤM KHÔNG?". Vì vậy toàn bộ
// trang xoay quanh phương tiện của họ:
//   ① "Bạn đi bằng gì?" — chọn 1 phương tiện (chip emoji, mặc định xe máy xăng
//      vì là phương tiện phổ biến nhất Hà Nội, đổi ngay khi bấm chip khác)
//   ② Thẻ TRẢ LỜI lớn, một màu duy nhất theo mức độ: đỏ = bị cấm / cam = có
//      điều kiện / xanh = tự do — đọc trong 2 giây, không cần scan chữ
//   ③ Từng vùng: mức độ của CHÍNH xe đã chọn + thanh giờ 0→24h trực quan +
//      chip ngày tuần + lý do bằng ngôn ngữ thường + "đi được trong vùng"
//      (bấm chip xanh để đổi sang phương tiện được phép — gợi ý chuyển đổi)
//   ④ Chi tiết pháp lý (mô tả, số quyết định, cơ quan, hiệu lực) gập lại —
//      chỉ mở khi cần, không phải bức tường chữ mặc định
//
// Dữ liệu: GET /api/public/bulletin (vùng + quy định, restriction có
// vehicleTypeCode khớp mã phương tiện) + GET /api/modes (danh mục + tên + icon).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { apiUrl } from '@/lib/api'
import { MODE_ICONS } from '@/components/rideshift/results'
import {
  Braces,
  CalendarDays,
  ChevronDown,
  Database,
  FileJson,
  FileText,
  Landmark,
  MapPin,
  MapPinned,
  RefreshCcw,
  ShieldCheck,
  TrafficCone,
  Wind,
} from 'lucide-react'

// ---------------------------------------------------------------- types

type BulletinRestriction = {
  vehicleType?: string | null
  /** mã phương tiện (khớp mode.id) — nguồn thật để đối chiếu */
  vehicleTypeCode?: string | null
  restrictionType: 'banned' | 'conditional' | string
  minEmissionLevel?: number | null
  reason?: string | null
}

type BulletinRule = {
  ruleId: number | string
  ruleName?: string | null
  startTime: string
  endTime: string
  daysOfWeek: number[]
  effectiveFrom?: string | null
  effectiveTo?: string | null
  restrictions: BulletinRestriction[]
}

type BulletinZone = {
  zoneId: string
  name: string
  description?: string | null
  status: 'published' | 'active' | string
  decisionNo?: string | null
  issuedBy?: string | null
  effectiveFrom?: string | null
  effectiveTo?: string | null
  publishedAt?: string | null
  rules: BulletinRule[]
}

type ModeLite = { id: string; name: string; enabled?: boolean }

/** Chip phương tiện khi /api/modes lỗi — danh sách cố định theo DB seed. */
const FALLBACK_MODES: ModeLite[] = [
  { id: 'gasoline_motorbike', name: 'Xe máy xăng' },
  { id: 'electric_motorbike', name: 'Xe máy điện' },
  { id: 'private_car', name: 'Ô tô cá nhân' },
  { id: 'bus', name: 'Xe buýt' },
  { id: 'taxi', name: 'Taxi / Công nghệ' },
  { id: 'bicycle', name: 'Xe đạp' },
  { id: 'walking', name: 'Đi bộ' },
]

// ---------------------------------------------------------------- helpers

/** daysOfWeek: 0/7 = CN, 1..6 = T2..T7. */
const dayLabel = (n: number): string => (n === 0 || n === 7 ? 'CN' : `T${n + 1}`)

function formatDays(days: number[]): string {
  const valid = [...new Set(days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 7))]
  if (valid.length === 0) return 'Mọi ngày'
  if (valid.length >= 7) return 'Hàng ngày'
  return [...valid].sort((a, b) => a - b).map(dayLabel).join(', ')
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('vi-VN')
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  published: {
    label: 'Chờ hiệu lực',
    className:
      'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  },
  active: {
    label: 'Đang hiệu lực',
    className:
      'border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  },
}

const OPEN_DATA_LINKS: { path: string; label: string; icon: React.ReactNode }[] = [
  { path: '/api/open/lez.geojson', label: 'Ranh giới LEZ (GeoJSON)', icon: <MapPin className="h-3.5 w-3.5" aria-hidden /> },
  { path: '/api/open/facilities.geojson', label: 'Điểm giao thông (GeoJSON)', icon: <MapPin className="h-3.5 w-3.5" aria-hidden /> },
  { path: '/api/open/aqi.json', label: 'Chất lượng không khí (JSON)', icon: <Wind className="h-3.5 w-3.5" aria-hidden /> },
  { path: '/api/open/modes.json', label: 'Danh mục phương tiện (JSON)', icon: <FileJson className="h-3.5 w-3.5" aria-hidden /> },
]

/** "HH:MM" → phút kể từ 0h. */
function toMinutes(s: string): number {
  const [h, m] = s.split(':').map((x) => Number.parseInt(x, 10))
  return (h || 0) * 60 + (m || 0)
}

/** Kết quả đối chiếu MỘT phương tiện với MỘT vùng. */
type ZoneCheck = {
  zone: BulletinZone
  /** các hạn chế nhắm đúng phương tiện đã chọn (kèm rule chứa nó) */
  hits: { rule: BulletinRule; restriction: BulletinRestriction }[]
  verdict: 'banned' | 'conditional' | 'free'
}

/** Hạn chế có nhắm vào phương tiện này? (ưu tiên mã, dự phòng tên). */
function hitsVehicle(r: BulletinRestriction, modeId: string, modeName: string): boolean {
  if (r.vehicleTypeCode) return r.vehicleTypeCode === modeId
  return (r.vehicleType ?? '') === modeName
}

// ---------------------------------------------------------------- sub-parts

/** Thanh khung giờ 0h→24h: đoạn tô màu = thời gian bị hạn chế. */
function HourBar({
  start,
  end,
  tone,
}: {
  start: string
  end: string
  tone: 'red' | 'amber'
}) {
  const s = toMinutes(start)
  const e = toMinutes(end)
  const full = s === 0 && e >= 23 * 60 + 59
  const left = full ? 0 : (s / 1440) * 100
  const width = full ? 100 : Math.max(((e - s) / 1440) * 100, 2)
  const fill =
    tone === 'red'
      ? 'bg-red-600 dark:bg-red-500'
      : 'bg-amber-500 dark:bg-amber-400'
  return (
    <div
      role="img"
      aria-label={`Khung giờ hạn chế từ ${start} đến ${end}`}
      className="w-full"
    >
      <div className="relative h-3 w-full rounded-full bg-muted">
        <div
          className={`absolute inset-y-0 rounded-full ${fill}`}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-medium tabular-nums text-muted-foreground">
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>24h</span>
      </div>
    </div>
  )
}

/** 7 chip T2→CN, tô những ngày áp dụng. */
function DayChips({ days }: { days: number[] }) {
  const active = new Set(days.map((d) => (d === 7 ? 0 : d)))
  const all = active.size >= 7
  const order = [2, 3, 4, 5, 6, 0, 1] // T2…T7, CN, T2 (chỉ hiển thị 7 chip T2..CN)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {order.slice(0, 7).map((d) => {
        const on = active.has(d)
        return (
          <span
            key={d}
            className={`inline-flex min-w-8 items-center justify-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${
              on
                ? 'border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
                : 'border-border bg-muted/50 text-muted-foreground/60'
            }`}
          >
            {dayLabel(d)}
          </span>
        )
      })}
      {all && (
        <span className="ml-1 text-xs font-medium text-muted-foreground">
          · áp dụng hằng ngày
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- component

export default function PolicyBulletinView({
  onViewOnMap,
}: {
  /** Nhảy sang tab bản đồ + fitBounds ranh giới vùng (theo zoneId). */
  onViewOnMap?: (zoneId: string) => void
}) {
  const [zones, setZones] = useState<BulletinZone[]>([])
  const [modes, setModes] = useState<ModeLite[]>(FALLBACK_MODES)
  const [selectedMode, setSelectedMode] = useState('gasoline_motorbike')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dataOpen, setDataOpen] = useState(false)
  const [detailZone, setDetailZone] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [bulletinRes, modesRes] = await Promise.all([
        fetch(apiUrl('/api/public/bulletin'), { cache: 'no-store' }),
        fetch(apiUrl('/api/modes'), { cache: 'no-store' }).catch(() => null),
      ])
      if (!bulletinRes.ok) throw new Error('bulletin')
      const data = (await bulletinRes.json()) as { bulletin?: BulletinZone[] }
      setZones(Array.isArray(data.bulletin) ? data.bulletin : [])
      if (modesRes && modesRes.ok) {
        const m = (await modesRes.json()) as { modes?: ModeLite[] }
        const list = (m.modes ?? []).filter((x) => x.enabled !== false)
        if (list.length > 0) setModes(list)
      }
    } catch {
      setError('Không tải được thông tin chính sách. Vui lòng thử lại sau.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const modeName = (id: string) => modes.find((m) => m.id === id)?.name ?? id

  /** Đối chiếu phương tiện đã chọn với từng vùng. */
  const checks = useMemo<ZoneCheck[]>(() => {
    return zones.map((zone) => {
      const hits: ZoneCheck['hits'] = []
      for (const rule of zone.rules) {
        for (const r of rule.restrictions) {
          if (hitsVehicle(r, selectedMode, modeName(selectedMode))) hits.push({ rule, restriction: r })
        }
      }
      const verdict: ZoneCheck['verdict'] = hits.some((h) => h.restriction.restrictionType === 'banned')
        ? 'banned'
        : hits.length > 0
          ? 'conditional'
          : 'free'
      return { zone, hits, verdict }
    })
  }, [zones, selectedMode, modes])

  /** Thẻ trả lời mức tổng thể. */
  const answer = useMemo(() => {
    const banned = checks.filter((c) => c.verdict === 'banned' && c.zone.status === 'active')
    const conditional = checks.filter((c) => c.verdict === 'conditional' && c.zone.status === 'active')
    const upcoming = checks.filter((c) => c.verdict !== 'free' && c.zone.status !== 'active')
    if (banned.length > 0) return { tone: 'red' as const, banned, conditional, upcoming }
    if (conditional.length > 0) return { tone: 'amber' as const, banned, conditional, upcoming }
    if (upcoming.length > 0) return { tone: 'amber' as const, banned, conditional, upcoming }
    return { tone: 'green' as const, banned, conditional, upcoming }
  }, [checks])

  /** Mã phương tiện bị hạn chế trong 1 vùng (để liệt kê "đi được"). */
  const restrictedCodes = useCallback((zone: BulletinZone): Set<string> => {
    const s = new Set<string>()
    for (const rule of zone.rules)
      for (const r of rule.restrictions)
        if (r.vehicleTypeCode) s.add(r.vehicleTypeCode)
    return s
  }, [])

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 py-2" aria-busy="true">
        <Skeleton className="h-9 w-2/3 rounded-lg" />
        <Skeleton className="h-14 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-3xl py-2">
        <Alert variant="destructive">
          <AlertTitle>Không tải được bảng tin</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{error}</span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void load()}>
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden /> Thử lại
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const activeCount = zones.filter((z) => z.status === 'active').length

  return (
    <div className="mx-auto w-full max-w-3xl py-2">
      {/* ---------------- header ---------------- */}
      <header className="mb-4 flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <TrafficCone className="h-6 w-6 text-primary" aria-hidden />
            Chính sách vùng phát thải thấp
          </h2>
          {zones.length > 0 && (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {zones.length} vùng · {activeCount} đang hiệu lực
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Chọn phương tiện bạn hay đi — hệ thống cho biết có bị hạn chế khi vào các vùng
          kiểm soát ô nhiễm của thành phố hay không.
        </p>
      </header>

      {/* ---------------- ① chọn phương tiện ---------------- */}
      <section aria-label="Chọn phương tiện của bạn" className="mb-4">
        <p className="mb-2 text-sm font-semibold">Bạn đi bằng gì?</p>
        <div role="radiogroup" aria-label="Phương tiện của bạn" className="flex flex-wrap gap-2">
          {modes.map((m) => {
            const selected = m.id === selectedMode
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSelectedMode(m.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
                  selected
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border bg-background hover:bg-muted'
                }`}
              >
                <span aria-hidden className="text-base leading-none">
                  {MODE_ICONS[m.id] ?? '🚗'}
                </span>
                {m.name}
              </button>
            )
          })}
        </div>
      </section>

      {/* ---------------- ② thẻ trả lời ---------------- */}
      {zones.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Hiện chưa có chính sách vùng phát thải thấp nào được công bố.
        </p>
      ) : (
        <AnswerCard answer={answer} modeName={modeName(selectedMode)} />
      )}

      {/* ---------------- ③ từng vùng ---------------- */}
      {checks.length > 0 && (
        <div className="mt-4 space-y-4">
          {checks.map(({ zone, hits, verdict }) => {
            const status = STATUS_META[zone.status] ?? {
              label: zone.status,
              className: 'border-border bg-muted text-muted-foreground',
            }
            const detailOpen = detailZone === zone.zoneId
            const banned = hits.some((h) => h.restriction.restrictionType === 'banned')
            const tone = verdict === 'free' ? 'green' : banned ? 'red' : 'amber'
            const allowed = modes.filter((m) => !restrictedCodes(zone).has(m.id))
            return (
              <Card key={zone.zoneId} className="rounded-2xl">
                <CardHeader className="gap-2.5 pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="text-lg font-bold leading-tight">{zone.name}</CardTitle>
                    <CardAction className="flex items-center gap-2">
                      <Badge variant="outline" className={status.className}>
                        {zone.status === 'active' ? (
                          <ShieldCheck className="h-3 w-3" aria-hidden />
                        ) : (
                          <CalendarDays className="h-3 w-3" aria-hidden />
                        )}
                        {status.label}
                        {zone.status !== 'active' && zone.effectiveFrom
                          ? ` · từ ${formatDate(zone.effectiveFrom)}`
                          : ''}
                      </Badge>
                      {onViewOnMap && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => onViewOnMap(zone.zoneId)}
                        >
                          <MapPinned className="h-3.5 w-3.5" aria-hidden /> Bản đồ
                        </Button>
                      )}
                    </CardAction>
                  </div>

                  {/* mức độ của xe đã chọn trong vùng này */}
                  <div
                    className={`rounded-xl border p-3 ${
                      tone === 'red'
                        ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
                        : tone === 'amber'
                          ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
                          : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40'
                    }`}
                    role="status"
                  >
                    {verdict === 'free' ? (
                      <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                        ✅ {modeName(selectedMode)}: đi lại tự do trong vùng này
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {hits.map(({ rule, restriction }, i) => (
                          <div key={i} className="space-y-2">
                            <p
                              className={`text-sm font-bold ${
                                restriction.restrictionType === 'banned'
                                  ? 'text-red-700 dark:text-red-300'
                                  : 'text-amber-800 dark:text-amber-200'
                              }`}
                            >
                              {restriction.restrictionType === 'banned'
                                ? `⛔ ${modeName(selectedMode)}: BỊ CẤM`
                                : `⚠️ ${modeName(selectedMode)}: được vào CÓ ĐIỀU KIỆN${
                                    restriction.minEmissionLevel && restriction.minEmissionLevel > 0
                                      ? ` (Euro ≥ ${restriction.minEmissionLevel})`
                                      : ''
                                  }`}
                            </p>
                            <HourBar
                              start={rule.startTime}
                              end={rule.endTime}
                              tone={restriction.restrictionType === 'banned' ? 'red' : 'amber'}
                            />
                            <DayChips days={rule.daysOfWeek} />
                            {restriction.reason && (
                              <p className="text-xs leading-relaxed text-muted-foreground">
                                {restriction.reason}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* đi được trong vùng — gợi ý chuyển đổi, bấm để đổi xe */}
                  {verdict !== 'free' && allowed.length > 0 && (
                    <section aria-label="Phương tiện được phép trong vùng">
                      <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Trong vùng này bạn có thể đi
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {allowed.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setSelectedMode(m.id)}
                            title={`Xem thông tin cho ${m.name}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[13px] font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
                          >
                            <span aria-hidden>{MODE_ICONS[m.id] ?? '🚗'}</span>
                            {m.name}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* chi tiết pháp lý — gập */}
                  <Collapsible open={detailOpen} onOpenChange={(o) => setDetailZone(o ? zone.zoneId : null)}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-primary">
                        {detailOpen ? 'Thu gọn chi tiết' : 'Chi tiết vùng & văn bản'}
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${detailOpen ? 'rotate-180' : ''}`}
                          aria-hidden
                        />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <div className="rounded-xl border bg-muted/40 p-2.5">
                          <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            <CalendarDays className="h-3 w-3" aria-hidden /> Hiệu lực
                          </dt>
                          <dd className="mt-0.5 text-[13px] font-semibold leading-snug">
                            {formatDate(zone.effectiveFrom)}
                            {zone.effectiveTo ? ` → ${formatDate(zone.effectiveTo)}` : ' → nay'}
                          </dd>
                        </div>
                        <div className="rounded-xl border bg-muted/40 p-2.5">
                          <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            <FileText className="h-3 w-3" aria-hidden /> Quyết định
                          </dt>
                          <dd className="mt-0.5 text-[13px] font-semibold leading-snug">
                            {zone.decisionNo ?? '—'}
                          </dd>
                        </div>
                        <div className="col-span-2 rounded-xl border bg-muted/40 p-2.5 sm:col-span-1">
                          <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            <Landmark className="h-3 w-3" aria-hidden /> Cơ quan ban hành
                          </dt>
                          <dd className="mt-0.5 text-[13px] font-semibold leading-snug">
                            {zone.issuedBy ?? '—'}
                          </dd>
                        </div>
                      </dl>
                      {zone.description && (
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          {zone.description}
                        </p>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ---------------- dữ liệu mở (gập) ---------------- */}
      <Collapsible open={dataOpen} onOpenChange={setDataOpen} className="mt-4">
        <Card className="rounded-2xl border-dashed">
          <CardHeader className="pb-2">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="h-auto w-full justify-between gap-2 px-2 py-1.5 text-base font-semibold"
                aria-expanded={dataOpen}
              >
                <span className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" aria-hidden /> Dữ liệu mở cho nhà phát
                  triển
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                    dataOpen ? 'rotate-180' : ''
                  }`}
                  aria-hidden
                />
              </Button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <p className="mb-3 text-xs text-muted-foreground">
                API công khai, miễn phí, không cần đăng nhập — bấm để mở trực tiếp.
              </p>
              <div className="flex flex-wrap gap-2">
                {OPEN_DATA_LINKS.map((link) => (
                  <Button
                    key={link.path}
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => window.open(apiUrl(link.path), '_blank', 'noopener,noreferrer')}
                  >
                    {link.icon}
                    {link.label}
                    <Braces className="h-3 w-3 opacity-50" aria-hidden />
                  </Button>
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  )
}

// ---------------------------------------------------------------- answer card

/** Thẻ trả lời lớn — 1 màu, 1 câu, đọc trong 2 giây. */
function AnswerCard({
  answer,
  modeName,
}: {
  answer: {
    tone: 'red' | 'amber' | 'green'
    banned: ZoneCheck[]
    conditional: ZoneCheck[]
    upcoming: ZoneCheck[]
  }
  modeName: string
}) {
  const { tone, banned, conditional, upcoming } = answer
  const affected = [...banned, ...conditional]

  const shell =
    tone === 'red'
      ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/50'
      : tone === 'amber'
        ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50'
        : 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/50'

  const title =
    tone === 'red'
      ? `⛔ ${modeName}: BỊ CẤM`
      : tone === 'amber'
        ? `⚠️ ${modeName}: ${conditional.length > 0 ? 'ĐƯỢC VÀO CÓ ĐIỀU KIỆN' : 'SẮP BỊ HẠN CHẾ'}`
        : `✅ ${modeName}: KHÔNG BỊ HẠN CHẾ`

  const sub =
    tone === 'red'
      ? `trong ${banned.length} vùng đang hiệu lực${
          banned.length === 1 ? ` (${banned[0].zone.name})` : ''
        }`
      : tone === 'amber'
        ? conditional.length > 0
          ? `trong ${conditional.length} vùng${
              conditional.length === 1 ? ` (${conditional[0].zone.name})` : ''
            } — xem điều kiện bên dưới`
          : `vùng sắp áp dụng từ ${formatDate(upcoming[0]?.zone.effectiveFrom)} — theo dõi để chuẩn bị`
        : 'Đi lại tự do trong mọi vùng hiện có của thành phố'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-2xl border p-4 sm:p-5 ${shell}`}
    >
      <p
        className={`text-lg font-extrabold leading-snug sm:text-xl ${
          tone === 'red'
            ? 'text-red-700 dark:text-red-300'
            : tone === 'amber'
              ? 'text-amber-800 dark:text-amber-200'
              : 'text-emerald-700 dark:text-emerald-300'
        }`}
      >
        {title}
      </p>
      <p
        className={`mt-0.5 text-sm font-medium ${
          tone === 'red'
            ? 'text-red-700/80 dark:text-red-200/80'
            : tone === 'amber'
              ? 'text-amber-800/80 dark:text-amber-200/80'
              : 'text-emerald-700/80 dark:text-emerald-300/80'
        }`}
      >
        {sub}
      </p>
      {affected.length > 1 && (
        <ul className="mt-2 space-y-0.5 text-sm">
          {affected.map((c) => (
            <li key={c.zone.zoneId} className="font-medium">
              · {c.zone.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
