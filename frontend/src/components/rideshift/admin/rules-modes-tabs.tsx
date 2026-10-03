'use client'

// Policy Rules + Modes & Weights admin tabs — Task 3-b (RideShift, C1SE.48)
// Phase C "Bảng quản trị hiện đại" (Task 36-C): toolbar (search + filters +
// primary action), unified status pills, row actions collapsed into a "⋯"
// dropdown menu, rule editing moved into a right-side Sheet, client-side
// pagination (10 rows/page) and dedicated empty states.
//
// RulesTab        — US-23 (view rules table), US-24 (create rule via dialog),
//                   US-32 (activate/deactivate with confirmation, delete rules,
//                   edit rule details via PUT /api/admin/rules/:id).
// ModesWeightsTab — US-33 (enable/disable transport modes, add and edit modes
//                   via the upsert PUT /api/admin/modes, view parameters),
//                   US-34 (edit the 7 TOPSIS criteria weights, must total 100%).

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { apiFetch } from '@/lib/api'
import {
  Bike,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  ScrollText,
  Search,
  SearchX,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { LezZoneDto, ModeInfo, PolicyRuleDto } from '@/lib/types'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

// Small JSON fetch helper with consistent error extraction (server returns { error }).
async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `Yêu cầu thất bại (mã trạng thái ${res.status}).`
    throw new Error(msg)
  }
  return data as T
}

const SCROLLBAR_CLASS =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-emerald-300/50 [&::-webkit-scrollbar-track]:bg-transparent'

// Rows per page for the client-side pagination.
const PAGE_SIZE = 10

/* ---------------------------------------------------------------------
 * Unified status pills — same color language across the whole admin UI.
 * ------------------------------------------------------------------- */
const PILL_ACTIVE =
  'border border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
const PILL_INACTIVE =
  'border border-zinc-200 bg-zinc-100 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400'
const PILL_BANNED =
  'border border-red-200 bg-red-100 text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-300'
const PILL_CONDITIONAL =
  'border border-amber-200 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'

/* ---------------------------------------------------------------------
 * Local UI helpers (pagination + empty states) shared by the two tabs.
 * ------------------------------------------------------------------- */

type TablePaginationProps = {
  page: number
  pageCount: number
  total: number
  from: number
  to: number
  onPageChange: (page: number) => void
}

/** Bottom bar: "‹ 1/3 ›" + "Hiển thị 1–10 / 27". Only rendered when > 1 page. */
function TablePagination({ page, pageCount, total, from, to, onPageChange }: TablePaginationProps) {
  if (pageCount <= 1) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <p className="text-xs text-muted-foreground tabular-nums">
        Hiển thị {from}–{to} / {total}
      </p>
      <div className="flex items-center gap-1" role="navigation" aria-label="Phân trang">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Trang trước"
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-12 text-center text-sm tabular-nums">
          {page}/{pageCount}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          aria-label="Trang sau"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}

/** Empty list (no data at all): dashed block + icon + CTA. */
function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
        {icon}
      </div>
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  )
}

/** Empty list after filtering: message + "Xóa lọc" button. */
function NoMatchState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <SearchX className="size-6" />
      </div>
      <p className="font-medium">Không tìm thấy mục nào khớp</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Không có mục nào khớp với từ khóa hoặc bộ lọc hiện tại — thử từ khóa khác.
      </p>
      <Button variant="outline" size="sm" onClick={onClear}>
        <X /> Xóa lọc
      </Button>
    </div>
  )
}

const DAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

// Display-only Vietnamese day labels — DB payloads keep the English DAY_OPTIONS keys.
const DAY_LABELS: Record<string, string> = {
  Mon: 'T2',
  Tue: 'T3',
  Wed: 'T4',
  Thu: 'T5',
  Fri: 'T6',
  Sat: 'T7',
  Sun: 'CN',
}

/** Compact display for the `days` column, e.g. "Mon,Tue,Wed" → "T2, T3, T4" or "Mỗi ngày". */
function formatDays(days: string): string {
  const parts = days
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length >= 7) return 'Mỗi ngày'
  return parts.map((d) => DAY_LABELS[d] ?? d).join(', ')
}

const fmtVnd = (v: number): string => `${v.toLocaleString('vi-VN')} ₫`

/* =====================================================================
 * Policy Rules tab — US-23, US-24, US-32
 * ===================================================================== */

type RulesTabProps = {
  zones: LezZoneDto[]
  modes: ModeInfo[]
}

