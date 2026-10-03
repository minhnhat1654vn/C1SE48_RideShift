'use client'

// LEZ Zones admin tab — Task 3-b (RideShift, C1SE.48) · Phase C "Bảng quản trị hiện đại"
// US-22: view existing LEZ zones on a map and as a list.
// US-31: draw a new zone polygon by clicking the map (click-to-add vertices).
// US-32: rename zones, edit description, activate/deactivate (with a
//        confirmation dialog when deactivating), delete.
//
// Phase C (Task 36-C): toolbar (search + status filter + primary action),
// unified status pills, row actions collapsed into a "⋯" dropdown menu,
// the inline edit form moved into a right-side Sheet, client-side pagination
// (10 rows/page) and dedicated empty states.
//
// Phase D (Task 36-D): "+ Thêm vùng" no longer draws directly on the main
// map — it opens a 3-step wizard in a large Dialog:
//   ① Vẽ vùng trên bản đồ (click-to-add vertices, undo/clear, ≥ 3 points)
//   ② Thông tin vùng (name required ≥ 3 chars, optional description)
//   ③ Xem lại & lưu (summary incl. estimated area via shoelace formula,
//     draft-polygon map preview using the existing MapView, then POST).
// Closing the wizard mid-way (Hủy / X / ESC) asks for confirmation once at
// least one vertex was drawn or step ② was reached. All business logic /
// API calls are unchanged — the parent still owns the live `zones` array
// and refreshes it via `onZonesChanged()` after every successful mutation.

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { apiFetch } from '@/lib/api'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Map,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Search,
  SearchX,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react'
import MapView from '@/components/rideshift/map-view'
import type { LezZoneDto } from '@/lib/types'

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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

// Shared scrollbar styling for long scrollable lists.
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
const PILL_DRAFT =
  'border border-amber-200 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'

/* ---------------------------------------------------------------------
 * Wizard (Phase D) — step metadata + shoelace area estimate.
 * ------------------------------------------------------------------- */
type WizardStep = 1 | 2 | 3

const WIZARD_STEPS: { id: WizardStep; title: string }[] = [
  { id: 1, title: 'Vẽ vùng trên bản đồ' },
  { id: 2, title: 'Thông tin vùng' },
  { id: 3, title: 'Xem lại & lưu' },
]

/**
 * Estimate a polygon's area in km² from [lat, lng] pairs using the shoelace
 * formula on a local equirectangular projection (km-per-degree scaled by the
 * mean latitude). Good enough for city-scale zones — the result is an
 * estimate, not a geodesic measurement.
 */
function estimatePolygonAreaKm2(coords: [number, number][]): number {
  if (coords.length < 3) return 0
  const KM_PER_DEG_LAT = 110.574
  const KM_PER_DEG_LNG_AT_EQUATOR = 111.32
  let latSum = 0
  for (const [lat] of coords) latSum += lat
  const kmPerDegLng = KM_PER_DEG_LNG_AT_EQUATOR * Math.cos((latSum / coords.length) * (Math.PI / 180))
  let doubled = 0
  for (let i = 0; i < coords.length; i++) {
    const [latA, lngA] = coords[i]
    const [latB, lngB] = coords[(i + 1) % coords.length]
    doubled += lngA * kmPerDegLng * latB * KM_PER_DEG_LAT - lngB * kmPerDegLng * latA * KM_PER_DEG_LAT
  }
  return Math.abs(doubled) / 2
}

