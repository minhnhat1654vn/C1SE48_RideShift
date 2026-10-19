'use client'

// Task 41/42 — "Demo US" tab: the feature gallery that maps every approved
// User Story (3_C1SE48_UserStory_v2.0.docx — 41 US, Sprint 1→6) to the place
// it lives in the UI. Clicking a card (or starting the guided tour) switches
// to the right tab, triggers the demo actions if needed and circles the
// feature with a red ellipse + red arrow labeled with the US id.

import { useMemo } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardList,
  FileText,
  ListChecks,
  Play,
  ShieldCheck,
} from 'lucide-react'
import { SPRINT_LABELS, US_STEPS } from './us-steps'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function UsDemoTab({ onStart }: { onStart: (index: number) => void }) {
  const groups = useMemo(() => {
    const map = new Map<number, { step: (typeof US_STEPS)[number]; index: number }[]>()
    US_STEPS.forEach((step, index) => {
      const arr = map.get(step.sprint) ?? []
      arr.push({ step, index })
      map.set(step.sprint, arr)
    })
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [])

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* ---------------- intro ---------------- */}
      <Card className="border-primary/25">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListChecks className="h-5 w-5 text-primary" aria-hidden />
            Demo chức năng theo User Story
          </CardTitle>
          <CardDescription className="leading-relaxed">
            Bản demo đối chiếu <b>41 User Story đã được duyệt</b> trong tài liệu{' '}
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <FileText className="h-3.5 w-3.5" aria-hidden /> 3_C1SE48_UserStory_v2.0.docx
            </span>{' '}
            (bản 2.0 — mở rộng lên 41 US, US-01 → US-41) với giao diện RideShift đã triển khai. Chọn
            một US để hệ thống <b>chuyển đúng tab, khoanh tròn đỏ</b> chức năng tương ứng và{' '}
            <b>chỉ mũi tên đỏ</b> kèm tên US. Hoặc bấm tour để đi tuần tự tất cả các bước.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button onClick={() => onStart(0)} className="gap-1.5">
            <Play className="h-4 w-4" aria-hidden /> Bắt đầu tour {US_STEPS.length} bước
          </Button>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CircleDot className="h-3.5 w-3.5" aria-hidden /> Điều hướng bằng ← → , Esc để đóng
          </span>
        </CardContent>
      </Card>

      {/* ---------------- US gallery grouped by sprint ---------------- */}
      {groups.map(([sprint, items]) => (
        <section key={sprint} aria-label={SPRINT_LABELS[sprint]} className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            {sprint === 6 ? (
              <ShieldCheck className="h-4 w-4" aria-hidden />
            ) : (
              <ClipboardList className="h-4 w-4" aria-hidden />
            )}
            {SPRINT_LABELS[sprint]}
            <span className="text-xs font-normal normal-case">({items.length} US)</span>
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map(({ step, index }) => (
              <button
                key={step.id}
                type="button"
                onClick={() => onStart(index)}
                className="group flex items-start gap-2.5 rounded-xl border bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-red-300 hover:shadow-md"
              >
                <span
                  className={`mt-0.5 flex h-7 shrink-0 items-center justify-center rounded-md px-1.5 text-[10px] font-bold ${
                    step.sprint === 0 ? 'bg-violet-600 text-white' : 'bg-red-600 text-white'
                  }`}
                >
                  {step.id}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold leading-snug">
                    {step.name}
                    <CheckCircle2
                      className="h-3.5 w-3.5 shrink-0 text-emerald-600"
                      aria-label="Đã triển khai"
                    />
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-muted-foreground">
                    {step.vi}
                  </span>
                </span>
                <ChevronRight
                  className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-red-600"
                  aria-hidden
                />
              </button>
            ))}
          </div>
        </section>
      ))}

      {/* ---------------- legend ---------------- */}
      <p className="pb-2 text-center text-xs text-muted-foreground">
        <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-600" aria-hidden />
        Tất cả 41 US của tài liệu User Story v2.0 đều đã triển khai trong sản phẩm — bản demo chỉ
        dẫn tới đúng chỗ chức năng đó xuất hiện. Dữ liệu User Story:
        3_C1SE48_UserStory_v2.0.docx (Version 2.0, 01/10/2026 — đã duyệt, Sprint 1–6).
      </p>
    </div>
  )
}
