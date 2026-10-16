// Client API Quản trị v2 — mọi call đều credentials:'include' (cookie phiên
// rs2_admin_session phải đi kèm; frontend và backend khác origin).
import { apiUrl } from './api'

export type V2Admin = { id: number; name: string; email: string; role: string }

export type V2Zone = {
  id: number
  name: string
  description: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
  status: string
  geometry: { type: string; coordinates: number[][][] } | null
}

export type V2RuleRestriction = {
  vehicleTypeId: number
  vehicleTypeCode: string
  vehicleTypeName: string
  restrictionType: 'ALLOWED' | 'CONDITIONAL' | 'PROHIBITED'
  minEmissionLevel: number | null
  reason: string | null
}

export type V2Rule = {
  id: number
  zoneId: number
  ruleName: string
  description: string | null
  startTime: string
  endTime: string
  daysOfWeek: number[]
  effectiveFrom: string | null
  effectiveTo: string | null
  status: string
  restrictions: V2RuleRestriction[]
}

export type V2VehicleType = {
  id: number
  code: string
  name: string
  category: string
  fuelType: string
  emissionStandard: string | null
  emissionLevel: number
  transportationModeId: number
  modeName: string
  isDefault: boolean
  status: string
}

export type V2Mode = Record<string, string | number | boolean | null> & {
  transportation_mode_id: number
  code: string
  name: string
  is_active: boolean
}

export type V2Weight = { code: string; name: string; type: 'COST' | 'BENEFIT'; weight: number }

export type V2Analytics = {
  kpis: { totalTrips: number; lezAffectedPct: number; switchingPct: number; chosenCount: number }
  topRecommended: { mode: string; code: string; count: number }[]
  byDistrict: { district: string; count: number }[]
  byPurpose: { purpose: string; count: number }[]
  switchingTo: { vehicleType: string; count: number }[]
  recommendationStats: { runs: number; avgMs: number; maxMs: number }
  dataset: { surveyTotal: number; surveyValid: number; importedAt: string | null }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: 'include', ...init })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    const err = new Error(data.error ?? 'Lỗi không xác định.') as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return data as T
}

// ---------- auth
export function loginV2(email: string, password: string): Promise<{ ok: boolean; admin: V2Admin }> {
  return request('/api/v2/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}
export function logoutV2(): Promise<{ ok: boolean }> {
  return request('/api/v2/admin/logout', { method: 'POST' })
}
export function meV2(): Promise<{ admin: V2Admin }> {
  return request('/api/v2/admin/me')
}

// ---------- zones
export function getZonesV2(): Promise<{ zones: V2Zone[] }> {
  return request('/api/v2/admin/zones')
}
export function createZoneV2(body: {
  name: string
  description?: string
  coordinates: [number, number][]
  effectiveFrom?: string
  effectiveTo?: string
}): Promise<{ ok: boolean; id: number }> {
  return request('/api/v2/admin/zones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
export function deleteZoneV2(id: number): Promise<{ ok: boolean }> {
  return request(`/api/v2/admin/zones/${id}`, { method: 'DELETE' })
}

// ---------- rules
export function getRulesV2(zoneId?: number): Promise<{ rules: V2Rule[] }> {
  return request(`/api/v2/admin/rules${zoneId ? `?zone_id=${zoneId}` : ''}`)
}
export function createRuleV2(body: unknown): Promise<{ ok: boolean; id: number }> {
  return request('/api/v2/admin/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
export function deleteRuleV2(id: number): Promise<{ ok: boolean }> {
  return request(`/api/v2/admin/rules/${id}`, { method: 'DELETE' })
}

// ---------- vehicle types + modes
export function getVehicleTypesV2(): Promise<{ vehicleTypes: V2VehicleType[] }> {
  return request('/api/v2/admin/vehicle-types')
}
export function getModesV2(): Promise<{ modes: V2Mode[] }> {
  return request('/api/v2/admin/modes')
}
export function updateModeV2(id: number, body: Record<string, unknown>): Promise<{ ok: boolean }> {
  return request(`/api/v2/admin/modes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------- weights
export function getWeightsV2(): Promise<{ weights: V2Weight[] }> {
  return request('/api/v2/admin/weights')
}
export function putWeightsV2(
  weights: { code: string; weight: number }[],
): Promise<{ ok: boolean; total: number }> {
  return request('/api/v2/admin/weights', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weights }),
  })
}

// ---------- analytics
export function getAnalyticsV2(from?: string, to?: string): Promise<V2Analytics> {
  const q = from && to ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : ''
  return request(`/api/v2/admin/analytics${q}`)
}
