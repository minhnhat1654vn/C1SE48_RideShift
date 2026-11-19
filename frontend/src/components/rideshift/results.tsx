'use client'

// Analysis result panels: route summary, LEZ spatial results, vehicle
// compliance, air quality, ranked MCDM recommendations, comparison table
// and impact estimator (US-02..US-12, US-17, US-19, US-20).

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ChevronDown, ChevronRight, TriangleAlert, CheckCircle2, Ban, CircleHelp, CloudSun, Check, Clock3, Wallet, Leaf, Award } from 'lucide-react'
import { motion } from 'framer-motion'
import type { AnalyzeResponse, ComplianceResult, Recommendation } from '@/lib/types'

export const MODE_ICONS: Record<string, string> = {
  gasoline_motorbike: '🏍️',
  electric_motorbike: '⚡',
  private_car: '🚗',
  bus: '🚌',
  taxi: '🚕',
  bicycle: '🚲',
  walking: '🚶',
}

/** Huy chương xếp hạng: #1 vàng đồng, #2 bạc, #3 đồng — phần còn lại trung tính. */
function RankMedal({ rank }: { rank: number }) {
  const medal =
    rank === 1
      ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-md shadow-amber-500/30'
      : rank === 2
        ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-white shadow-md shadow-slate-400/30'
        : rank === 3
          ? 'bg-gradient-to-br from-orange-400 to-orange-600 text-white shadow-md shadow-orange-500/30'
          : 'bg-muted text-muted-foreground'
  return (
    <span
      aria-hidden
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold tabular-nums ${medal}`}
    >
      {rank}
    </span>
  )
}

function fmtVnd(v: number) {
  return `${Math.round(v).toLocaleString('vi-VN')} VND`
}

function fmtMin(m: number) {
  if (m < 60) return `${Math.round(m)} phút`
  return `${Math.floor(m / 60)} giờ ${Math.round(m % 60)} phút`
}

function fmtKm(km: number) {
  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`
}

// Display-only translation of DB day tokens ("Mon,Tue") — data stays English
// because backend rule matching depends on the raw tokens.
const DAY_VI: Record<string, string> = {
  Mon: 'Thứ 2',
  Tue: 'Thứ 3',
  Wed: 'Thứ 4',
  Thu: 'Thứ 5',
  Fri: 'Thứ 6',
  Sat: 'Thứ 7',
  Sun: 'Chủ nhật',
}

function fmtDaysVi(days: string): string {
  return days
    .split(',')
    .map((d) => DAY_VI[d.trim()] ?? d.trim())
    .join(', ')
}

// ------------------------------------------------------------ LEZ badges

export function LezBadge({ overall }: { overall: AnalyzeResponse['lez']['overall'] }) {
  if (overall === 'none')
    return <Badge variant="secondary">Không có vùng LEZ</Badge>
  if (overall === 'outside')
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200">
        Ngoài vùng LEZ
      </Badge>
    )
  if (overall === 'partial')
    return (
      <Badge className="bg-amber-100 text-amber-800 border border-amber-200">
        Giao một phần với LEZ
      </Badge>
    )
  return (
    <Badge className="bg-red-100 text-red-800 border border-red-200">Trong vùng LEZ</Badge>
  )
}

// Per-zone spatial status badge (US-05): one row per active zone
function ZoneStatusBadge({ status }: { status: 'outside' | 'partial' | 'within' }) {
  if (status === 'within')
    return <Badge className="border border-red-200 bg-red-100 text-[10px] text-red-800">Hoàn toàn bên trong</Badge>
  if (status === 'partial')
    return <Badge className="border border-amber-200 bg-amber-100 text-[10px] text-amber-800">Giao một phần</Badge>
  return <Badge variant="secondary" className="text-[10px]">Ngoài vùng</Badge>
}

function ComplianceBadge({ status }: { status: ComplianceResult['status'] }) {
  if (status === 'compliant')
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3 mr-1" /> Đạt yêu cầu
      </Badge>
    )
  if (status === 'conditionally_restricted')
    return (
      <Badge className="bg-amber-100 text-amber-800 border border-amber-200">
        <CircleHelp className="w-3 h-3 mr-1" /> Hạn chế có điều kiện
      </Badge>
    )
  return (
    <Badge className="bg-red-100 text-red-800 border border-red-200">
      <Ban className="w-3 h-3 mr-1" /> Không được phép
    </Badge>
  )
}

