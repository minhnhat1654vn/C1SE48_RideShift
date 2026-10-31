'use client'

// Cổng chọn thành phố (Task 63 — yêu cầu 5 & 6):
// - hiện TRƯỚC màn hình chính khi guest chưa chọn thành phố
// - dropdown (xổ danh sách) chọn nơi sinh sống & làm việc
// - không đóng được bằng Esc/backdrop khi chưa chọn (lock); chỉ nút
//   "Đổi thành phố" ở header mở lại được (khi đó có nút Huỷ để đóng)

import { useState } from 'react'
import { Building2, Check, Leaf, Loader2, MapPin, TriangleAlert } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import type { CityDto } from '@/lib/types'

export default function CityGate({
  cities,
  current,
  loading,
  degraded,
  onConfirm,
  onCancel,
}: {
  cities: CityDto[]
  current: string | null
  loading?: boolean
  /** true: danh sách thành phố đến từ fallback tĩnh (API chưa sẵn sàng) */
  degraded?: boolean
  onConfirm: (cityId: string) => void
  onCancel?: () => void
}) {
  const [value, setValue] = useState<string>(current ?? '')

  const isChangeMode = !!onCancel // đang mở lại từ nút "Đổi thành phố"

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Chọn thành phố của bạn"
    >
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Leaf className="h-5 w-5" aria-hidden />
          </div>
          <h2 className="text-lg font-bold leading-tight">Chào bạn đến với RideShift👋</h2>
        </div>

        <p className="mb-3 text-sm font-medium">
          Bạn đang sinh sống và làm việc ở thành phố nào?
        </p>

        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="h-11 w-full" aria-label="Chọn thành phố">
            <Building2 className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden />
            <SelectValue placeholder="— Chọn thành phố —" />
          </SelectTrigger>
          <SelectContent className="z-[2100]">
            {cities.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                  {c.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {degraded && (
          <p
            role="status"
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <span className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Chưa kết nối được backend — danh sách mặc định. Bản đồ/phường xã có thể
                thiếu, F5 lại sau vài phút hoặc xem{' '}
                <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/60">docker compose logs backend</code>.
              </span>
            </span>
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          {isChangeMode && (
            <Button variant="ghost" onClick={onCancel}>
              Huỷ
            </Button>
          )}
          <Button disabled={!value || loading} onClick={() => value && onConfirm(value)}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Xác nhận
          </Button>
        </div>

        <p className="mt-4 text-center text-[10px] leading-tight text-muted-foreground">
          RideShift · Nhóm C1SE.48
        </p>
      </div>
    </div>
  )
}
