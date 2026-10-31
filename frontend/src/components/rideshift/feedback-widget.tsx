'use client'

// Feedback widget (Task 3-c) — phản hồi nhanh về phương tiện được đề xuất.
// Hiện 1 dòng dưới danh sách khuyến nghị trong Trip Planner.

import { useState } from 'react'
import { Check, Loader2, MessageSquarePlus } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// ---------------------------------------------------------------- types

type FeedbackReason = 'cost' | 'time' | 'safety' | 'weather' | 'infrastructure' | 'habit' | 'other'

const REASONS: { value: FeedbackReason; label: string }[] = [
  { value: 'cost', label: 'Chi phí cao' },
  { value: 'time', label: 'Mất thời gian' },
  { value: 'safety', label: 'Không an toàn' },
  { value: 'weather', label: 'Thời tiết' },
  { value: 'infrastructure', label: 'Thiếu hạ tầng' },
  { value: 'habit', label: 'Thói quen cá nhân' },
  { value: 'other', label: 'Khác' },
]

/** localStorage anonymous key — dùng chung với chuông thông báo ('rideshift_user_key'). */
function getOrCreateUserKey(): string {
  const KEY = 'rideshift_user_key'
  try {
    const existing = window.localStorage.getItem(KEY)
    if (existing) return existing
    const key =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `u-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    window.localStorage.setItem(KEY, key)
    return key
  } catch {
    return `u-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
}

// ---------------------------------------------------------------- component

export default function FeedbackWidget({
  tripId,
  topModeId,
  topModeName,
}: {
  tripId?: number | string
  topModeId?: number | string
  topModeName?: string
}) {
  const [reason, setReason] = useState<FeedbackReason | ''>('')
  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async () => {
    if (!reason || sending) return
    setSending(true)
    try {
      const res = await apiFetch('/api/trip/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userKey: getOrCreateUserKey(),
          // gửi nguyên trạng thái như analyze trả về (id dạng số hoặc chuỗi)
          tripId: tripId ?? undefined,
          topModeId: topModeId ?? undefined,
          reason,
          detail: detail.trim() ? detail.trim() : undefined,
        }),
      })
      if (res.ok) {
        toast.success('Cảm ơn bạn! Phản hồi giúp hệ thống gợi ý tốt hơn.')
        setSent(true)
      } else {
        toast.error('Không gửi được phản hồi. Vui lòng thử lại sau.')
      }
    } catch {
      // lỗi mạng — không được làm lỗi trang
      toast.error('Không gửi được phản hồi. Vui lòng thử lại sau.')
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
        <Check className="h-3.5 w-3.5" aria-hidden />
        Đã nhận phản hồi của bạn — cảm ơn đã giúp RideShift gợi ý tốt hơn!
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">
          Phương tiện được đề xuất{topModeName ? ` (${topModeName})` : ''} chưa phù hợp?
        </span>
        <Select value={reason || undefined} onValueChange={(v) => setReason(v as FeedbackReason)}>
          <SelectTrigger size="sm" className="h-8 w-[150px]" aria-label="Lý do chưa phù hợp">
            <SelectValue placeholder="Chọn lý do" />
          </SelectTrigger>
          <SelectContent>
            {REASONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-1.5">
          {!detailOpen && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs text-muted-foreground"
              onClick={() => setDetailOpen(true)}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden /> Thêm chi tiết
            </Button>
          )}
          <Button size="sm" className="h-8 gap-1" disabled={!reason || sending} onClick={() => void submit()}>
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden />
            )}
            Gửi
          </Button>
        </div>
      </div>
      {detailOpen && (
        <Textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Ghi chú thêm (không bắt buộc) — ví dụ: đoạn đường quá đông vào giờ cao điểm…"
          className="min-h-[60px] text-xs"
          maxLength={500}
        />
      )}
    </div>
  )
}
