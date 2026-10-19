'use client'

// Task 41/42 — US demo tour spotlight.
// Circles a real UI element with an animated red ellipse, points an animated
// red arrow at it and shows a card with the User Story id + name (as in
// 3_C1SE48_UserStory_v2.0.docx) plus a Vietnamese explanation. The backdrop
// is a box-shadow "hole" so the page behind stays interactive.

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, LogIn, RefreshCw, X } from 'lucide-react'
import type { UsStep } from './us-steps'

type Rect = { left: number; top: number; width: number; height: number }
type CardPos = { left: number; top: number; width: number }

const CARD_W = 336
const RED = '#dc2626'

export default function UsSpotlight({
  step,
  index,
  total,
  onPrev,
  onNext,
  onClose,
  onEnsure,
  onQuickLogin,
}: {
  step: UsStep
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onEnsure: (step: UsStep) => void
  onQuickLogin: () => Promise<boolean>
}) {
  const [rect, setRect] = useState<Rect | null>(null)
  const [missing, setMissing] = useState(false)
  const [card, setCard] = useState<CardPos | null>(null)
  const [mobile, setMobile] = useState(false)
  const [tick, setTick] = useState(0)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginFailed, setLoginFailed] = useState(false)
  const scrollDoneRef = useRef(false)

  // ---- switch step: run the prep (tab switch / demo actions) ----
  // (state resets happen via remount — page.tsx gives this component
  //  key={step.id} so each step starts from a clean slate)
  useEffect(() => {
    scrollDoneRef.current = false
    onEnsure(step)
  }, [step, tick, onEnsure])

  // ---- keyboard navigation ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onNext()
      else if (e.key === 'ArrowLeft') onPrev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onNext, onPrev])

  // ---- mobile detection ----
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const onChange = () => setMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // ---- poll for the target element, keep measuring, place the card ----
  useEffect(() => {
    const started = Date.now()
    const measure = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      // pick the first VISIBLE match (the same data-us attr can exist on a
      // desktop-only and a mobile-only element; hidden ones have a 0x0 box)
      const candidates = Array.from(document.querySelectorAll(step.selector)) as HTMLElement[]
      let el: HTMLElement | null = null
      for (const c of candidates) {
        const cr = c.getBoundingClientRect()
        if (cr.width >= 2 && cr.height >= 2) {
          el = c
          break
        }
      }
      if (el) {
        const r = el.getBoundingClientRect()
        // scroll the target into view once, then keep tracking
        if (!scrollDoneRef.current) {
          scrollDoneRef.current = true
          if (r.top < 56 || r.bottom > vh - 56) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' })
            return
          }
        }
        setRect({ left: r.left, top: r.top, width: r.width, height: r.height })
        setMissing(false)
        if (vw <= 639) {
          setCard(null) // mobile: bottom sheet
          setMobile(true)
          return
        }
        setMobile(false)
        const cw = Math.min(CARD_W, vw - 24)
        const pad = 54
        const estH = 250
        const clampTop = (t: number) => Math.max(12, Math.min(t, vh - estH - 12))
        let left: number
        let top: number
        if (r.right + pad + cw + 12 <= vw) {
          left = r.right + pad
          top = clampTop(r.top - 8)
        } else if (r.left - pad - cw - 12 >= 0) {
          left = r.left - pad - cw
          top = clampTop(r.top - 8)
        } else if (r.bottom + pad + 230 <= vh) {
          left = Math.max(12, Math.min(r.left + r.width / 2 - cw / 2, vw - cw - 12))
          top = r.bottom + pad
        } else {
          left = Math.max(12, Math.min(r.left + r.width / 2 - cw / 2, vw - cw - 12))
          top = clampTop(r.top - pad - 230)
        }
        setCard({ left, top, width: cw })
        return
      }
      setRect(null)
      setCard(null)
      if (Date.now() - started > 9000) setMissing(true)
    }
    measure()
    const iv = window.setInterval(measure, 350)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearInterval(iv)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step, tick])

  const doQuickLogin = async () => {
    setLoggingIn(true)
    setLoginFailed(false)
    const ok = await onQuickLogin()
    setLoggingIn(false)
    if (ok) setTick((t) => t + 1)
    else setLoginFailed(true)
  }

  // ---- arrow geometry (desktop only) ----
  let arrow: { d: string } | null = null
  if (rect && card && !mobile) {
    const pad = 54
    const rectRight = rect.left + rect.width
    const rectBottom = rect.top + rect.height
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const cardRight = card.left + card.width
    let sx: number
    let sy: number
    let ex: number
    let ey: number
    const fromRight = card.left >= rectRight + pad - 10
    const fromLeft = cardRight <= rect.left - pad + 10
    if (fromRight) {
      sx = card.left - 2
      sy = card.top + 36
      ex = rectRight + 18
      ey = Math.min(Math.max(cy, rect.top + 12), rectBottom - 12)
    } else if (fromLeft) {
      sx = cardRight + 2
      sy = card.top + 36
      ex = rect.left - 18
      ey = Math.min(Math.max(cy, rect.top + 12), rectBottom - 12)
    } else if (card.top >= rectBottom) {
      sx = card.left + 56
      sy = card.top - 2
      ex = Math.min(Math.max(cx, rect.left + 20), rectRight - 20)
      ey = rectBottom + 18
    } else {
      sx = card.left + 56
      sy = card.top + 36
      ex = Math.min(Math.max(cx, rect.left + 20), rectRight - 20)
      ey = rect.top - 18
    }
    const mx = (sx + ex) / 2 + (Math.abs(ey - sy) > 60 ? (sx < ex ? -18 : 18) : 0)
    const my = (sy + ey) / 2 + (Math.abs(ex - sx) > 60 ? (sy < ey ? -14 : 14) : 0)
    arrow = { d: `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}` }
  }

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[2147483000]"
      role="dialog"
      aria-modal="true"
      aria-label={`Demo ${step.id}: ${step.name}`}
    >
      {/* dark backdrop with a transparent hole over the target */}
      {rect && (
        <div
          className="us-spotlight-hole"
          style={{ left: rect.left - 10, top: rect.top - 8, width: rect.width + 20, height: rect.height + 16 }}
        />
      )}

      {/* animated red ellipse around the target */}
      {rect && (
        <svg
          className="fixed"
          style={{ left: rect.left - 36, top: rect.top - 28, width: rect.width + 72, height: rect.height + 56 }}
          width={rect.width + 72}
          height={rect.height + 56}
          aria-hidden
        >
          <ellipse
            className="us-demo-ellipse-pulse"
            cx={(rect.width + 72) / 2}
            cy={(rect.height + 56) / 2}
            rx={rect.width / 2 + 24}
            ry={rect.height / 2 + 16}
            fill="rgba(220, 38, 38, 0.07)"
            stroke="none"
          />
          <ellipse
            className="us-demo-ellipse-draw"
            style={{ '--circ': '100' } as React.CSSProperties}
            cx={(rect.width + 72) / 2}
            cy={(rect.height + 56) / 2}
            rx={rect.width / 2 + 24}
            ry={rect.height / 2 + 16}
            fill="none"
            stroke={RED}
            strokeWidth="3.5"
            strokeLinecap="round"
            pathLength={100}
          />
        </svg>
      )}

      {/* animated red arrow from the card to the target */}
      {arrow && (
        <svg className="fixed inset-0 h-full w-full" aria-hidden>
          <defs>
            <marker id="us-demo-arrowhead" markerWidth="7.5" markerHeight="7.5" refX="5.75" refY="3.75" orient="auto">
              <path d="M0,0 L7.5,3.75 L0,7.5 Z" fill={RED} />
            </marker>
          </defs>
          <path
            className="us-demo-arrow-flow"
            d={arrow.d}
            fill="none"
            stroke={RED}
            strokeWidth="3"
            strokeLinecap="round"
            markerEnd="url(#us-demo-arrowhead)"
          />
        </svg>
      )}

      {/* the US card */}
      <div
        className={`pointer-events-auto us-demo-card-in fixed ${
          mobile ? 'inset-x-3 bottom-3' : ''
        }`}
        style={mobile ? undefined : card ? { left: card.left, top: card.top, width: card.width } : undefined}
        role="status"
      >
        <div className="overflow-hidden rounded-xl border-2 border-red-500/70 bg-card text-card-foreground shadow-2xl">
          <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-3 py-2 dark:border-red-900/60 dark:bg-red-950/50">
            <span className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">
              {step.id}
            </span>
            {step.sprint > 0 ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/60 dark:text-red-200">
                Sprint {step.sprint}
              </span>
            ) : (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/60 dark:text-violet-200">
                Demo mới
              </span>
            )}
            <span className="ml-auto text-[10px] font-medium text-muted-foreground">
              {index + 1}/{total}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Kết thúc demo"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          <div className="px-3 py-2.5">
            <h3 className="text-sm font-bold leading-snug">{step.name}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.vi}</p>

            {missing && step.hint && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                💡 {step.hint}
              </p>
            )}

            {step.requiresAdmin && !rect && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={doQuickLogin}
                  disabled={loggingIn}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
                >
                  {loggingIn ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : (
                    <LogIn className="h-3 w-3" aria-hidden />
                  )}
                  Đăng nhập nhanh (admin / admin123)
                </button>
                {loginFailed && (
                  <p className="mt-1 text-[11px] text-red-600">Đăng nhập thất bại — vui lòng thử lại.</p>
                )}
              </div>
            )}

            {step.prep === 'run' && (
              <button
                type="button"
                onClick={() => onEnsure(step)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-accent"
              >
                <RefreshCw className="h-3 w-3" aria-hidden /> Chạy lại phân tích mẫu
              </button>
            )}

            <div className="mt-2.5 flex items-center justify-between border-t pt-2">
              <button
                type="button"
                onClick={onPrev}
                className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Trước
              </button>
              <span className="text-[10px] text-muted-foreground">Esc đóng · ← → chuyển bước</span>
              <button
                type="button"
                onClick={onNext}
                className="inline-flex items-center gap-0.5 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-700"
              >
                {index + 1 === total ? 'Hoàn tất' : 'Tiếp'} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
