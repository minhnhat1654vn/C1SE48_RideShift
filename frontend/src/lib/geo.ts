// Spatial computation utilities for RideShift (pure functions, no external deps)

export type LatLng = [number, number] // [lat, lng]
export type Polygon = LatLng[]

const EARTH_RADIUS_KM = 6371

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Great-circle distance between two points in km */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/** Total length of a polyline in km */
export function routeLengthKm(coords: LatLng[]): number {
  let total = 0
  for (let i = 1; i < coords.length; i++) total += haversineKm(coords[i - 1], coords[i])
  return total
}

/** Ray-casting point-in-polygon test */
export function pointInPolygon(pt: LatLng, polygon: Polygon): boolean {
  let inside = false
  const [x, y] = pt
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-15) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Sample N points evenly along a polyline */
export function sampleRoutePoints(coords: LatLng[], n: number): LatLng[] {
  if (coords.length === 0) return []
  if (coords.length === 1) return [coords[0]]
  const segments: number[] = [0]
  for (let i = 1; i < coords.length; i++) {
    segments.push(segments[i - 1] + haversineKm(coords[i - 1], coords[i]))
  }
  const total = segments[segments.length - 1]
  if (total === 0) return [coords[0]]
  const samples: LatLng[] = []
  for (let s = 0; s < n; s++) {
    const target = (s / (n - 1)) * total
    let seg = 1
    while (seg < segments.length - 1 && segments[seg] < target) seg++
    const segStart = segments[seg - 1]
    const segLen = segments[seg] - segStart
    const t = segLen === 0 ? 0 : (target - segStart) / segLen
    const [lat1, lng1] = coords[seg - 1]
    const [lat2, lng2] = coords[seg]
    samples.push([lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t])
  }
  return samples
}

export type ZoneSpatialResult = {
  zoneId: string
  name: string
  insideRatio: number // 0..1 share of sampled route points inside the zone
  status: 'outside' | 'partial' | 'within'
}

/**
 * Determine whether a route is outside / partially intersects / completely within
 * each LEZ zone (Objective 3 – LEZ Spatial Analysis).
 */
export function analyzeRouteVsZones(
  routeCoords: LatLng[],
  zones: { id: string; name: string; polygon: Polygon }[],
  sampleCount = 200
): ZoneSpatialResult[] {
  if (routeCoords.length < 2) return []
  const samples = sampleRoutePoints(routeCoords, sampleCount)
  return zones.map((z) => {
    let inside = 0
    for (const p of samples) if (pointInPolygon(p, z.polygon)) inside++
    const ratio = samples.length ? inside / samples.length : 0
    const status: ZoneSpatialResult['status'] =
      ratio === 0 ? 'outside' : ratio >= 0.95 ? 'within' : 'partial'
    return { zoneId: z.id, name: z.name, insideRatio: ratio, status }
  })
}

/** Distance from a point to the nearest location of a list, in km */
export function nearestDistanceKm(pt: LatLng, locations: { lat: number; lng: number }[]): number {
  if (locations.length === 0) return Number.POSITIVE_INFINITY
  return Math.min(...locations.map((l) => haversineKm(pt, [l.lat, l.lng])))
}

/** Format km distance to human string */
export function fmtKm(km: number): string {
  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`
}
