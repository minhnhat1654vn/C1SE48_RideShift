'use client'

// Notification bell (Task 3-c) — anonymous, opt-in policy notifications.
// All requests fail silently: the bell must never break the page.

import { useCallback, useEffect, useState } from 'react'
import { Bell, CheckCheck, Loader2, Megaphone, ShieldCheck, Wind } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { HANOI_DISTRICTS } from '@/data/hanoi-districts'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

// ---------------------------------------------------------------- types

type NotificationType = 'lez_published' | 'lez_active' | 'aqi_alert' | string

type PolicyNotification = {
  id: number | string
  type: NotificationType
  title: string
  body: string
  zoneId?: string | null
  readAt?: string | null
  createdAt?: string | null
}

type NotificationPrefs = {
  userKey: string
  district: string
  optIn: boolean
}

// Radix Select does not accept empty-string item values → sentinel 'all'.
const DISTRICT_ALL = 'all'

const DISTRICT_NAMES: string[] = HANOI_DISTRICTS.map((d) => d.name)

// ---------------------------------------------------------------- helpers

/** localStorage anonymous key — created on first use, shared with feedback widget. */
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

/** Vietnamese relative time: "5 phút trước", "3 giờ trước", "2 ngày trước", … */
function formatRelativeTime(iso?: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (diffSec < 60) return 'Vừa xong'
  const min = Math.floor(diffSec / 60)
  if (min < 60) return `${min} phút trước`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} giờ trước`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} ngày trước`
  return new Date(iso).toLocaleDateString('vi-VN')
}

function typeIcon(type: NotificationType) {
  if (type === 'lez_published') return <Megaphone className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
  if (type === 'lez_active') return <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
  if (type === 'aqi_alert') return <Wind className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden />
  return <Bell className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
}

// ---------------------------------------------------------------- component