export function RulesTab({ zones, modes }: RulesTabProps) {
  const [rules, setRules] = useState<PolicyRuleDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null)

  // ---- toolbar state (Phase C) ----
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'banned' | 'conditional'>('all')
  const [zoneFilter, setZoneFilter] = useState<string>('all')
  const [page, setPage] = useState(1)

  // ---- US-24: add-rule dialog (controlled so the empty state can open it) ----
  const [addRuleOpen, setAddRuleOpen] = useState(false)

  // ---- US-32: edit rule details, now in a right-side Sheet ----
  const [editingRule, setEditingRule] = useState<PolicyRuleDto | null>(null)
  const [editType, setEditType] = useState<'banned' | 'conditional'>('banned')
  const [editCondition, setEditCondition] = useState('')
  const [editStart, setEditStart] = useState('06:00')
  const [editEnd, setEditEnd] = useState('22:00')
  const [editDays, setEditDays] = useState<string[]>([])
  const [editActive, setEditActive] = useState(true)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // US-32: rule awaiting deactivation confirmation (null = no dialog).
  const [deactivateRule, setDeactivateRule] = useState<PolicyRuleDto | null>(null)
  // US-32: rule awaiting delete confirmation (opened from the ⋯ menu).
  const [deleteRuleTarget, setDeleteRuleTarget] = useState<PolicyRuleDto | null>(null)

  const loadRules = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await apiJson<{ rules: PolicyRuleDto[] }>('/api/admin/rules')
      setRules(d.rules)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách quy định.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRules()
  }, [loadRules])

  const zoneName = useCallback(
    (id: string) => zones.find((z) => z.id === id)?.name ?? id,
    [zones]
  )
  const modeName = useCallback(
    (id: string) => modes.find((m) => m.id === id)?.name ?? id,
    [modes]
  )

  // ---- Phase C: search + filters + pagination (client-side) ----
  const query = search.trim().toLowerCase()
  const filtering = query !== '' || typeFilter !== 'all' || zoneFilter !== 'all'
  const filteredRules = useMemo(() => {
    return rules.filter((rule) => {
      const matchQuery =
        query === '' ||
        zoneName(rule.zoneId).toLowerCase().includes(query) ||
        modeName(rule.modeId).toLowerCase().includes(query) ||
        (rule.condition ?? '').toLowerCase().includes(query)
      const matchType = typeFilter === 'all' || rule.restrictionType === typeFilter
      const matchZone = zoneFilter === 'all' || rule.zoneId === zoneFilter
      return matchQuery && matchType && matchZone
    })
  }, [rules, query, typeFilter, zoneFilter, zoneName, modeName])

  const rulePageCount = Math.max(1, Math.ceil(filteredRules.length / PAGE_SIZE))
  const safePage = Math.min(page, rulePageCount)
  const pageRules = filteredRules.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Reset to page 1 whenever the search/filter changes.
  useEffect(() => {
    setPage(1)
  }, [query, typeFilter, zoneFilter])

  // US-32: toggle a rule on/off (PUT active).
  const toggleRule = async (rule: PolicyRuleDto, next: boolean) => {
    setBusyRuleId(rule.id)
    setError(null)
    try {
      const d = await apiJson<{ rule: PolicyRuleDto }>(`/api/admin/rules/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: next }),
      })
      setRules((prev) => prev.map((r) => (r.id === d.rule.id ? d.rule : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật quy định.')
    } finally {
      setBusyRuleId(null)
    }
  }

  // US-32: delete a rule (confirmed via controlled AlertDialog).
  const deleteRule = async (rule: PolicyRuleDto) => {
    setBusyRuleId(rule.id)
    setError(null)
    try {
      await apiJson<{ ok: boolean }>(`/api/admin/rules/${rule.id}`, { method: 'DELETE' })
      setRules((prev) => prev.filter((r) => r.id !== rule.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa quy định.')
    } finally {
      setBusyRuleId(null)
    }
  }

  // US-32: open the edit Sheet prefilled with the rule's current values.
  const openEditRule = (rule: PolicyRuleDto) => {
    setEditingRule(rule)
    setEditType(rule.restrictionType)
    setEditCondition(rule.condition ?? '')
    setEditStart(rule.startTime)
    setEditEnd(rule.endTime)
    setEditDays(
      rule.days
        .split(',')
        .map((s) => s.trim())
        .filter((d) => (DAY_OPTIONS as readonly string[]).includes(d))
    )
    setEditActive(rule.active)
    setEditError(null)
  }

  const toggleEditDay = (d: string) =>
    setEditDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  // US-32: save edited details (PUT /api/admin/rules/:id — partial patch on the server).
  const saveEdit = async () => {
    if (!editingRule) return
    if (editDays.length === 0) {
      setEditError('Vui lòng chọn ít nhất một ngày trong tuần.')
      return
    }
    setSavingEdit(true)
    setEditError(null)
    try {
      const d = await apiJson<{ rule: PolicyRuleDto }>(`/api/admin/rules/${editingRule.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          restrictionType: editType,
          condition: editCondition.trim() || null,
          startTime: editStart,
          endTime: editEnd,
          days: DAY_OPTIONS.filter((d) => editDays.includes(d)).join(','),
          active: editActive,
        }),
      })
      setRules((prev) => prev.map((r) => (r.id === d.rule.id ? d.rule : r)))
      setEditingRule(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Không thể cập nhật quy định.')
    } finally {
      setSavingEdit(false)
    }
  }

  const clearFilters = () => {
    setSearch('')
    setTypeFilter('all')
    setZoneFilter('all')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="size-4 text-emerald-600" />
          Quy định
        </CardTitle>
        <CardDescription>
          Hạn chế phương tiện theo từng vùng LEZ (US-23). Phương tiện bị cấm không bao giờ được
          đề xuất trong vùng; quy định có điều kiện chỉ áp dụng trong khung giờ và ngày đã chọn.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* ---- toolbar: search + filters + primary action ---- */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:min-w-44">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo vùng, phương tiện hoặc điều kiện…"
                className="h-9 pl-8"
                aria-label="Tìm kiếm quy định"
              />
            </div>
            <Select
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v === 'banned' ? 'banned' : v === 'conditional' ? 'conditional' : 'all')}
            >
              <SelectTrigger className="h-9 w-full sm:w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Loại: Tất cả</SelectItem>
                <SelectItem value="banned">Loại: Cấm</SelectItem>
                <SelectItem value="conditional">Loại: Có điều kiện</SelectItem>
              </SelectContent>
            </Select>
            <Select value={zoneFilter} onValueChange={setZoneFilter}>
              <SelectTrigger className="h-9 w-full sm:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vùng: Tất cả</SelectItem>
                {zones.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadRules()} disabled={loading}>
              <RefreshCw /> Làm mới
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => setAddRuleOpen(true)}
            >
              <Plus /> Thêm quy định
            </Button>
          </div>
        </div>
        {filtering && filteredRules.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Hiển thị {filteredRules.length}/{rules.length} mục
          </p>
        )}

        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
            <TriangleAlert className="size-4 shrink-0" /> {error}
          </p>
        )}

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rules.length === 0 ? (
          /* ---- empty state: no rules at all ---- */
          <EmptyState
            icon={<ScrollText className="size-6" />}
            title="Chưa có quy định nào"
            description="Dùng “Thêm quy định” để hạn chế một loại phương tiện trong vùng LEZ. Trình tư vấn sẽ tuân theo các quy định này khi xếp hạng đề xuất."
            action={
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => setAddRuleOpen(true)}
              >
                <Plus /> Thêm quy định đầu tiên
              </Button>
            }
          />
        ) : filteredRules.length === 0 ? (
          /* ---- empty state: filters matched nothing ---- */
          <NoMatchState onClear={clearFilters} />
        ) : (
          <>
            <div className={`max-h-[520px] overflow-y-auto rounded-md border ${SCROLLBAR_CLASS}`}>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>Vùng</TableHead>
                    <TableHead>Phương tiện</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead>Điều kiện</TableHead>
                    <TableHead>Khung giờ</TableHead>
                    <TableHead>Ngày áp dụng</TableHead>
                    <TableHead className="text-center">Bật/tắt</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Thao tác</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="max-w-[180px] truncate font-medium" title={zoneName(rule.zoneId)}>
                        {zoneName(rule.zoneId)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{modeName(rule.modeId)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {rule.restrictionType === 'banned' ? (
                            <Badge className={PILL_BANNED}>Cấm</Badge>
                          ) : (
                            <Badge className={PILL_CONDITIONAL}>Có điều kiện</Badge>
                          )}
                          {!rule.active && (
                            <Badge className={`${PILL_INACTIVE} px-1.5 text-[11px]`}>Tạm tắt</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        {rule.condition ? (
                          <span className="line-clamp-2 text-xs text-muted-foreground" title={rule.condition}>
                            {rule.condition}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {rule.startTime}–{rule.endTime}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDays(rule.days)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={rule.active}
                          disabled={busyRuleId === rule.id}
                          onCheckedChange={(v) => {
                            // US-32: switching OFF asks for confirmation first;
                            // switching ON is immediate.
                            if (v) void toggleRule(rule, true)
                            else setDeactivateRule(rule)
                          }}
                          aria-label={`Bật/tắt quy định cho ${modeName(rule.modeId)} tại ${zoneName(rule.zoneId)}`}
                        />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              disabled={busyRuleId === rule.id}
                              aria-label={`Thao tác với quy định cho ${modeName(rule.modeId)}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openEditRule(rule)}>
                              <Pencil /> Sửa
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setDeleteRuleTarget(rule)}
                            >
                              <Trash2 /> Xóa
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <TablePagination
              page={safePage}
              pageCount={rulePageCount}
              total={filteredRules.length}
              from={(safePage - 1) * PAGE_SIZE + 1}
              to={Math.min(safePage * PAGE_SIZE, filteredRules.length)}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>

      {/* ---------------- US-24: add-rule dialog (controlled) ---------------- */}
      <AddRuleDialog
        zones={zones}
        modes={modes}
        onCreated={(rule) => setRules((prev) => [...prev, rule])}
        open={addRuleOpen}
        onOpenChange={setAddRuleOpen}
      />

      {/* ---------------- US-32: edit-rule right-side Sheet ---------------- */}
      <Sheet
        open={editingRule !== null}
        onOpenChange={(open) => {
          if (!open) setEditingRule(null)
        }}
      >
        <SheetContent side="right" className="flex flex-col gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Sửa quy định</SheetTitle>
            <SheetDescription>
              Cập nhật loại hạn chế, khung giờ, ngày áp dụng và trạng thái của quy định (US-32).
            </SheetDescription>
          </SheetHeader>
          {editingRule && (
            <>
              <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
                <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Vùng LEZ</p>
                    <p className="truncate text-sm font-medium" title={zoneName(editingRule.zoneId)}>
                      {zoneName(editingRule.zoneId)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Phương tiện</p>
                    <p className="truncate text-sm font-medium" title={modeName(editingRule.modeId)}>
                      {modeName(editingRule.modeId)}
                    </p>
                  </div>
                  <p className="col-span-2 text-xs text-muted-foreground">
                    Vùng và phương tiện không thể thay đổi sau khi tạo quy định.
                  </p>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="rule-edit-type">Loại hạn chế</Label>
                  <Select
                    value={editType}
                    onValueChange={(v) => setEditType(v === 'conditional' ? 'conditional' : 'banned')}
                  >
                    <SelectTrigger id="rule-edit-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="banned">Cấm (luôn bị hạn chế)</SelectItem>
                      <SelectItem value="conditional">Có điều kiện (theo giờ / điều kiện)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="rule-edit-condition">
                    Điều kiện{' '}
                    <span className="font-normal text-muted-foreground">
                      (dùng cho quy định có điều kiện)
                    </span>
                  </Label>
                  <Textarea
                    id="rule-edit-condition"
                    rows={2}
                    value={editCondition}
                    onChange={(e) => setEditCondition(e.target.value)}
                    placeholder={
                      editType === 'conditional'
                        ? 'VD: Chỉ áp dụng cho xe giao nhận có động cơ Euro 4 trở lên'
                        : 'Không bắt buộc — để trống nếu cấm hoàn toàn'
                    }
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="rule-edit-start">Bắt đầu</Label>
                    <Input
                      id="rule-edit-start"
                      type="time"
                      value={editStart}
                      onChange={(e) => setEditStart(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="rule-edit-end">Kết thúc</Label>
                    <Input
                      id="rule-edit-end"
                      type="time"
                      value={editEnd}
                      onChange={(e) => setEditEnd(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label>Ngày áp dụng</Label>
                  <div className="flex flex-wrap gap-2">
                    {DAY_OPTIONS.map((d) => {
                      const checked = editDays.includes(d)
                      return (
                        <Label
                          key={d}
                          className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-normal has-data-[state=checked]:border-emerald-600 has-data-[state=checked]:bg-emerald-50 has-data-[state=checked]:text-emerald-800 dark:has-data-[state=checked]:bg-emerald-950 dark:has-data-[state=checked]:text-emerald-300"
                        >
                          <Checkbox checked={checked} onCheckedChange={() => toggleEditDay(d)} />
                          {DAY_LABELS[d] ?? d}
                        </Label>
                      )
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <Label htmlFor="rule-edit-active" className="text-sm">
                      Quy định đang hoạt động
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Quy định không hoạt động sẽ bị trình tư vấn bỏ qua.
                    </p>
                  </div>
                  <Switch id="rule-edit-active" checked={editActive} onCheckedChange={setEditActive} />
                </div>

                {editError && (
                  <p role="alert" className="text-sm text-destructive">
                    {editError}
                  </p>
                )}
              </div>
              <SheetFooter className="border-t">
                <Button variant="outline" onClick={() => setEditingRule(null)} disabled={savingEdit}>
                  <X /> Hủy
                </Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => void saveEdit()}
                  disabled={savingEdit}
                >
                  {savingEdit ? <Loader2 className="animate-spin" /> : <Save />} Lưu thay đổi
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ---------------- US-32: deactivate-rule confirmation ---------------- */}
      <AlertDialog
        open={deactivateRule !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivateRule(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vô hiệu hóa quy định này?</AlertDialogTitle>
            <AlertDialogDescription>
              Quy định bị vô hiệu hóa sẽ không được dùng để kiểm tra tuân thủ nhưng vẫn được giữ
              để tham chiếu.
              {deactivateRule
                ? ` ${modeName(deactivateRule.modeId)} sẽ không còn bị hạn chế tại ${zoneName(
                    deactivateRule.zoneId
                  )} trong khi quy định này không hoạt động.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deactivateRule) void toggleRule(deactivateRule, false)
                setDeactivateRule(null)
              }}
            >
              Vô hiệu hóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------------- US-32: delete-rule confirmation (from ⋯ menu) ---------------- */}
      <AlertDialog
        open={deleteRuleTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteRuleTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa quy định này?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRuleTarget
                ? `${modeName(deleteRuleTarget.modeId)} sẽ không còn bị hạn chế tại ${zoneName(
                    deleteRuleTarget.zoneId
                  )} trong khung ${deleteRuleTarget.startTime}–${deleteRuleTarget.endTime} (${formatDays(deleteRuleTarget.days)}).`
                : 'Quy định sẽ bị xóa vĩnh viễn.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleteRuleTarget) void deleteRule(deleteRuleTarget)
                setDeleteRuleTarget(null)
              }}
            >
              Xóa quy định
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

/* ---------------------------------------------------------------------
 * Add-rule dialog — US-24 (controlled: open/onOpenChange owned by RulesTab
 * so both the toolbar button and the empty state can open it).
 * ------------------------------------------------------------------- */

type AddRuleDialogProps = {
  zones: LezZoneDto[]
  modes: ModeInfo[]
  onCreated: (rule: PolicyRuleDto) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

function AddRuleDialog({ zones, modes, onCreated, open, onOpenChange }: AddRuleDialogProps) {
  const [zoneId, setZoneId] = useState('')
  const [modeId, setModeId] = useState('')
  const [restrictionType, setRestrictionType] = useState<'banned' | 'conditional'>('banned')
  const [condition, setCondition] = useState('')
  const [startTime, setStartTime] = useState('06:00')
  const [endTime, setEndTime] = useState('22:00')
  const [days, setDays] = useState<string[]>([])
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const toggleDay = (d: string) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  const resetForm = () => {
    setZoneId('')
    setModeId('')
    setRestrictionType('banned')
    setCondition('')
    setStartTime('06:00')
    setEndTime('22:00')
    setDays([])
    setActive(true)
    setFormError(null)
  }

  const submit = async () => {
    if (!zoneId || !modeId) {
      setFormError('Vui lòng chọn vùng và loại phương tiện.')
      return
    }
    if (days.length === 0) {
      setFormError('Vui lòng chọn ít nhất một ngày trong tuần.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const d = await apiJson<{ rule: PolicyRuleDto }>('/api/admin/rules', {
        method: 'POST',
        body: JSON.stringify({
          zoneId,
          modeId,
          restrictionType,
          condition: condition.trim() || null,
          startTime,
          endTime,
          days: DAY_OPTIONS.filter((d) => days.includes(d)).join(','),
          active,
        }),
      })
      onCreated(d.rule)
      onOpenChange(false)
      resetForm()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Không thể tạo quy định.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) resetForm()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Thêm quy định</DialogTitle>
          <DialogDescription>
            Hạn chế một loại phương tiện trong vùng LEZ (US-24). Trình tư vấn sẽ tuân theo quy
            định này khi xếp hạng các đề xuất.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="rule-zone">Vùng LEZ</Label>
            <Select value={zoneId} onValueChange={setZoneId}>
              <SelectTrigger id="rule-zone" className="w-full">
                <SelectValue placeholder={zones.length ? 'Chọn vùng' : 'Không có vùng nào'} />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="rule-mode">Loại phương tiện</Label>
            <Select value={modeId} onValueChange={setModeId}>
              <SelectTrigger id="rule-mode" className="w-full">
                <SelectValue placeholder="Chọn phương tiện" />
              </SelectTrigger>
              <SelectContent>
                {modes.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="rule-type">Loại hạn chế</Label>
            <Select
              value={restrictionType}
              onValueChange={(v) => setRestrictionType(v === 'conditional' ? 'conditional' : 'banned')}
            >
              <SelectTrigger id="rule-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="banned">Cấm (luôn bị hạn chế)</SelectItem>
                <SelectItem value="conditional">Có điều kiện (theo giờ / điều kiện)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="rule-condition">
              Điều kiện{' '}
              <span className="font-normal text-muted-foreground">
                (dùng cho quy định có điều kiện)
              </span>
            </Label>
            <Textarea
              id="rule-condition"
              rows={2}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder={
                restrictionType === 'conditional'
                  ? 'VD: Chỉ áp dụng cho xe giao nhận có động cơ Euro 4 trở lên'
                  : 'Không bắt buộc — để trống nếu cấm hoàn toàn'
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="rule-start">Bắt đầu</Label>
              <Input
                id="rule-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rule-end">Kết thúc</Label>
              <Input
                id="rule-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Ngày áp dụng</Label>
            <div className="flex flex-wrap gap-2">
              {DAY_OPTIONS.map((d) => {
                const checked = days.includes(d)
                return (
                  <Label
                    key={d}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-normal has-data-[state=checked]:border-emerald-600 has-data-[state=checked]:bg-emerald-50 has-data-[state=checked]:text-emerald-800 dark:has-data-[state=checked]:bg-emerald-950 dark:has-data-[state=checked]:text-emerald-300"
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggleDay(d)} />
                    {DAY_LABELS[d] ?? d}
                  </Label>
                )
              })}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="rule-active" className="text-sm">
                Quy định đang hoạt động
              </Label>
              <p className="text-xs text-muted-foreground">Quy định không hoạt động sẽ bị trình tư vấn bỏ qua.</p>
            </div>
            <Switch id="rule-active" checked={active} onCheckedChange={setActive} />
          </div>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Hủy
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Plus />} Tạo quy định
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* =====================================================================
 * Modes & Weights tab — US-33, US-34
 * ===================================================================== */

type WeightRow = { criterion: string; weight: number; label: string }

// Display-only Vietnamese labels for the 7 TOPSIS criteria. The server may
// return the raw criterion key as `label` — display text only; the criterion
// keys and the PUT payload stay unchanged.
const CRITERIA_LABELS: Record<string, string> = {
  travelTime: 'Thời gian di chuyển',
  cost: 'Chi phí',
  lezCompliance: 'Tuân thủ LEZ',
  accessibility: 'Khả năng tiếp cận',
  convenience: 'Thuận tiện',
  environment: 'Môi trường',
  trend: 'Xu hướng khảo sát',
}

const criterionLabel = (criterion: string, fallback: string): string =>
  CRITERIA_LABELS[criterion] ?? fallback

type ModesWeightsTabProps = {
  /** Called after a mode is created/updated so the parent can refresh its
   * mode catalogue (used by the Overview tables and the Rules tab). */
  onModesChanged?: () => void
}

export function ModesWeightsTab({ onModesChanged }: ModesWeightsTabProps) {
  // ---- modes (US-33) ----
  const [modes, setModes] = useState<ModeInfo[]>([])
  const [modesLoading, setModesLoading] = useState(true)
  const [modesError, setModesError] = useState<string | null>(null)
  const [busyModeId, setBusyModeId] = useState<string | null>(null)

  // ---- US-33: add/edit mode dialog ----
  const [modeDialogOpen, setModeDialogOpen] = useState(false)
  const [editingMode, setEditingMode] = useState<ModeInfo | null>(null)

  // ---- toolbar state (Phase C) ----
  const [modeSearch, setModeSearch] = useState('')
  const [modePage, setModePage] = useState(1)

  // ---- weights (US-34) ----
  const [weights, setWeights] = useState<WeightRow[]>([])
  const [draft, setDraft] = useState<Record<string, number>>({})
  const [weightsLoading, setWeightsLoading] = useState(true)
  const [weightsError, setWeightsError] = useState<string | null>(null)
  const [weightsSaved, setWeightsSaved] = useState<string | null>(null)
  const [savingWeights, setSavingWeights] = useState(false)

  const loadAll = useCallback(async () => {
    setModesLoading(true)
    setWeightsLoading(true)
    setModesError(null)
    setWeightsError(null)
    setWeightsSaved(null)
    try {
      const d = await apiJson<{ modes: ModeInfo[] }>('/api/admin/modes')
      setModes(d.modes)
    } catch (err) {
      setModesError(err instanceof Error ? err.message : 'Không thể tải danh sách phương tiện.')
    } finally {
      setModesLoading(false)
    }
    try {
      const d = await apiJson<{ weights: WeightRow[] }>('/api/admin/weights')
      setWeights(d.weights)
      setDraft(Object.fromEntries(d.weights.map((w) => [w.criterion, w.weight])))
    } catch (err) {
      setWeightsError(err instanceof Error ? err.message : 'Không thể tải trọng số các tiêu chí.')
    } finally {
      setWeightsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  // ---- Phase C: mode search + pagination (client-side) ----
  const modeQuery = modeSearch.trim().toLowerCase()
  const modeFiltering = modeQuery !== ''
  const filteredModes = useMemo(() => {
    return modes.filter((m) => {
      return (
        modeQuery === '' ||
        m.name.toLowerCase().includes(modeQuery) ||
        m.id.toLowerCase().includes(modeQuery)
      )
    })
  }, [modes, modeQuery])

  const modePageCount = Math.max(1, Math.ceil(filteredModes.length / PAGE_SIZE))
  const safeModePage = Math.min(modePage, modePageCount)
  const pageModes = filteredModes.slice((safeModePage - 1) * PAGE_SIZE, safeModePage * PAGE_SIZE)

  // Reset to page 1 whenever the search changes.
  useEffect(() => {
    setModePage(1)
  }, [modeQuery])

  const total = useMemo(
    () => Object.values(draft).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0),
    [draft]
  )
  const totalOk = Math.abs(total - 100) < 0.01

  const setWeight = (criterion: string, value: number) => {
    setWeightsSaved(null)
    setDraft((prev) => ({ ...prev, [criterion]: Math.max(0, Math.min(50, Math.round(value))) }))
  }

  // US-34: client-side sum check + server-side validation (400 handled inline).
  const saveWeights = async () => {
    if (!totalOk) {
      setWeightsError(
        `Tổng trọng số phải bằng 100%. Tổng hiện tại: ${total.toFixed(0)}%. Hãy điều chỉnh các thanh trượt rồi thử lại.`
      )
      return
    }
    setSavingWeights(true)
    setWeightsError(null)
    setWeightsSaved(null)
    try {
      const payload = weights.map((w) => ({
        criterion: w.criterion,
        weight: draft[w.criterion] ?? w.weight,
      }))
      const d = await apiJson<{ weights: WeightRow[] }>('/api/admin/weights', {
        method: 'PUT',
        body: JSON.stringify({ weights: payload }),
      })
      setWeights(d.weights)
      setDraft(Object.fromEntries(d.weights.map((w) => [w.criterion, w.weight])))
      setWeightsSaved('Đã lưu trọng số — bảng xếp hạng sẽ dùng trọng số mới.')
    } catch (err) {
      setWeightsError(err instanceof Error ? err.message : 'Không thể lưu trọng số.')
    } finally {
      setSavingWeights(false)
    }
  }

  // US-33: enable/disable a transport mode (PUT {id, name, enabled}).
  const toggleMode = async (mode: ModeInfo, next: boolean) => {
    setBusyModeId(mode.id)
    setModesError(null)
    try {
      const d = await apiJson<{ mode: ModeInfo }>('/api/admin/modes', {
        method: 'PUT',
        body: JSON.stringify({ id: mode.id, name: mode.name, enabled: next }),
      })
      setModes((prev) => prev.map((m) => (m.id === d.mode.id ? d.mode : m)))
    } catch (err) {
      setModesError(err instanceof Error ? err.message : 'Không thể cập nhật phương tiện.')
    } finally {
      setBusyModeId(null)
    }
  }

  // US-33: open the dialog to add a new mode.
  const openAddMode = () => {
    setEditingMode(null)
    setModeDialogOpen(true)
  }

  // US-33: open the dialog prefilled with an existing mode.
  const openEditMode = (mode: ModeInfo) => {
    setEditingMode(mode)
    setModeDialogOpen(true)
  }

  // US-33: replace (or append) the saved mode, then let the parent refresh
  // its own copy of the catalogue.
  const handleModeSaved = (saved: ModeInfo) => {
    setModes((prev) => {
      const exists = prev.some((m) => m.id === saved.id)
      const next = exists ? prev.map((m) => (m.id === saved.id ? saved : m)) : [...prev, saved]
      return next.sort((a, b) => a.sortOrder - b.sortOrder)
    })
    onModesChanged?.()
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------- Modes table (US-33) ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="size-4 text-emerald-600" />
            Phương tiện giao thông
          </CardTitle>
          <CardDescription>
            Tham số mặc định dùng cho xếp hạng TOPSIS. Phương tiện bị vô hiệu hóa không xuất hiện
            trong đề xuất nhưng vẫn được liệt kê tại đây (US-33).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* ---- toolbar: search + primary action ---- */}
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-0 flex-1 lg:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={modeSearch}
                onChange={(e) => setModeSearch(e.target.value)}
                placeholder="Tìm theo tên hoặc mã phương tiện…"
                className="h-9 pl-8"
                aria-label="Tìm kiếm phương tiện"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void loadAll()}>
                <RefreshCw /> Làm mới
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={openAddMode}
              >
                <Plus /> Thêm phương tiện
              </Button>
            </div>
          </div>
          {modeFiltering && filteredModes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Hiển thị {filteredModes.length}/{modes.length} mục
            </p>
          )}

          {modesError && (
            <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
              <TriangleAlert className="size-4 shrink-0" /> {modesError}
            </p>
          )}

          {modesLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : modes.length === 0 ? (
            /* ---- empty state: no modes at all ---- */
            <EmptyState
              icon={<Bike className="size-6" />}
              title="Chưa có phương tiện nào"
              description="Thêm phương tiện giao thông để trình tư vấn xếp hạng các đề xuất chuyến đi bằng TOPSIS (US-33)."
              action={
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={openAddMode}
                >
                  <Plus /> Thêm phương tiện đầu tiên
                </Button>
              }
            />
          ) : filteredModes.length === 0 ? (
            /* ---- empty state: search matched nothing ---- */
            <NoMatchState onClear={() => setModeSearch('')} />
          ) : (
            <>
              <div className={`max-h-[420px] overflow-y-auto rounded-md border ${SCROLLBAR_CLASS}`}>
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>Phương tiện</TableHead>
                      <TableHead className="text-right">Tốc độ (km/h)</TableHead>
                      <TableHead className="text-right">Giá khởi điểm</TableHead>
                      <TableHead className="text-right">Giá mỗi km</TableHead>
                      <TableHead className="text-right">CO₂ (g/km)</TableHead>
                      <TableHead className="text-right">Chờ (phút)</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead className="text-center">Bật/tắt</TableHead>
                      <TableHead className="w-12">
                        <span className="sr-only">Thao tác</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageModes.map((m) => (
                      <TableRow key={m.id} className={m.enabled ? '' : 'opacity-60'}>
                        <TableCell>
                          <p className="font-medium leading-tight">{m.name}</p>
                          <p className="text-xs text-muted-foreground">{m.id}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {m.avgSpeedKmh.toLocaleString('vi-VN')}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtVnd(m.baseCostVnd)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtVnd(m.costPerKmVnd)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{m.co2PerKmG}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.waitMinutes}</TableCell>
                        <TableCell>
                          <Badge className={m.enabled ? PILL_ACTIVE : PILL_INACTIVE}>
                            {m.enabled ? 'Đang dùng' : 'Tạm tắt'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={m.enabled}
                            disabled={busyModeId === m.id}
                            onCheckedChange={(v) => void toggleMode(m, v)}
                            aria-label={`Bật/tắt ${m.name}`}
                          />
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                disabled={busyModeId === m.id}
                                aria-label={`Thao tác với ${m.name}`}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => openEditMode(m)}>
                                <Pencil /> Sửa
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void toggleMode(m, !m.enabled)}>
                                <Power /> {m.enabled ? 'Tạm tắt' : 'Kích hoạt'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <TablePagination
                page={safeModePage}
                pageCount={modePageCount}
                total={filteredModes.length}
                from={(safeModePage - 1) * PAGE_SIZE + 1}
                to={Math.min(safeModePage * PAGE_SIZE, filteredModes.length)}
                onPageChange={setModePage}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Criteria weights editor (US-34) ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Trọng số tiêu chí xếp hạng</CardTitle>
          <CardDescription>
            Điều chỉnh mức độ ưu tiên từng tiêu chí TOPSIS của trình tư vấn (US-34). Tổng 7 trọng
            số phải đúng bằng 100%.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {weightsLoading ? (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 7 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : weights.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Không tìm thấy trọng số tiêu chí nào trên máy chủ.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {weights.map((w) => {
                const value = draft[w.criterion] ?? w.weight
                const label = criterionLabel(w.criterion, w.label)
                return (
                  <div
                    key={w.criterion}
                    className="grid items-center gap-2 sm:grid-cols-[minmax(0,190px)_1fr_96px]"
                  >
                    <Label htmlFor={`weight-${w.criterion}`} className="text-sm font-medium">
                      {label}
                    </Label>
                    <Slider
                      id={`weight-${w.criterion}`}
                      value={[value]}
                      min={0}
                      max={50}
                      step={1}
                      onValueChange={(vals) => setWeight(w.criterion, vals[0] ?? 0)}
                      aria-label={`Trọng số ${label} (phần trăm)`}
                    />
                    <div className="flex items-center gap-1.5">
                      <Input
                        id={`weight-${w.criterion}-num`}
                        type="number"
                        min={0}
                        max={50}
                        value={value}
                        onChange={(e) => setWeight(w.criterion, Number(e.target.value))}
                        className="h-8 text-right"
                        aria-label={`Trọng số ${label} (nhập số)`}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {!weightsLoading && weights.length > 0 && (
            <>
              <Separator />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Tổng:</span>
                  <Badge
                    className={
                      totalOk
                        ? 'bg-emerald-600 text-white hover:bg-emerald-600'
                        : PILL_CONDITIONAL
                    }
                  >
                    {Number.isFinite(total) ? total.toFixed(0) : '0'}%
                  </Badge>
                  <span className="text-xs text-muted-foreground">(cần đạt 100%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => void loadAll()}>
                    <RefreshCw /> Đặt lại
                  </Button>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => void saveWeights()}
                    disabled={savingWeights}
                  >
                    {savingWeights ? <Loader2 className="animate-spin" /> : <Save />} Lưu trọng số
                  </Button>
                </div>
              </div>

              {weightsError && (
                <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
                  <TriangleAlert className="size-4 shrink-0" /> {weightsError}
                </p>
              )}
              {weightsSaved && (
                <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-4 shrink-0" /> {weightsSaved}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------------- US-33: add/edit mode dialog ---------------- */}
      <ModeDialog
        open={modeDialogOpen}
        onOpenChange={setModeDialogOpen}
        mode={editingMode}
        modes={modes}
        onSaved={handleModeSaved}
      />
    </div>
  )
}

/* ---------------------------------------------------------------------
 * Add/edit mode dialog — US-33 (PUT /api/admin/modes is an upsert:
 * unknown id inserts, known id updates).
 * ------------------------------------------------------------------- */

/** Lowercase slug used to auto-suggest new mode ids, e.g. "Electric Bus" → "electric_bus". */
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

/** Clamps a value into the 0..1 range used by accessibility / convenience. */
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/** Parses a numeric input; returns null for empty or non-numeric values. */
function parseNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

type ModeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Mode being edited, or null when adding a new one. */
  mode: ModeInfo | null
  /** Existing modes — used to suggest the next sort order for new modes. */
  modes: ModeInfo[]
  onSaved: (mode: ModeInfo) => void
}

function ModeDialog({ open, onOpenChange, mode, modes, onSaved }: ModeDialogProps) {
  const [id, setId] = useState('')
  const [idEdited, setIdEdited] = useState(false)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [speed, setSpeed] = useState('')
  const [baseCost, setBaseCost] = useState('')
  const [costPerKm, setCostPerKm] = useState('')
  const [co2, setCo2] = useState('')
  const [wait, setWait] = useState('')
  const [accessibility, setAccessibility] = useState('')
  const [convenience, setConvenience] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Prefill on open: edit → existing values; add → blank slate.
  useEffect(() => {
    if (!open) return
    setSaving(false)
    setFormError(null)
    setIdEdited(false)
    if (mode) {
      setId(mode.id)
      setName(mode.name)
      setIcon(mode.icon)
      setSpeed(String(mode.avgSpeedKmh))
      setBaseCost(String(mode.baseCostVnd))
      setCostPerKm(String(mode.costPerKmVnd))
      setCo2(String(mode.co2PerKmG))
      setWait(String(mode.waitMinutes))
      setAccessibility(String(mode.baseAccessibility))
      setConvenience(String(mode.baseConvenience))
      setDescription(mode.description ?? '')
    } else {
      setId('')
      setName('')
      setIcon('')
      setSpeed('')
      setBaseCost('')
      setCostPerKm('')
      setCo2('')
      setWait('')
      setAccessibility('')
      setConvenience('')
      setDescription('')
    }
  }, [open, mode])

  // US-33: auto-suggest the id slug from the name until the admin edits it.
  const handleNameChange = (v: string) => {
    setName(v)
    if (!mode && !idEdited) setId(slugify(v))
  }

  const submit = async () => {
    const finalName = name.trim()
    if (!finalName) {
      setFormError('Vui lòng nhập tên phương tiện.')
      return
    }
    const finalId = mode ? mode.id : id.trim()
    if (!finalId) {
      setFormError('Vui lòng nhập mã phương tiện.')
      return
    }
    // Numeric validation: everything >= 0, speed must be positive.
    const speedNum = parseNum(speed)
    if (speedNum === null || speedNum <= 0) {
      setFormError('Tốc độ phải lớn hơn 0.')
      return
    }
    const baseCostNum = parseNum(baseCost)
    if (baseCostNum === null || baseCostNum < 0) {
      setFormError('Giá khởi điểm phải ≥ 0.')
      return
    }
    const costPerKmNum = parseNum(costPerKm)
    if (costPerKmNum === null || costPerKmNum < 0) {
      setFormError('Giá mỗi km phải ≥ 0.')
      return
    }
    const co2Num = parseNum(co2)
    if (co2Num === null || co2Num < 0) {
      setFormError('Phát thải CO₂ phải ≥ 0.')
      return
    }
    const waitNum = parseNum(wait)
    if (waitNum === null || waitNum < 0) {
      setFormError('Thời gian chờ phải ≥ 0.')
      return
    }
    const accessNum = parseNum(accessibility)
    if (accessNum === null || accessNum < 0) {
      setFormError('Khả năng tiếp cận phải là số từ 0 đến 1.')
      return
    }
    const convNum = parseNum(convenience)
    if (convNum === null || convNum < 0) {
      setFormError('Độ thuận tiện phải là số từ 0 đến 1.')
      return
    }

    // Full upsert object — field names match ModeInfo exactly (backend contract).
    const payload: ModeInfo = {
      id: finalId,
      name: finalName,
      description: description.trim() || null,
      icon: icon.trim() || 'circle-dot',
      avgSpeedKmh: speedNum,
      baseCostVnd: baseCostNum,
      costPerKmVnd: costPerKmNum,
      co2PerKmG: co2Num,
      baseAccessibility: clamp01(accessNum),
      baseConvenience: clamp01(convNum),
      waitMinutes: waitNum,
      enabled: mode ? mode.enabled : true,
      sortOrder: mode
        ? mode.sortOrder
        : modes.length
          ? Math.max(...modes.map((m) => m.sortOrder)) + 1
          : 0,
    }

    setSaving(true)
    setFormError(null)
    try {
      const d = await apiJson<{ mode: ModeInfo }>('/api/admin/modes', {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      onSaved(d.mode)
      onOpenChange(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Không thể lưu phương tiện.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode ? 'Sửa phương tiện' : 'Thêm phương tiện'}</DialogTitle>
          <DialogDescription>
            {mode
              ? 'Cập nhật tham số xếp hạng của phương tiện này (US-33). Phương tiện bị vô hiệu hóa vẫn được liệt kê tại đây nhưng bị ẩn với người dùng.'
              : 'Tạo một phương tiện mới (US-33). Mã (ID) là duy nhất — nếu lưu với mã đã tồn tại, phương tiện đó sẽ được cập nhật thay vì tạo mới.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="mode-name">Tên phương tiện</Label>
            <Input
              id="mode-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="VD: Xe buýt điện"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mode-id">Mã (id)</Label>
              <Input
                id="mode-id"
                value={mode ? mode.id : id}
                onChange={(e) => {
                  setIdEdited(true)
                  setId(e.target.value)
                }}
                disabled={mode !== null}
                placeholder="VD: electric_bus"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {mode
                  ? 'Mã không thể thay đổi sau khi tạo.'
                  : 'Tự động gợi ý từ tên — chỉ gồm chữ thường, số và dấu gạch dưới.'}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mode-icon">Biểu tượng</Label>
              <Input
                id="mode-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="VD: 🚏"
                maxLength={8}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mode-speed">Tốc độ trung bình (km/h)</Label>
              <Input
                id="mode-speed"
                type="number"
                min={0}
                step="any"
                value={speed}
                onChange={(e) => setSpeed(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mode-base-cost">Giá khởi điểm (VNĐ)</Label>
              <Input
                id="mode-base-cost"
                type="number"
                min={0}
                step="any"
                value={baseCost}
                onChange={(e) => setBaseCost(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mode-cost-km">Giá mỗi km (VNĐ)</Label>
              <Input
                id="mode-cost-km"
                type="number"
                min={0}
                step="any"
                value={costPerKm}
                onChange={(e) => setCostPerKm(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mode-co2">Phát thải CO₂ (g/km)</Label>
              <Input
                id="mode-co2"
                type="number"
                min={0}
                step="any"
                value={co2}
                onChange={(e) => setCo2(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mode-wait">Thời gian chờ (phút)</Label>
              <Input
                id="mode-wait"
                type="number"
                min={0}
                step="any"
                value={wait}
                onChange={(e) => setWait(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mode-accessibility">Khả năng tiếp cận (0–1)</Label>
              <Input
                id="mode-accessibility"
                type="number"
                min={0}
                max={1}
                step="0.05"
                value={accessibility}
                onChange={(e) => setAccessibility(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mode-convenience">Thuận tiện (0–1)</Label>
              <Input
                id="mode-convenience"
                type="number"
                min={0}
                max={1}
                step="0.05"
                value={convenience}
                onChange={(e) => setConvenience(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="mode-description">Mô tả</Label>
            <Textarea
              id="mode-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả ngắn hiển thị cho người lập kế hoạch (không bắt buộc)"
            />
          </div>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Hủy
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}{' '}
            {mode ? 'Lưu thay đổi' : 'Thêm phương tiện'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