// ------------------------------------------------------------ Trip overview

export function TripOverviewCard({ result }: { result: AnalyzeResponse }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span aria-hidden>🧭</span> Tổng quan chuyến đi
        </CardTitle>
        <CardDescription>
          {result.origin.name} → {result.destination.name}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg bg-secondary/70 p-3">
            <div className="text-xs text-muted-foreground">Quãng đường</div>
            <div className="text-lg font-semibold">{fmtKm(result.route.distanceKm)}</div>
          </div>
          <div className="rounded-lg bg-secondary/70 p-3">
            <div className="text-xs text-muted-foreground">Thời gian di chuyển (ước tính)</div>
            <div className="text-lg font-semibold">{fmtMin(result.route.durationMin)}</div>
          </div>
          <div className="rounded-lg bg-secondary/70 p-3">
            <div className="text-xs text-muted-foreground">Trạng thái LEZ</div>
            <div className="mt-0.5">
              <LezBadge overall={result.lez.overall} />
            </div>
          </div>
          <div className="rounded-lg bg-secondary/70 p-3">
            <div className="text-xs text-muted-foreground">Nguồn định tuyến</div>
            <div className="text-sm font-medium">
              {result.route.source === 'osrm' ? 'Mạng đường bộ OSRM' : 'Ước tính (không có router)'}
            </div>
          </div>
        </div>
        {result.route.source !== 'osrm' && (
          <Alert className="border-amber-300 bg-amber-50 text-amber-900">
            <TriangleAlert className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-sm">Tuyến hiển thị là ước lượng</AlertTitle>
            <AlertDescription className="text-xs">
              Dịch vụ định tuyến theo mạng đường bộ tạm thời không truy cập được, nên đường trên bản
              đồ là đường ước lượng — khoảng cách đường thật có thể khác. Vui lòng chạy lại phân tích
              sau để có tuyến bám đúng đường đi.
            </AlertDescription>
          </Alert>
        )}
        {result.lez.zones.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Kiểm tra vùng LEZ</div>
            {/* US-05: one compact row per active zone, including zones the route
                only passes outside of — status badge + share of route inside */}
            <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
              {result.lez.zones.map((z) => (
                <div key={z.zoneId} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium" title={z.name}>
                    {z.name}
                  </span>
                  <ZoneStatusBadge status={z.status} />
                  <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                    {Math.round(z.insideRatio * 100)}% trong vùng
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------ Compliance (US-06/07/17)

export function ComplianceCard({
  compliance,
  vehicleName,
  departureInfo,
}: {
  compliance: ComplianceResult
  vehicleName: string
  departureInfo: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span aria-hidden>🛡️</span> Kiểm tra tuân thủ phương tiện
        </CardTitle>
        <CardDescription>
          {vehicleName} · giờ xuất phát {departureInfo}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <ComplianceBadge status={compliance.status} />
          <span className="text-sm text-muted-foreground">{vehicleName}</span>
        </div>
        {compliance.status !== 'compliant' && compliance.reason && (
          <Alert
            className={
              compliance.status === 'not_permitted'
                ? 'border-red-300 bg-red-50 text-red-900'
                : 'border-amber-300 bg-amber-50 text-amber-900'
            }
          >
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>
              {compliance.status === 'not_permitted'
                ? 'Cảnh báo: phương tiện không được phép đi trên tuyến này'
                : 'Cảnh báo: có thể bị áp dụng hạn chế'}
            </AlertTitle>
            <AlertDescription>{compliance.reason}</AlertDescription>
          </Alert>
        )}
        {compliance.rules.length > 0 && (
          <div>
            <div className="text-sm font-medium mb-1.5">Quy định LEZ áp dụng (US-17)</div>
            <ul className="space-y-1.5">
              {compliance.rules.map((r, i) => (
                <li
                  key={`${r.zoneId}-${i}`}
                  className="text-xs rounded-md border bg-muted/40 px-2.5 py-1.5"
                >
                  <span className="font-semibold">{r.zoneName}</span> ·{' '}
                  {r.restrictionType === 'banned' ? 'Không được phép' : 'Có điều kiện'} ·{' '}
                  {r.startTime}–{r.endTime} · {fmtDaysVi(r.days)}
                  {r.condition && <div className="text-muted-foreground mt-0.5">{r.condition}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {compliance.rules.length === 0 && compliance.status === 'compliant' && (
          <p className="text-sm text-muted-foreground">
            {compliance.reason ?? 'Không có quy định LEZ nào áp dụng cho chuyến đi này.'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------ Air quality (US-08/19)


/** "2026-10-22T11:00:00+07:00" | "21-10-2026" → chuỗi hiển thị an toàn (không Invalid Date) */
function formatMeasuredAt(iso: string): string {
  const d = new Date(iso)
  if (!Number.isNaN(d.getTime())) return d.toLocaleString('vi-VN')
  // MTD chỉ trả "dd-MM-yyyy"
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(iso)
  if (m) return `ngày ${Number(m[1])}/${Number(m[2])}/${m[3]}`
  return iso
}

export function AirQualityCard({ air }: { air: AnalyzeResponse['airQuality'] }) {
  const tone =
    air.aqi == null
      ? 'text-muted-foreground'
      : air.aqi <= 50
        ? 'text-emerald-600'
        : air.aqi <= 100
          ? 'text-amber-500'
          : air.aqi <= 150
            ? 'text-orange-600'
            : 'text-red-600'
  const fallbackLabel =
    air.aqi == null
      ? 'Không xác định'
      : air.aqi <= 50
        ? 'Tốt'
        : air.aqi <= 100
          ? 'Trung bình'
          : air.aqi <= 150
            ? 'Không tốt (nhóm nhạy cảm)'
            : air.aqi <= 200
              ? 'Không tốt cho sức khỏe'
              : 'Nguy hại'
  // Task 63: chuỗi nguồn mới — trạm thật → nội suy → mô hình → cache → estimate
  const sourceLabel =
    air.source === 'station'
      ? 'Trạm đo thật'
      : air.source === 'interpolated'
        ? 'Nội suy từ trạm đo thật'
        : air.source === 'open-meteo'
          ? 'Mô hình Open-Meteo (CAMS)'
          : air.source === 'live'
            ? 'Open-Meteo API (trực tiếp)'
            : air.source === 'cache'
              ? 'Dữ liệu cache'
              : air.source === 'estimate'
                ? 'Mô hình ước tính'
                : 'Không khả dụng'
  // US-19: with neither live data nor a cache/estimate the backend reports
  // source 'unavailable' (or null numbers) — show a notice, never fake tiles.
  const unavailable = air.source === 'unavailable' || air.aqi == null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CloudSun className="h-4 w-4" /> Chất lượng không khí
        </CardTitle>
        <CardDescription>{air.locationLabel ?? 'Không có thông tin'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {unavailable ? (
          <Alert className="border-amber-300 bg-amber-50 text-amber-900">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle className="text-sm">Không có dữ liệu chất lượng không khí</AlertTitle>
            <AlertDescription className="text-xs">
              {air.notice ?? 'Dữ liệu chất lượng không khí hiện không khả dụng.'}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex items-end gap-3">
              <div className={`text-4xl font-bold leading-none ${tone}`}>{air.aqi ?? '—'}</div>
              <div>
                <div className={`text-sm font-medium ${tone}`}>
                  US AQI · {air.category ?? fallbackLabel}
                </div>
                {air.measuredAt && (
                  <div className="text-xs text-muted-foreground">
                    Cập nhật {formatMeasuredAt(air.measuredAt)}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-4 text-sm">
              <span>
                PM2.5: <strong>{air.pm25 ?? '—'}</strong> µg/m³
              </span>
              <span>
                PM10: <strong>{air.pm10 ?? '—'}</strong> µg/m³
              </span>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="text-xs">
                Nguồn: {sourceLabel}
              </Badge>
            </div>
            {air.notice && (
              <Alert className="border-amber-300 bg-amber-50 text-amber-900 py-2">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription className="text-xs">{air.notice}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------ Recommendations (US-10/20)

/**
 * Phân tầng tiêu chí theo mức quan tâm thực tế của người dùng (nghiên cứu UX
 * 19/11/2026): người dùng chỉ quan tâm 3 tiêu chí ảnh hưởng trực tiếp đến
 * quyết định đi lại — thời gian, chi phí, tuân thủ LEZ. Bốn tiêu chí kỹ thuật
 * còn lại (accessibility / convenience / environment / trend) là điểm số mô
 * hình 0–1 hoặc hệ số phát thải g/km mà người dùng không chuyển hoá được
 * thành quyết định — vẫn giữ nguyên cho tính minh bạch học thuật nhưng mặc
 * định thu gọn sau nút "tiêu chí kỹ thuật khác".
 */
const KEY_CRITERIA: ReadonlySet<string> = new Set(['travelTime', 'cost', 'lezCompliance'])

function RecommendationRow({
  rec,
  tripId,
  currentVehicleId,
  onDecide,
  decided,
  deciding,
}: {
  rec: Recommendation
  tripId?: string
  currentVehicleId: string
  onDecide: (modeId: string) => void
  decided: string | null
  deciding: boolean
}) {
  const [open, setOpen] = useState(rec.rank === 1)
  const isCurrent = rec.modeId === currentVehicleId
  const isDecision = decided === rec.modeId
  const scorePct = Math.round(rec.score * 100)
  const compliance = rec.compliance.status
  const banned = compliance === 'not_permitted'
  const restricted = compliance === 'conditionally_restricted'
  // Tách 2 tầng tiêu chí: 3 tiêu chí người dùng quan tâm hiển thị ngay;
  // tiêu chí kỹ thuật thu gọn (xem KEY_CRITERIA ở trên).
  const keyCriteria = rec.criteria.filter((c) => KEY_CRITERIA.has(c.criterion))
  const techCriteria = rec.criteria.filter((c) => !KEY_CRITERIA.has(c.criterion))
  const techWeightPct = Math.round(techCriteria.reduce((s, c) => s + c.weightPct, 0))
  // Hàng của phương tiện người dùng đã chọn luôn được làm nổi bật — kể cả
  // khi bị cấm trong LEZ (khi đó ô cảnh báo đỏ hiện ngay trong hàng).
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`rounded-xl border p-3 transition-colors ${
        isCurrent && banned
          ? 'border-red-300 bg-red-50/70'
          : isCurrent && restricted
            ? 'border-amber-300 bg-amber-50/60'
            : isCurrent
              ? 'border-primary/50 bg-primary/5'
              : rec.rank === 1
                ? 'border-emerald-300 bg-emerald-50/60 shadow-sm shadow-emerald-500/10'
                : 'bg-card hover:border-emerald-200'
      }`}
    >
      <div className="flex items-start gap-2.5">
        {!banned && <RankMedal rank={rec.rank} />}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg">
          {MODE_ICONS[rec.modeId] ?? '🚍'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-sm">
              {/* Phương tiện bị cấm không tham gia xếp hạng — hiển thị tên trần */}
              {rec.modeName}
            </span>
            {rec.rank === 1 && !banned && (
              <Badge className="gap-1 bg-emerald-600 text-white text-[10px]">
                <Award className="h-3 w-3" aria-hidden /> Đề xuất hàng đầu
              </Badge>
            )}
            {isCurrent && (
              <Badge
                variant="outline"
                className={
                  banned
                    ? 'border-red-400 bg-red-100 text-[10px] text-red-800'
                    : 'border-primary/60 bg-primary/10 text-[10px] text-primary'
                }
              >
                Phương tiện bạn đã chọn
              </Badge>
            )}
            {isDecision && (
              <Badge className="bg-emerald-600 text-white text-[10px]">
                <Check className="w-3 h-3 mr-0.5" /> Lựa chọn của bạn
              </Badge>
            )}
            <ComplianceBadge status={compliance} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-muted/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              <Clock3 className="h-3 w-3" aria-hidden /> {fmtMin(rec.travelTimeMin)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-muted/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              <Wallet className="h-3 w-3" aria-hidden /> {fmtVnd(rec.costVnd)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Leaf className="h-3 w-3" aria-hidden /> {rec.co2Kg.toFixed(2)} kg CO₂
            </span>
          </div>
        </div>
        {!banned && (
          <div className="shrink-0 text-right">
            <div className="text-sm font-extrabold tabular-nums leading-none text-foreground">
              {scorePct}
              <span className="text-[10px] font-semibold text-muted-foreground">/100</span>
            </div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              điểm
            </div>
          </div>
        )}
      </div>
      {isCurrent && banned && (
        <div className="mt-2 rounded-lg border border-red-300 bg-white/80 p-2.5" role="alert">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-red-700">
            <Ban className="h-4 w-4 shrink-0" aria-hidden />
            Bị cấm — không được phép đi vào vùng LEZ
          </div>
          {rec.compliance.reason && (
            <p className="mt-1 text-xs leading-relaxed text-red-900/90">{rec.compliance.reason}</p>
          )}
          {rec.compliance.rules.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {rec.compliance.rules.map((r, i) => (
                <li
                  key={`${r.zoneId}-${i}`}
                  className="rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-900"
                >
                  <span className="font-semibold">{r.zoneName}</span> · Không được phép ·{' '}
                  {r.startTime}–{r.endTime} · {fmtDaysVi(r.days)}
                  {r.condition && <div className="text-red-900/70">{r.condition}</div>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[11px] text-red-900/80">
            Phương tiện này không được xếp hạng và không thể ghi nhận làm lựa chọn. Vui lòng cân
            nhắc một phương án thay thế bên dưới để tránh vi phạm quy định LEZ.
          </p>
        </div>
      )}
      {isCurrent && restricted && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-white/80 p-2.5" role="alert">
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
            Có thể bị hạn chế theo quy định LEZ
          </div>
          {rec.compliance.reason && (
            <p className="mt-1 text-xs leading-relaxed text-amber-900/90">{rec.compliance.reason}</p>
          )}
          {rec.compliance.rules.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {rec.compliance.rules.map((r, i) => (
                <li
                  key={`${r.zoneId}-${i}`}
                  className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900"
                >
                  <span className="font-semibold">{r.zoneName}</span> · Có điều kiện ·{' '}
                  {r.startTime}–{r.endTime} · {fmtDaysVi(r.days)}
                  {r.condition && <div className="text-amber-900/70">{r.condition}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!banned && (
        <div className="mt-2.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${scorePct}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              className={`h-full rounded-full ${
                rec.rank === 1
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                  : 'bg-emerald-500/70'
              }`}
            />
          </div>
        </div>
      )}
      {banned && !isCurrent && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          🚫 Bị cấm trên tuyến này nên không được xếp hạng và không thể ghi nhận lựa chọn.
        </p>
      )}
      {/* Phương tiện bị cấm: không xếp hạng, không chấm điểm hiển thị, không thể
          ghi nhận lựa chọn — chỉ hiện thông tin + cảnh báo LEZ. */}
      {!banned && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
          <Button
            size="sm"
            className="h-7 text-xs"
            variant={isDecision ? 'secondary' : rec.rank === 1 ? 'default' : 'outline'}
            disabled={deciding || !tripId}
            onClick={() => onDecide(rec.modeId)}
            title={tripId ? 'Ghi nhận lựa chọn này (ý định chuyển đổi)' : 'Chưa lưu chuyến đi'}
          >
            {isDecision ? '✓ Đã ghi nhận' : 'Tôi sẽ dùng phương tiện này'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1.5 text-xs"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Vì sao có điểm này?
          </Button>
        </div>
      )}
      {!banned && open && (
        <div className="mt-3 space-y-1 border-t pt-2.5">
          {keyCriteria.map((c) => (
            <div key={c.criterion} className="flex items-center gap-2 text-xs">
              <span className="w-36 shrink-0 truncate font-medium text-foreground" title={c.label}>
                {c.label}
                <span className="ml-1 text-[10px] opacity-60">({Math.round(c.weightPct)}%)</span>
              </span>
              <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-teal-500"
                  style={{ width: `${Math.round(c.normalized * 100)}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right font-semibold tabular-nums">{c.display}</span>
            </div>
          ))}
          {techCriteria.length > 0 && (
            <details className="group mt-1.5 rounded-lg bg-muted/40 px-2 py-1.5">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="h-3 w-3 transition-transform group-open:rotate-90"
                  aria-hidden
                />
                {techCriteria.length} tiêu chí kỹ thuật khác ({techWeightPct}% trọng số)
              </summary>
              <div className="mt-1.5 space-y-1">
                {techCriteria.map((c) => (
                  <div key={c.criterion} className="flex items-center gap-2 text-xs">
                    <span className="w-36 shrink-0 truncate text-muted-foreground" title={c.label}>
                      {c.label}
                      <span className="ml-1 text-[10px] opacity-60">({Math.round(c.weightPct)}%)</span>
                    </span>
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-teal-500"
                        style={{ width: `${Math.round(c.normalized * 100)}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right tabular-nums">{c.display}</span>
                  </div>
                ))}
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Chấm điểm đa tiêu chí TOPSIS: mỗi tiêu chí được chuẩn hóa, gán trọng số và so với
                  giải pháp lý tưởng. Thanh cao hơn = đóng góp tốt hơn vào tổng điểm.
                </p>
              </div>
            </details>
          )}
        </div>
      )}
    </motion.div>
  )
}

// Route rows without the Card wrapper — reused by the side panel (Task 33)
export function RecommendationList({
  result,
  onDecide,
  decided,
  deciding,
}: {
  result: AnalyzeResponse
  onDecide: (modeId: string) => void
  decided: string | null
  deciding: boolean
}) {
  // Điều chỉnh theo phản hồi người dùng: phương tiện ĐÃ CHỌN luôn đứng đầu
  // kèm kiểm tra LEZ. Phương tiện BỊ CẤM (kể cả phương án khác) không tham
  // gia xếp hạng — không số #N, không nút ghi nhận — và được đẩy xuống cuối
  // danh sách; các phương án khả dụng xếp theo điểm TOPSIS. Chỉ đổi thứ tự
  // hiển thị, không đổi dữ liệu hay điểm số.
  const chosen = result.recommendations.find((r) => r.modeId === result.vehicleId)
  const usableRest = result.recommendations.filter(
    (r) => r.modeId !== result.vehicleId && r.compliance.status !== 'not_permitted',
  )
  const bannedRest = result.recommendations.filter(
    (r) => r.modeId !== result.vehicleId && r.compliance.status === 'not_permitted',
  )
  const ordered = chosen ? [chosen, ...usableRest, ...bannedRest] : result.recommendations
  const nUsable = ordered.filter((r) => r.compliance.status !== 'not_permitted').length
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <Award className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          Xếp hạng TOPSIS · {nUsable} phương án khả dụng
        </p>
        <p className="text-[10px] text-muted-foreground">điểm 0–100</p>
      </div>
      {ordered.map((rec) => (
        <RecommendationRow
          key={rec.modeId}
          rec={rec}
          tripId={result.tripId}
          currentVehicleId={result.vehicleId}
          onDecide={onDecide}
          decided={decided}
          deciding={deciding}
        />
      ))}
    </div>
  )
}

export function RecommendationsPanel({
  result,
  onDecide,
  decided,
  deciding,
}: {
  result: AnalyzeResponse
  onDecide: (modeId: string) => void
  decided: string | null
  deciding: boolean
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span aria-hidden>🏆</span> Xếp hạng phương tiện đề xuất
        </CardTitle>
        <CardDescription>
          Xếp hạng MCDM (TOPSIS) trên {result.recommendations.length} phương án — trọng số từ cấu
          hình quản trị viên và ưu tiên của bạn.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RecommendationList result={result} onDecide={onDecide} decided={decided} deciding={deciding} />
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------ Comparison (US-11)

export function ComparisonTable({ result }: { result: AnalyzeResponse }) {
  const top = result.recommendations.slice(0, 4)
  // UX 19/11/2026: bỏ hàng "Khả năng tiếp cận" / "Thuận tiện" — điểm mô hình
  // 0–1 mà người dùng không chuyển hoá được thành quyết định (đối chiếu
  // KEY_CRITERIA ở trên); chi tiết đầy đủ vẫn có trong panel "Vì sao có điểm này?".
  const rows: { label: string; render: (r: Recommendation) => string }[] = [
    { label: 'Thời gian di chuyển', render: (r) => fmtMin(r.travelTimeMin) },
    // US-11: route distance is shared by every option (same origin→destination)
    { label: 'Quãng đường', render: () => fmtKm(result.route.distanceKm) },
    { label: 'Chi phí ước tính', render: (r) => fmtVnd(r.costVnd) },
    {
      label: 'Tuân thủ LEZ',
      render: (r) =>
        r.compliance.status === 'compliant'
          ? 'Đạt'
          : r.compliance.status === 'conditionally_restricted'
            ? 'Có điều kiện'
            : 'Không được phép',
    },
    {
      label: 'Phát thải',
      render: (r) => (r.co2Kg === 0 ? 'Không phát thải' : `${r.co2Kg.toFixed(2)} kg CO₂`),
    },
    { label: 'Điểm tổng', render: (r) => `${Math.round(r.score * 100)}` },
  ]
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span aria-hidden>⚖️</span> So sánh các phương án
        </CardTitle>
        <CardDescription>So sánh trực tiếp {top.length} phương án hàng đầu</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-card">Tiêu chí</TableHead>
              {top.map((r) => (
                <TableHead key={r.modeId} className="whitespace-nowrap">
                  {MODE_ICONS[r.modeId] ?? ''} {r.modeName}
                  {r.rank === 1 && <span className="ml-1 text-emerald-600">★</span>}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="font-medium sticky left-0 bg-card">{row.label}</TableCell>
                {top.map((r) => (
                  <TableCell key={r.modeId} className="whitespace-nowrap">
                    {row.render(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------ Impact estimator (US-12)

export function ImpactEstimator({ result }: { result: AnalyzeResponse }) {
  const best = result.recommendations[0]
  const current = result.recommendations.find((r) => r.modeId === result.vehicleId) ?? null
  if (!best) return null
  const a = current && current.modeId !== best.modeId ? current : null
  const b = best
  // when the user's current vehicle IS the best option, compare against runner-up
  const other = a ? b : result.recommendations[1] ?? null
  const diff = (x: number, y: number) => x - y
  const leftName = a ? a.modeName : '—'
  const rightName = other ? other.modeName : '—'
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span aria-hidden>📊</span> Ước lượng tác động
        </CardTitle>
        <CardDescription>
          {a ? (
            <>
              Chuyển từ <strong>{leftName}</strong> (phương tiện hiện tại của bạn) sang{' '}
              <strong>{rightName}</strong> (đề xuất hàng đầu)
            </>
          ) : (
            <>
              Phương tiện hiện tại của bạn trùng với đề xuất hàng đầu. So sánh{' '}
              <strong>{b.modeName}</strong> với phương án kế tiếp{' '}
              <strong>{other ? other.modeName : '—'}</strong>
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-1">Thời gian di chuyển</div>
            <div className="text-lg font-semibold">
              {other
                ? `${diff(other.travelTimeMin, (a ?? b).travelTimeMin) >= 0 ? '+' : ''}${Math.round(diff(other.travelTimeMin, (a ?? b).travelTimeMin))} phút`
                : '—'}
            </div>
            <div className="text-xs text-muted-foreground">
              {a ? `${rightName} vs ${leftName}` : `${other?.modeName ?? '—'} vs ${b.modeName}`}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-1">Chi phí ước tính</div>
            <div className="text-lg font-semibold">
              {other
                ? `${diff(other.costVnd, (a ?? b).costVnd) >= 0 ? '+' : ''}${Math.round(diff(other.costVnd, (a ?? b).costVnd)).toLocaleString('vi-VN')} VND`
                : '—'}
            </div>
            <div className="text-xs text-muted-foreground">mỗi chuyến</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-1">Phát thải</div>
            <div className="text-lg font-semibold">
              {other
                ? `${diff(other.co2Kg, (a ?? b).co2Kg) >= 0 ? '+' : ''}${diff(other.co2Kg, (a ?? b).co2Kg).toFixed(2)} kg CO₂`
                : '—'}
            </div>
            <div className="text-xs text-muted-foreground">
              {a
                ? a.co2Kg === 0
                  ? `${leftName} không phát thải`
                  : `${leftName}: ${a.co2Kg.toFixed(2)} kg`
                : b.co2Kg === 0
                  ? `${b.modeName} không phát thải`
                  : `${b.modeName}: ${b.co2Kg.toFixed(2)} kg`}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground mb-1">Tuân thủ LEZ</div>
            <div className="mt-1 flex flex-col gap-1">
              {a && <ComplianceBadge status={a.compliance.status} />}
              <ComplianceBadge status={b.compliance.status} />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {a ? `${leftName} → ${rightName}` : b.modeName}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