/** 3-step indicator: done (✓, clickable to go back) / current (đậm) / upcoming (mờ). */
function WizardStepper({
  current,
  onStepSelect,
}: {
  current: WizardStep
  onStepSelect: (step: WizardStep) => void
}) {
  return (
    <ol className="flex items-center gap-2" aria-label="Tiến trình 3 bước tạo vùng LEZ">
      {WIZARD_STEPS.map((step, index) => {
        const isCurrent = step.id === current
        const isDone = step.id < current
        const prev = index > 0 ? WIZARD_STEPS[index - 1] : undefined
        const circleClass = isCurrent
          ? 'flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white shadow-sm dark:bg-emerald-500'
          : isDone
            ? 'flex size-7 shrink-0 items-center justify-center rounded-full border border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-300'
            : 'flex size-7 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500'
        const labelClass = isCurrent
          ? 'hidden text-sm font-semibold text-foreground sm:block'
          : isDone
            ? 'hidden text-sm font-medium text-emerald-700 sm:block dark:text-emerald-300'
            : 'hidden text-sm text-muted-foreground sm:block'
        return (
          <li
            key={step.id}
            className="flex items-center gap-2"
            aria-current={isCurrent ? 'step' : undefined}
          >
            {prev && (
              <span
                aria-hidden="true"
                className={`h-px w-5 sm:w-9 ${prev.id < current ? 'bg-emerald-400' : 'bg-border'}`}
              />
            )}
            {isDone ? (
              <button
                type="button"
                className="flex items-center gap-2 rounded-md p-0.5 transition-colors hover:bg-accent"
                onClick={() => onStepSelect(step.id)}
                title={`Quay lại bước ${step.id}: ${step.title}`}
              >
                <span className={circleClass} aria-hidden="true">
                  <Check className="size-4" />
                </span>
                <span className={labelClass}>{step.title}</span>
              </button>
            ) : (
              <span className="flex items-center gap-2 p-0.5" aria-disabled={step.id > current}>
                <span className={circleClass} aria-hidden="true">
                  {step.id}
                </span>
                <span className={labelClass}>{step.title}</span>
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/* ---------------------------------------------------------------------
 * Local UI helpers (toolbar bits, pagination, empty states).
 * ------------------------------------------------------------------- */

type StatusFilterSelectProps = {
  value: 'all' | 'active' | 'inactive'
  onChange: (v: 'all' | 'active' | 'inactive') => void
}

function StatusFilterSelect({ value, onChange }: StatusFilterSelectProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v === 'active' ? 'active' : v === 'inactive' ? 'inactive' : 'all')}>
      <SelectTrigger className="h-9 w-full sm:w-[170px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Trạng thái: Tất cả</SelectItem>
        <SelectItem value="active">Trạng thái: Hoạt động</SelectItem>
        <SelectItem value="inactive">Trạng thái: Tạm tắt</SelectItem>
      </SelectContent>
    </Select>
  )
}

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

type ZonesTabProps = {
  zones: LezZoneDto[]
  onZonesChanged: () => void
}

export default function ZonesTab({ zones, onZonesChanged }: ZonesTabProps) {
  // ---- toolbar state (Phase C) ----
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [page, setPage] = useState(1)

  // ---- create-zone wizard state (Phase D, replaces the old direct draw mode) ----
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState<WizardStep>(1)
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([])
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [savingZone, setSavingZone] = useState(false)
  // stepError: per-step validation (≥ 3 điểm / tên ≥ 3 ký tự); zoneError: API/save error on step 3.
  const [stepError, setStepError] = useState<string | null>(null)
  const [zoneError, setZoneError] = useState<string | null>(null)
  const [visitedStep2, setVisitedStep2] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  // ---- US-32: rename/description editor, now in a right-side Sheet ----
  const [editingZone, setEditingZone] = useState<LezZoneDto | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // ---- per-row busy state + list-level error ----
  const [busyZoneId, setBusyZoneId] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  // ---- US-32: zone awaiting deactivation confirmation (null = no dialog) ----
  const [deactivateZone, setDeactivateZone] = useState<LezZoneDto | null>(null)
  // ---- US-32: zone awaiting delete confirmation (opened from the ⋯ menu) ----
  const [deleteZoneTarget, setDeleteZoneTarget] = useState<LezZoneDto | null>(null)

  const activeCount = useMemo(() => zones.filter((z) => z.active).length, [zones])

  // ---- Phase C: search + status filter + pagination (client-side) ----
  const query = search.trim().toLowerCase()
  const filtering = query !== '' || statusFilter !== 'all'
  const filteredZones = useMemo(() => {
    return zones.filter((z) => {
      const matchQuery =
        query === '' ||
        z.name.toLowerCase().includes(query) ||
        (z.description ?? '').toLowerCase().includes(query)
      const matchStatus =
        statusFilter === 'all' || (statusFilter === 'active' ? z.active : !z.active)
      return matchQuery && matchStatus
    })
  }, [zones, query, statusFilter])

  const pageCount = Math.max(1, Math.ceil(filteredZones.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageZones = filteredZones.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Reset to page 1 whenever the search/filter changes.
  useEffect(() => {
    setPage(1)
  }, [query, statusFilter])

  // ---- Phase D: wizard navigation + closing guard --------------------
  const openWizard = () => {
    setWizardOpen(true)
    setWizardStep(1)
    setDrawPoints([])
    setNewName('')
    setNewDesc('')
    setZoneError(null)
    setStepError(null)
    setVisitedStep2(false)
    setConfirmCancel(false)
    setEditingZone(null)
  }

  const closeWizard = () => {
    setWizardOpen(false)
    setWizardStep(1)
    setDrawPoints([])
    setNewName('')
    setNewDesc('')
    setZoneError(null)
    setStepError(null)
    setVisitedStep2(false)
    setConfirmCancel(false)
  }

  // Hủy / X / ESC: if anything was drawn or step ② was reached, confirm first.
  const requestCloseWizard = () => {
    if (drawPoints.length > 0 || visitedStep2) {
      setConfirmCancel(true)
      return
    }
    closeWizard()
  }

  const goToStep = (step: WizardStep) => {
    setWizardStep(step)
    setStepError(null)
    setZoneError(null)
    if (step >= 2) setVisitedStep2(true)
  }

  const continueStep = () => {
    if (wizardStep === 1) {
      if (drawPoints.length < 3) {
        setStepError(
          `Vùng cần ít nhất 3 điểm trên bản đồ — hiện có ${drawPoints.length} điểm. Hãy bấm lên bản đồ để thêm đỉnh.`,
        )
        return
      }
      goToStep(2)
      return
    }
    if (wizardStep === 2) {
      if (newName.trim().length < 3) {
        setStepError('Tên vùng là bắt buộc — nhập ít nhất 3 ký tự để tiếp tục.')
        return
      }
      goToStep(3)
    }
  }

  const backToPreviousStep = () => {
    if (wizardStep <= 1) return
    goToStep(wizardStep === 3 ? 2 : 1)
  }

  // US-31: clicking the wizard map (step ① only) appends a polygon vertex.
  const handleMapClick = (lat: number, lng: number) => {
    if (!wizardOpen || wizardStep !== 1) return
    setStepError(null)
    // Round to 6 decimals (~11 cm precision) to keep payloads tidy.
    setDrawPoints((prev) => [...prev, [Number(lat.toFixed(6)), Number(lng.toFixed(6))]])
  }

  // Estimated area for the step-③ summary (shoelace on lat/lng, 1 decimal).
  const areaKm2 = useMemo(() => estimatePolygonAreaKm2(drawPoints), [drawPoints])
  const areaText = (Math.round(areaKm2 * 10) / 10).toLocaleString('vi-VN', {
    maximumFractionDigits: 1,
  })

  // US-31: POST the drawn polygon (step ③), then ask the parent to refresh.
  const saveZone = async () => {
    if (drawPoints.length < 3 || newName.trim().length < 3) {
      setZoneError('Không thể lưu: cần ít nhất 3 điểm trên bản đồ và tên vùng tối thiểu 3 ký tự.')
      return
    }
    setSavingZone(true)
    setZoneError(null)
    try {
      await apiJson<{ zone: LezZoneDto }>('/api/admin/zones', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim() || null,
          coordinates: drawPoints,
          active: true,
        }),
      })
      closeWizard()
      onZonesChanged()
    } catch (err) {
      setZoneError(err instanceof Error ? err.message : 'Không thể lưu vùng.')
    } finally {
      setSavingZone(false)
    }
  }

  // US-32: activate / deactivate an existing zone.
  const toggleActive = async (zone: LezZoneDto, next: boolean) => {
    setBusyZoneId(zone.id)
    setListError(null)
    try {
      await apiJson<{ zone: LezZoneDto }>(`/api/admin/zones/${zone.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: next }),
      })
      onZonesChanged()
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Không thể cập nhật vùng.')
    } finally {
      setBusyZoneId(null)
    }
  }

  // US-32: delete a zone (confirmed by a controlled AlertDialog).
  const deleteZone = async (zone: LezZoneDto) => {
    setBusyZoneId(zone.id)
    setListError(null)
    try {
      await apiJson<{ ok: boolean }>(`/api/admin/zones/${zone.id}`, { method: 'DELETE' })
      if (editingZone?.id === zone.id) setEditingZone(null)
      onZonesChanged()
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Không thể xóa vùng.')
    } finally {
      setBusyZoneId(null)
    }
  }

  // US-32: open the edit Sheet prefilled with the zone's current values.
  const openEdit = (zone: LezZoneDto) => {
    setEditingZone(zone)
    setEditName(zone.name)
    setEditDesc(zone.description ?? '')
    setEditError(null)
  }

  const saveEdit = async () => {
    if (!editingZone) return
    if (!editName.trim()) {
      setEditError('Tên vùng không được để trống.')
      return
    }
    setSavingEdit(true)
    setEditError(null)
    try {
      await apiJson<{ zone: LezZoneDto }>(`/api/admin/zones/${editingZone.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() || null }),
      })
      setEditingZone(null)
      onZonesChanged()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Không thể cập nhật vùng.')
    } finally {
      setSavingEdit(false)
    }
  }

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ---------------- Left column: zone table (US-22 / US-32) ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="size-4 text-emerald-600" />
            Vùng LEZ
          </CardTitle>
          <CardDescription>
            {zones.length} vùng · {activeCount} đang hoạt động. Chỉ các vùng đang hoạt động mới
            được trình tư vấn chuyến đi áp dụng.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* ---- toolbar: search + status filter + primary action ---- */}
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:min-w-44">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm theo tên hoặc mô tả vùng…"
                  className="h-9 pl-8"
                  aria-label="Tìm kiếm vùng LEZ"
                />
              </div>
              <StatusFilterSelect value={statusFilter} onChange={setStatusFilter} />
            </div>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={openWizard}
            >
              <Plus /> Thêm vùng
            </Button>
          </div>
          {filtering && filteredZones.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Hiển thị {filteredZones.length}/{zones.length} mục
            </p>
          )}

          {listError && (
            <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
              <TriangleAlert className="size-4 shrink-0" /> {listError}
            </p>
          )}

          {/* ---- empty states ---- */}
          {zones.length === 0 ? (
            <EmptyState
              icon={<Map className="size-6" />}
              title="Chưa có vùng LEZ nào"
              description="Dùng trình tạo 3 bước để tạo vùng đầu tiên: vẽ đa giác trên bản đồ (ít nhất 3 điểm), đặt tên rồi xem lại trước khi lưu."
              action={
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={openWizard}
                >
                  <Plus /> Thêm vùng đầu tiên
                </Button>
              }
            />
          ) : filteredZones.length === 0 ? (
            <NoMatchState onClear={clearFilters} />
          ) : (
            <>
              <div className={`max-h-[520px] overflow-y-auto rounded-md border ${SCROLLBAR_CLASS}`}>
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>Vùng</TableHead>
                      <TableHead className="text-right">Số điểm</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead className="text-center">Áp dụng</TableHead>
                      <TableHead className="w-12">
                        <span className="sr-only">Thao tác</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageZones.map((zone) => (
                      <TableRow key={zone.id}>
                        <TableCell className="max-w-[220px]">
                          <p className="truncate font-medium leading-tight" title={zone.name}>
                            {zone.name}
                          </p>
                          {zone.description && (
                            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground" title={zone.description}>
                              {zone.description}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {zone.coordinates.length}
                        </TableCell>
                        <TableCell>
                          <Badge className={zone.active ? PILL_ACTIVE : PILL_INACTIVE}>
                            {zone.active ? 'Hoạt động' : 'Tạm tắt'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {/* US-32: activation switch — switching OFF asks for
                              confirmation first; switching ON is immediate. */}
                          <Switch
                            checked={zone.active}
                            disabled={busyZoneId === zone.id}
                            onCheckedChange={(v) => {
                              if (v) void toggleActive(zone, true)
                              else setDeactivateZone(zone)
                            }}
                            aria-label={`Bật/tắt áp dụng cho ${zone.name}`}
                          />
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                disabled={busyZoneId === zone.id}
                                aria-label={`Thao tác với ${zone.name}`}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => openEdit(zone)}>
                                <Pencil /> Sửa
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setDeleteZoneTarget(zone)}
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
                pageCount={pageCount}
                total={filteredZones.length}
                from={(safePage - 1) * PAGE_SIZE + 1}
                to={Math.min(safePage * PAGE_SIZE, filteredZones.length)}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Right column: zones preview map (US-22) ---------------- */}
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              Xem trước bản đồ của tất cả các vùng LEZ đang hoạt động. Dùng{' '}
              <span className="font-medium text-foreground">Thêm vùng</span> để mở trình tạo 3
              bước: vẽ đa giác → thông tin vùng → xem lại &amp; lưu.
            </p>
          </CardContent>
        </Card>

        <div className="h-[380px] overflow-hidden rounded-xl border lg:h-[540px]">
          <MapView zones={zones} className="h-full w-full" />
        </div>
      </div>

      {/* ---------------- Phase D: 3-step create-zone wizard ---------------- */}
      <Dialog
        open={wizardOpen}
        onOpenChange={(open) => {
          if (!open) requestCloseWizard()
        }}
      >
        <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="gap-1.5 border-b px-5 pb-4 pt-5 pr-12">
            <DialogTitle className="text-base">Thêm vùng LEZ mới</DialogTitle>
            <DialogDescription>
              Tạo vùng phát thải thấp qua 3 bước: vẽ đa giác trên bản đồ, nhập thông tin vùng, xem
              lại rồi mới lưu.
            </DialogDescription>
            <div className="pt-3">
              <WizardStepper
                current={wizardStep}
                onStepSelect={(s) => {
                  if (s < wizardStep) goToStep(s)
                }}
              />
            </div>
          </DialogHeader>

          <div className={`flex-1 overflow-y-auto px-5 py-4 ${SCROLLBAR_CLASS}`}>
            {/* ---- Bước ①: vẽ vùng ---- */}
            {wizardStep === 1 && (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Bấm lên bản đồ để thêm đỉnh của đa giác — một vùng hợp lệ cần ít nhất 3 điểm.
                </p>
                <div className="h-56 overflow-hidden rounded-md border sm:h-72">
                  <MapView
                    zones={zones}
                    drawMode
                    drawPoints={drawPoints}
                    onMapClick={handleMapClick}
                    className="h-full w-full"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={PILL_DRAFT}>{drawPoints.length} điểm</Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDrawPoints((prev) => prev.slice(0, -1))
                      setStepError(null)
                    }}
                    disabled={drawPoints.length === 0}
                  >
                    <Undo2 /> Hoàn tác điểm
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDrawPoints([])
                      setStepError(null)
                    }}
                    disabled={drawPoints.length === 0}
                  >
                    <X /> Xóa hết điểm
                  </Button>
                </div>
                {drawPoints.length > 0 ? (
                  <div className={`max-h-32 overflow-y-auto rounded-md border ${SCROLLBAR_CLASS}`}>
                    <ul className="divide-y">
                      {drawPoints.map(([lat, lng], i) => (
                        <li
                          key={`${i}-${lat}-${lng}`}
                          className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
                        >
                          <span className="font-medium">Điểm {i + 1}</span>
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">
                            {lat.toFixed(6)}, {lng.toFixed(6)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed px-3 py-2 text-center text-sm text-muted-foreground">
                    Chưa có điểm nào — hãy bấm lên bản đồ để thêm đỉnh đầu tiên.
                  </p>
                )}
              </div>
            )}

            {/* ---- Bước ②: thông tin vùng ---- */}
            {wizardStep === 2 && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={PILL_DRAFT}>Đã vẽ {drawPoints.length} đỉnh</Badge>
                  <span className="text-sm text-muted-foreground">
                    Đặt tên cho vùng trước khi xem lại.
                  </span>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="new-zone-name">
                    Tên vùng <span className="text-destructive" aria-hidden="true">*</span>
                    <span className="sr-only">(bắt buộc, tối thiểu 3 ký tự)</span>
                  </Label>
                  <Input
                    id="new-zone-name"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value)
                      if (stepError) setStepError(null)
                    }}
                    placeholder="VD: Vùng LEZ Vành đai 2"
                    aria-invalid={wizardStep === 2 && stepError !== null ? true : undefined}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="new-zone-desc">Mô tả (không bắt buộc)</Label>
                  <Textarea
                    id="new-zone-desc"
                    rows={3}
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="VD: Vùng phát thải thấp mở rộng bao phủ các quận phía nam"
                  />
                </div>
              </div>
            )}

            {/* ---- Bước ③: xem lại & lưu ---- */}
            {wizardStep === 3 && (
              <div className="flex flex-col gap-3">
                <div>
                  <Badge className={PILL_DRAFT}>Đa giác nháp · {drawPoints.length} đỉnh</Badge>
                </div>
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableBody>
                      <TableRow>
                        <TableCell className="w-40 text-muted-foreground">Tên vùng</TableCell>
                        <TableCell className="font-medium">{newName.trim()}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Mô tả</TableCell>
                        <TableCell>
                          {newDesc.trim() || (
                            <span className="italic text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Số đỉnh</TableCell>
                        <TableCell className="tabular-nums">{drawPoints.length}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="align-top text-muted-foreground">
                          Diện tích ước tính
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {areaText} km²
                          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                            Ước tính bằng công thức shoelace trên tọa độ lat/lng — chỉ mang tính
                            tham khảo.
                          </span>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                <div className="h-56 overflow-hidden rounded-md border sm:h-72">
                  <MapView
                    zones={zones}
                    drawPoints={drawPoints}
                    fitBoundsTo={drawPoints}
                    className="h-full w-full"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Bản đồ xem trước: đa giác nháp (nét đứt màu hổ phách) trên nền các vùng LEZ hiện
                  có.
                </p>
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <p>Mọi tuyến đi qua vùng này sẽ được kiểm tra tuân thủ khi tư vấn chuyến đi.</p>
                </div>
                {zoneError && (
                  <p
                    role="alert"
                    className="flex items-start gap-1.5 text-sm font-medium text-destructive"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {zoneError}
                  </p>
                )}
              </div>
            )}

            {/* ---- per-step validation error (red) ---- */}
            {stepError && (
              <p
                role="alert"
                className="mt-3 flex items-start gap-1.5 text-sm font-medium text-destructive"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {stepError}
              </p>
            )}
          </div>

          {/* ---- wizard footer: back / cancel / continue-save ---- */}
          <div className="flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            {wizardStep > 1 ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={backToPreviousStep}
                disabled={savingZone}
              >
                <ChevronLeft /> Quay lại
              </Button>
            ) : (
              <span className="hidden sm:block" aria-hidden="true" />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <Button
                variant="ghost"
                size="sm"
                className="w-full sm:w-auto"
                onClick={requestCloseWizard}
                disabled={savingZone}
              >
                Hủy
              </Button>
              {wizardStep < 3 ? (
                <Button
                  size="sm"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
                  onClick={continueStep}
                >
                  Tiếp tục <ChevronRight />
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
                  onClick={() => void saveZone()}
                  disabled={savingZone}
                >
                  {savingZone ? <Loader2 className="animate-spin" /> : <Check />} Lưu vùng
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------------- Phase D: confirm discarding the draft zone ---------------- */}
      <AlertDialog
        open={confirmCancel}
        onOpenChange={(open) => {
          if (!open) setConfirmCancel(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hủy tạo vùng?</AlertDialogTitle>
            <AlertDialogDescription>
              Đa giác bạn đã vẽ sẽ mất. Bạn có chắc muốn thoát khỏi trình tạo vùng không?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Tiếp tục tạo</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={closeWizard}
            >
              Hủy, xóa đa giác
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------------- US-32: edit zone — right-side Sheet ---------------- */}
      <Sheet
        open={editingZone !== null}
        onOpenChange={(open) => {
          if (!open) setEditingZone(null)
        }}
      >
        <SheetContent side="right" className="flex flex-col gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Sửa vùng LEZ</SheetTitle>
            <SheetDescription>
              Cập nhật tên và mô tả của vùng (US-32). Đa giác và trạng thái áp dụng được quản lý
              ở bảng danh sách.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
            <div className="grid gap-1.5">
              <Label htmlFor="zone-edit-name">Tên vùng</Label>
              <Input
                id="zone-edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="zone-edit-desc">Mô tả</Label>
              <Textarea
                id="zone-edit-desc"
                rows={3}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Mô tả ngắn hiển thị cho người lập kế hoạch (không bắt buộc)"
              />
            </div>
            {editError && (
              <p role="alert" className="text-sm text-destructive">
                {editError}
              </p>
            )}
          </div>
          <SheetFooter className="border-t">
            <Button
              variant="outline"
              onClick={() => setEditingZone(null)}
              disabled={savingEdit}
            >
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
        </SheetContent>
      </Sheet>

      {/* ---------------- US-32: deactivate-zone confirmation ---------------- */}
      <AlertDialog
        open={deactivateZone !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivateZone(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vô hiệu hóa “{deactivateZone?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Vùng bị vô hiệu hóa sẽ không được dùng để kiểm tra tuân thủ nhưng vẫn được giữ để
              tham chiếu. Bạn có thể kích hoạt lại vùng này bất cứ lúc nào.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deactivateZone) void toggleActive(deactivateZone, false)
                setDeactivateZone(null)
              }}
            >
              Vô hiệu hóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------------- US-32: delete-zone confirmation (from ⋯ menu) ---------------- */}
      <AlertDialog
        open={deleteZoneTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteZoneTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa vùng “{deleteZoneTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Hành động này không thể hoàn tác: đa giác của vùng LEZ sẽ bị xóa vĩnh viễn. Các quy
              định đang hoạt động có tham chiếu đến vùng này sẽ không còn được áp dụng. Nếu có thể
              cần dùng lại sau, hãy cân nhắc vô hiệu hóa vùng thay vì xóa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleteZoneTarget) void deleteZone(deleteZoneTarget)
                setDeleteZoneTarget(null)
              }}
            >
              Xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