export default function NotificationBell() {
  const [userKey, setUserKey] = useState<string | null>(null)
  const [optIn, setOptIn] = useState(false)
  const [district, setDistrict] = useState('') // '' = toàn thành phố
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [notifications, setNotifications] = useState<PolicyNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)

  // userKey: chỉ chạy client (component được dynamic import ssr:false)
  useEffect(() => {
    setUserKey(getOrCreateUserKey())
  }, [])

  // Tải prefs hiện tại (nếu có)
  useEffect(() => {
    if (!userKey) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch(`/api/notifications/prefs?userKey=${encodeURIComponent(userKey)}`)
        if (!res.ok) return
        const data = (await res.json()) as { prefs?: NotificationPrefs | null }
        if (cancelled || !data.prefs) return
        setOptIn(Boolean(data.prefs.optIn))
        setDistrict(typeof data.prefs.district === 'string' ? data.prefs.district : '')
      } catch {
        /* im lặng — bell không bao giờ làm lỗi trang */
      } finally {
        if (!cancelled) setPrefsLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userKey])

  const fetchNotifications = useCallback(async (key: string) => {
    try {
      const res = await apiFetch(`/api/notifications?userKey=${encodeURIComponent(key)}`)
      if (!res.ok) return // ví dụ 404 khi backend chưa có — im lặng
      const data = (await res.json()) as { notifications?: PolicyNotification[]; unread?: number }
      setNotifications(Array.isArray(data.notifications) ? data.notifications : [])
      setUnread(typeof data.unread === 'number' ? data.unread : 0)
    } catch {
      /* im lặng */
    }
  }, [])

  // Poll: ngay khi mount + mỗi 60 giây (chỉ khi optIn=true).
  // Việc đổi prefs (optIn=true) tự kích hoạt lại effect này → kéo ngay danh sách mới.
  useEffect(() => {
    if (!userKey) return
    void fetchNotifications(userKey)
    if (!optIn) return
    const timer = setInterval(() => void fetchNotifications(userKey), 60_000)
    return () => clearInterval(timer)
  }, [userKey, optIn, fetchNotifications])

  const savePrefs = useCallback(
    async (nextOptIn: boolean, nextDistrict: string) => {
      if (!userKey) return
      setSavingPrefs(true)
      try {
        const res = await apiFetch('/api/notifications/prefs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userKey, optIn: nextOptIn, district: nextDistrict }),
        })
        if (res.ok) {
          toast.success('Đã lưu tùy chọn thông báo')
          if (nextOptIn) void fetchNotifications(userKey)
        }
      } catch {
        /* im lặng */
      } finally {
        setSavingPrefs(false)
      }
    },
    [userKey, fetchNotifications]
  )

  const markRead = useCallback(
    async (ids: (number | string)[]) => {
      if (!userKey || ids.length === 0) return
      try {
        const res = await apiFetch('/api/notifications/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userKey, ids }),
        })
        if (res.ok) void fetchNotifications(userKey)
      } catch {
        /* im lặng */
      }
    },
    [userKey, fetchNotifications]
  )

  const markAllRead = useCallback(async () => {
    if (!userKey) return
    const unreadIds = notifications.filter((n) => !n.readAt).map((n) => n.id)
    if (unreadIds.length === 0) return
    setMarkingAll(true)
    await markRead(unreadIds)
    setMarkingAll(false)
  }, [userKey, notifications, markRead])

  const unreadCount = unread > 0 ? unread : notifications.filter((n) => !n.readAt).length

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative shrink-0 rounded-full"
          aria-label={`Thông báo chính sách${unreadCount > 0 ? ` (${unreadCount} chưa đọc)` : ''}`}
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 p-4">
        {/* ---- prefs ---- */}
        <div className="space-y-2.5 rounded-xl border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="notif-optin" className="text-[13px] font-medium leading-snug">
              Nhận thông báo chính sách
            </Label>
            <Switch
              id="notif-optin"
              checked={optIn}
              disabled={savingPrefs || !prefsLoaded}
              onCheckedChange={(v) => {
                setOptIn(v)
                void savePrefs(v, district)
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Khu vực quan tâm</Label>
            <Select
              value={district === '' ? DISTRICT_ALL : district}
              onValueChange={(v) => {
                const next = v === DISTRICT_ALL ? '' : v
                setDistrict(next)
                void savePrefs(optIn, next)
              }}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Khu vực quan tâm">
                <SelectValue placeholder="Chọn khu vực" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value={DISTRICT_ALL}>Toàn thành phố</SelectItem>
                {DISTRICT_NAMES.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ---- header + mark all read ---- */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold">Thông báo</p>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              onClick={() => void markAllRead()}
              disabled={markingAll}
            >
              {markingAll ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <CheckCheck className="h-3.5 w-3.5" aria-hidden />
              )}
              Đánh dấu tất cả đã đọc
            </Button>
          )}
        </div>

        {/* ---- list ---- */}
        {notifications.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
            Chưa có thông báo. Bật nhận thông báo để được biết vùng kiểm soát phát thải mới áp dụng
            quanh khu vực của bạn.
          </p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto pr-0.5">
            {notifications.map((n) => {
              const isUnread = !n.readAt
              return (
                <li key={String(n.id)}>
                  <button
                    type="button"
                    disabled={!isUnread}
                    onClick={() => void markRead([n.id])}
                    className={`flex w-full gap-2 rounded-lg p-2 text-left transition-colors ${
                      isUnread
                        ? 'bg-emerald-50/40 hover:bg-emerald-50/70 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40'
                        : 'hover:bg-accent/50'
                    } disabled:cursor-default`}
                  >
                    <span className="mt-0.5">{typeIcon(n.type)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {isUnread && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-label="Chưa đọc" />
                        )}
                        <span className="truncate text-[13px] font-semibold">{n.title}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>
                      <span className="mt-1 block text-[10px] text-muted-foreground/80">
                        {formatRelativeTime(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
