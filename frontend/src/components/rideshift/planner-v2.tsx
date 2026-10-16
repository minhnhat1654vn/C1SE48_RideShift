'use client'

// Tư vấn v2 — chạy trên pipeline schema v2 (backend/app/schema_v2.sql):
// lưu vết đầy đủ (trips/routes/lez/scores/impact) + ghi nhận lựa chọn của Guest.
// UI theo rules.md: tiếng Việt, shadcn/ui, mobile-first, 3 trạng thái loading/error/empty.

import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Leaf,
  Loader2,
  MapPin,
  Navigation,
  Route as RouteIcon,
  ShieldAlert,
  ArrowLeftRight,
} from 'lucide-react'

import { analyzeV2, fetchVehicleTypesV2, recordChoiceV2 } from '@/lib/api-v2'
import type { V2AnalyzeBody, V2AnalyzeResponse, V2Compliance, V2VehicleType } from '@/lib/api-v2'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'

type GeoResult = { name: string; lat: number; lng: number; source: string }
type Picked = { name: string; lat: number; lng: number }

const PURPOSES = [
  { value: 'work', label: 'Đi làm' },
  { value: 'school', label: 'Đi học' },
  { value: 'shopping', label: 'Mua sắm' },
  { value: 'leisure', label: 'Giải trí' },
  { value: 'other', label: 'Khác' },
]

