'use client'

// In-app documentation viewer (Deliverable #12 surface).
// Renders docs/*.md (pre-converted to HTML fragments in /docs/index.json by
// scripts/build_docs.py) and the auto-generated ERD diagram — so the
// documentation is visible from the Preview Panel without filesystem access.
//
// 28/10 (user review): chỉ giữ CSDL · TOPSIS · Tech stack · Lớp màu AQI ·
// Sơ đồ ERD (bỏ tabs Kiến trúc / Thay đổi / Tải xuống).

import { useEffect, useState } from 'react'
import {
  BookOpenText,
  ExternalLink,
  Loader2,
  Database,
  Layers,
  Network,
  Scale,
  Wind,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'

type DocKey = 'db' | 'tech-stack' | 'topsis' | 'aqi-color'

const DOC_LABELS: Record<DocKey, string> = {
  db: 'Thiết kế cơ sở dữ liệu',
  'tech-stack': 'Đối chiếu tech stack',
  topsis: 'Mô hình chấm điểm TOPSIS',
  'aqi-color': 'Lớp màu AQI',
}

const DOCS_STYLING = [
  '[&_h1]:mt-1 [&_h1]:mb-4 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:tracking-tight',
  '[&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:pb-1.5 [&_h2]:text-base [&_h2]:font-bold [&_h2]:tracking-tight',
  '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-[15px] [&_h3]:font-semibold',
  '[&_p]:my-2.5 [&_p]:text-sm [&_p]:leading-relaxed',
  '[&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6',
  '[&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6',
  '[&_li]:text-sm [&_li]:leading-relaxed',
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px]',
  '[&_th]:border [&_th]:bg-muted/70 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold',
  '[&_td]:border [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12.5px]',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-muted/60 [&_pre]:p-3 [&_pre]:text-[11.5px] [&_pre]:leading-relaxed',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:bg-muted/50 [&_blockquote]:px-3 [&_blockquote]:py-1 [&_blockquote]:text-sm',
  '[&_hr]:my-5 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_strong]:font-semibold',
].join(' ')

interface DocsPayload {
  db: string
  'tech-stack': string
  topsis: string
  'aqi-color': string
}

export function DocsViewer({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [docs, setDocs] = useState<DocsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || docs || error) return
    let cancelled = false
    fetch('/docs/index.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: DocsPayload) => {
        if (!cancelled) setDocs(data)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed')
      })
    return () => {
      cancelled = true
    }
  }, [open, docs, error])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] w-[95vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
        <DialogHeader className="border-b px-5 pb-3 pt-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpenText className="h-4.5 w-4.5 text-primary" aria-hidden />
            Tài liệu hệ thống — RideShift (C1SE.48)
          </DialogTitle>
          <DialogDescription className="text-xs">
            Thiết kế cơ sở dữ liệu 28 bảng (DB FINAL v1.1), sơ đồ ERD và đối
            chiếu tech stack so với proposal.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="db" className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-4 py-2">
            <TabsList className="h-8 flex-wrap">
              <TabsTrigger value="db" className="gap-1.5 text-xs">
                <Database className="h-3.5 w-3.5" aria-hidden /> CSDL
              </TabsTrigger>
              <TabsTrigger value="topsis" className="gap-1.5 text-xs">
                <Scale className="h-3.5 w-3.5" aria-hidden /> TOPSIS
              </TabsTrigger>
              <TabsTrigger value="tech-stack" className="gap-1.5 text-xs">
                <Layers className="h-3.5 w-3.5" aria-hidden /> Tech stack
              </TabsTrigger>
              <TabsTrigger value="aqi-color" className="gap-1.5 text-xs">
                <Wind className="h-3.5 w-3.5" aria-hidden /> Lớp màu AQI
              </TabsTrigger>
              <TabsTrigger value="erd" className="gap-1.5 text-xs">
                <Network className="h-3.5 w-3.5" aria-hidden /> Sơ đồ ERD
              </TabsTrigger>
            </TabsList>
          </div>

          {(['db', 'topsis', 'tech-stack', 'aqi-color'] as DocKey[]).map((key) => (
            <TabsContent
              key={key}
              value={key}
              className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 py-4"
            >
              {!docs && !error && (
                <div className="flex h-40 items-center justify-center text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Đang tải tài liệu…
                </div>
              )}
              {error && (
                <div className="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  Không tải được tài liệu ({error}).
                </div>
              )}
              {docs && (
                <div className={DOCS_STYLING}>
                  <article
                    // Pre-converted from our own docs/*.md by scripts/build_docs.py
                    dangerouslySetInnerHTML={{ __html: docs[key] }}
                  />
                </div>
              )}
            </TabsContent>
          ))}

          <TabsContent value="erd" className="mt-0 min-h-0 flex-1 overflow-auto p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                ERD <strong>28 bảng · 6 schema + public.City</strong> (DB FINAL
                v1.1) — sinh tự động từ <code>app/schema.sql</code> nên luôn
                khớp DB thật: PK in đậm, FK in nghiêng, mũi tên chỉ bảng được
                tham chiếu.
              </p>
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href="/docs/db-erd.svg" target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Mở bản
                  đầy đủ
                </a>
              </Button>
            </div>
            <img
              src="/docs/db-erd.svg"
              alt="Sơ đồ ERD RideShift — 28 bảng trong 6 schema PostgreSQL (DB FINAL v1.1), sinh tự động từ schema.sql"
              className="w-full rounded-lg border bg-white shadow-sm"
              loading="lazy"
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

export default DocsViewer
