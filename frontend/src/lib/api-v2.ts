// Client API v2 — schema 7 nhóm (backend/app/schema_v2.sql).
// credentials: 'include' bắt buộc: frontend (:3000) và backend (:8000) khác origin,
// fetch mặc định ('same-origin') sẽ không gắn cookie phiên admin (bug đã gặp ở v1).
import { apiUrl } from './api'

export type V2VehicleType = {
  code: string
  name: string
  category: string
  fuelType: string
  emissionStandard: string | null
  emissionLevel: number
  modeCode: string
  modeName: string
}

export type V2Compliance = {
  status: 'COMPLIANT' | 'CONDITIONAL' | 'NOT_COMPLIANT'
  reason: string | null
}

export type V2LezZone = {
  zoneId: number
  name: string
  insidePct: number
  status: 'OUTSIDE' | 'PARTIAL' | 'INSIDE'
}

export type V2Recommendation = {
  modeId: number
  modeName: string
  vehicleTypeCode: string | null
  score: number
  rank: number
  contributions: Record<string, number>
  normalized: Record<string, number>
  travelTimeMin: number
  costVnd: number
  compliance: V2Compliance
}

export type V2AnalyzeResponse = {
  tripId: number
  vehicleType: { code: string; name: string }
  route: { distanceKm: number; durationMin: number; source: string }
  lez: V2LezZone[]
  currentCompliance: V2Compliance
  recommendations: V2Recommendation[]
}

export type V2Prefs = {
  fastest?: number
  cheapest?: number
  eco?: number
  comfort?: number
}

export type V2AnalyzeBody = {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  vehicleTypeCode: string
  purpose: 'work' | 'school' | 'shopping' | 'leisure' | 'other'
  travelTime?: string
  preferences?: V2Prefs
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: 'include', ...init })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Lỗi không xác định.')
  return data as T
}

export function fetchVehicleTypesV2(): Promise<V2VehicleType[]> {
  return request<{ vehicleTypes: V2VehicleType[] }>('/api/v2/vehicle-types').then(
    (d) => d.vehicleTypes,
  )
}

export function analyzeV2(body: V2AnalyzeBody): Promise<V2AnalyzeResponse> {
  return request<V2AnalyzeResponse>('/api/v2/trip/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function recordChoiceV2(
  tripId: number,
  chosenVehicleTypeCode: string | null,
): Promise<{ ok: boolean; trip: { id: number; switched: boolean } }> {
  return request(`/api/v2/trip/${tripId}/choice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chosenVehicleTypeCode }),
  })
}