const COMPLIANCE_BADGE: Record<V2Compliance['status'], { label: string; className: string }> = {
  COMPLIANT: { label: 'Được phép', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  CONDITIONAL: { label: 'Hạn chế có điều kiện', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  NOT_COMPLIANT: { label: 'Không được phép', className: 'bg-red-100 text-red-800 border-red-200' },
}

function ComplianceBadge({ status }: { status: V2Compliance['status'] }) {
  const b = COMPLIANCE_BADGE[status]
  return (
    <Badge variant="outline" className={`${b.className} shrink-0`} aria-label={`Trạng thái: ${b.label}`}>
      {b.label}
    </Badge>
  )
}

function GeoSearch({
  label,
  placeholder,
  value,
  onPick,
}: {
  label: string
  placeholder: string
  value: Picked | null
  onPick: (p: Picked) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  // debounce 300ms — tránh gọi API từng ký tự
  useEffect(() => {
    if (value || query.trim().length < 3) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(Array.isArray(data) ? data.slice(0, 5) : [])
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query, value])

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {value ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate" title={value.name}>{value.name}</span>
          <Button
            type="button" variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs"
            onClick={() => { onPick({ name: '', lat: NaN, lng: NaN }); setQuery('') }}
          >
            Đổi
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label={label}
            autoComplete="off"
          />
          {loading && (
            <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
          )}
          {open && results.length > 0 && (
            <ul
              className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md"
              role="listbox"
              aria-label={`Kết quả ${label}`}
            >
              {results.map((r, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => { onPick({ name: r.name, lat: r.lat, lng: r.lng }); setOpen(false) }}
                  >
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {open && !loading && results.length === 0 && query.trim().length >= 3 && (
            <p className="absolute z-20 mt-1 w-full rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground">
              Không tìm thấy địa điểm phù hợp.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function PlannerV2() {
  const [vtypes, setVtypes] = useState<V2VehicleType[]>([])
  const [origin, setOrigin] = useState<Picked | null>(null)
  const [destination, setDestination] = useState<Picked | null>(null)
  const [vtypeCode, setVtypeCode] = useState('')
  const [purpose, setPurpose] = useState<V2AnalyzeBody['purpose']>('work')
  const [travelTime, setTravelTime] = useState('')
  const [prefs, setPrefs] = useState({ fastest: 50, cheapest: 50, eco: 50, comfort: 50 })
  const [phase, setPhase] = useState<'idle' | 'loading' | 'error' | 'result'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [result, setResult] = useState<V2AnalyzeResponse | null>(null)
  const [choice, setChoice] = useState<{ switched: boolean; name: string } | null>(null)
  const [choosing, setChoosing] = useState<number | null>(null)

  useEffect(() => {
    fetchVehicleTypesV2()
      .then((list) => {
        setVtypes(list)
        if (list.length > 0) setVtypeCode(list[0].code)
      })
      .catch(() => setVtypes([]))
  }, [])

  const canSubmit = origin && destination && vtypeCode && phase !== 'loading'

  const submit = useCallback(async () => {
    if (!origin || !destination || !vtypeCode) return
    setPhase('loading')
    setErrorMsg('')
    setResult(null)
    setChoice(null)
    try {
      const body = {
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        vehicleTypeCode: vtypeCode,
        purpose,
        travelTime: travelTime || undefined,
        preferences: prefs,
      }
      const d = await analyzeV2(body)
      setResult(d)
      setPhase('result')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Lỗi không xác định.')
      setPhase('error')
    }
  }, [origin, destination, vtypeCode, purpose, travelTime, prefs])

  const choose = useCallback(async (code: string | null, name: string) => {
    if (!result) return
    setChoosing(result.tripId)
    try {
      const r = await recordChoiceV2(result.tripId, code)
      const v = vtypes.find((x) => x.code === code)
      setChoice({ switched: r.trip.switched, name: name || v?.name || '' })
    } catch {
      setChoice(null)
    } finally {
      setChoosing(null)
    }
  }, [result, vtypes])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* ---------------- FORM ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Navigation className="h-5 w-5 text-primary" aria-hidden="true" />
            Lên kế hoạch chuyến đi
          </CardTitle>
          <CardDescription>
            Nhập điểm đi – điểm đến, hệ thống sẽ phân tích vùng phát thải thấp và đề xuất phương tiện phù hợp.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <GeoSearch
              label="Điểm đi" placeholder="vd: Hồ Hoàn Kiếm"
              value={origin} onPick={setOrigin}
            />
            <GeoSearch
              label="Điểm đến" placeholder="vd: Bách Khoa"
              value={destination} onPick={setDestination}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="v2-vtype">Phương tiện hiện tại</Label>
              <select
                id="v2-vtype"
                value={vtypeCode}
                onChange={(e) => setVtypeCode(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {vtypes.map((v) => (
                  <option key={v.code} value={v.code}>
                    {v.name} ({v.emissionStandard ?? 'không rõ chuẩn'})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v2-purpose">Mục đích</Label>
              <select
                id="v2-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as V2AnalyzeBody['purpose'])}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {PURPOSES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v2-time">Thời gian đi</Label>
              <Input
                id="v2-time" type="datetime-local" value={travelTime}
                onChange={(e) => setTravelTime(e.target.value)}
              />
            </div>
          </div>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Mức độ quan tâm của bạn (0–100)</legend>
            {([
              ['fastest', 'Nhanh nhất'], ['cheapest', 'Rẻ nhất'],
              ['eco', 'Thân thiện môi trường'], ['comfort', 'Thoải mái'],
            ] as const).map(([key, label]) => (
              <div key={key} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3">
                <Label htmlFor={`pref-${key}`} className="text-xs">{label}</Label>
                <Slider
                  id={`pref-${key}`}
                  min={0} max={100} step={5}
                  value={[prefs[key]]}
                  onValueChange={(v) => setPrefs((p) => ({ ...p, [key]: v[0] }))}
                  aria-label={label}
                />
                <span className="text-right text-xs tabular-nums text-muted-foreground">{prefs[key]}</span>
              </div>
            ))}
          </fieldset>
          <Button className="w-full sm:w-auto" onClick={submit} disabled={!canSubmit}>
            {phase === 'loading' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Đang phân tích…
              </>
            ) : (
              'Phân tích chuyến đi'
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ---------------- TRẠNG THÁI LỖI ---------------- */}
      {phase === 'error' && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ---------------- KẾT QUẢ ---------------- */}
      {phase === 'result' && result && (
        <div className="space-y-4" aria-live="polite">
          {/* Tổng quan tuyến + LEZ */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <RouteIcon className="h-5 w-5 text-primary" aria-hidden="true" />
                Tuyến đường
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span><strong>{result.route.distanceKm}</strong> km</span>
              <span>~<strong>{result.route.durationMin}</strong> phút (xe hơi)</span>
              <span className="text-muted-foreground">
                nguồn: {result.route.source === 'osrm' ? 'OSRM' : 'ước tính'}
              </span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Leaf className="h-5 w-5 text-primary" aria-hidden="true" />
                Vùng phát thải thấp trên tuyến
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {result.lez.length === 0 ? (
                <p className="text-muted-foreground">Tuyến đi không qua vùng phát thải thấp nào.</p>
              ) : (
                result.lez.map((z) => (
                  <div key={z.zoneId} className="flex items-center justify-between gap-2">
                    <span className="truncate">{z.name}</span>
                    <Badge variant="outline">
                      {z.status === 'INSIDE' ? 'Trong vùng' : z.status === 'PARTIAL' ? 'Đi ngang qua' : 'Ngoài vùng'}
                      {z.status !== 'OUTSIDE' && ` ${z.insidePct}%`}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Cảnh báo phương tiện hiện tại */}
          {result.currentCompliance.status !== 'COMPLIANT' && (
            <div
              role="alert"
              className={`flex items-start gap-2 rounded-md border p-4 text-sm ${
                result.currentCompliance.status === 'NOT_COMPLIANT'
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : 'border-amber-300 bg-amber-50 text-amber-800'
              }`}
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">
                  {result.currentCompliance.status === 'NOT_COMPLIANT'
                    ? 'Phương tiện hiện tại không được phép đi qua vùng này.'
                    : 'Phương tiện hiện tại bị hạn chế có điều kiện.'}
                </p>
                {result.currentCompliance.reason && <p className="mt-1">{result.currentCompliance.reason}</p>}
              </div>
            </div>
          )}

          {/* Xác nhận lựa chọn */}
          {choice && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {choice.switched
                  ? <>Đã ghi nhận: bạn sẽ đi <strong>{choice.name}</strong> — cảm ơn bạn đã chuyển sang phương tiện ít ô nhiễm hơn!</>
                  : <>Đã ghi nhận: bạn giữ nguyên phương tiện <strong>{choice.name}</strong>.</>}
              </span>
            </div>
          )}

          {/* Xếp hạng */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Phương án đề xuất (xếp hạng đa tiêu chí)</CardTitle>
              <CardDescription>
                Chấm điểm theo 7 tiêu chí có trọng số — bạn đang ưu tiên: nhanh {prefs.fastest}, rẻ {prefs.cheapest}, xanh {prefs.eco}, thoải mái {prefs.comfort}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.recommendations.map((r) => {
                const banned = r.compliance.status === 'NOT_COMPLIANT'
                const isChosen = choice && vtypes.find((v) => v.code === r.vehicleTypeCode)?.name === choice.name
                return (
                  <div
                    key={r.modeId}
                    className={`rounded-lg border p-3 ${banned ? 'opacity-60' : ''} ${isChosen ? 'border-primary bg-primary/5' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary"
                        aria-label={`Hạng ${r.rank}`}
                      >
                        {r.rank}
                      </span>
                      <span className="font-medium">{r.modeName}</span>
                      <ComplianceBadge status={r.compliance.status} />
                      <span className="ml-auto text-sm font-semibold tabular-nums">
                        {(r.score * 100).toFixed(0)} điểm
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${r.score * 100}%` }} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>~{Math.round(r.travelTimeMin)} phút</span>
                      <span>{r.costVnd.toLocaleString('vi-VN')} đ/chuyến</span>
                      {r.compliance.reason && <span className="truncate">{r.compliance.reason}</span>}
                    </div>
                    {!banned && (
                      <Button
                        size="sm" variant="outline"
                        className="mt-2 w-full sm:w-auto"
                        disabled={choosing !== null}
                        onClick={() => choose(r.vehicleTypeCode, r.modeName)}
                      >
                        {choosing === result.tripId ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <ArrowLeftRight className="mr-2 h-4 w-4" aria-hidden="true" />
                        )}
                        Tôi sẽ đi phương tiện này
                      </Button>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
