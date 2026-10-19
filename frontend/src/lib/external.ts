// External service adapters with graceful fallback + caching
// (Map & Routing Service: OSRM/OpenStreetMap; Air Quality Service: Open-Meteo)

import { LatLng, haversineKm } from './geo'
import { fetchJson4, rawHttpRequest } from './http'

// ---------------------------------------------------------------- Geocoding
//
// Provider chain — runs SERVER-SIDE inside the nodejs route runtime, so the
// Goong key never reaches the browser bundle:
//   1) Goong.io  — Vietnam-first geocoding WITH HOUSE NUMBERS ("120 Yên Lãng"),
//                  enabled only when GOONG_API_KEY is set (goong.io free tier)
//   2) Nominatim — OpenStreetMap public instance (Hanoi viewport)
//   3) LOCAL_PLACES — offline landmark fallback (last resort)

export type GeocodeResult = {
  name: string
  lat: number
  lng: number
  source: 'external' | 'local'
}

type GoongResult = {
  name?: string
  formatted_address?: string
  geometry?: { location?: { lat?: number; lng?: number } }
  center?: [number, number] // Mapbox-style [lng, lat]
}

const GOONG_API_KEY = process.env.GOONG_API_KEY ?? ''
const GOONG_GEOCODE_URL = 'https://rsapi.goong.io/geocode'
const GOONG_AUTOCOMPLETE_URL = 'https://rsapi.goong.io/Place/AutoComplete'
const GOONG_PLACE_DETAIL_URL = 'https://rsapi.goong.io/Place/Detail'

/** In-memory geocode cache — deliberately NOT a database table (geocoding is
 * a stateless lookup; the cache only saves provider quota). Empty results get
 * a short TTL so a transient network blip does not stick for half an hour. */
const GEO_CACHE_TTL_MS = 30 * 60 * 1000
const GEO_CACHE_MAX = 300
const geoCache = new Map<string, { at: number; results: GeocodeResult[] }>()

/** Classic Goong Geocoding API — best for COMPLETE addresses. Parses the
 * response defensively against shape drift (the API returns the array under
 * "results"; older docs/Mapbox-style payloads use "geocoding_results" /
 * "features" + "center": [lng, lat]). */
async function geocodeGoongClassic(q: string): Promise<GeocodeResult[]> {
  const url =
    `${GOONG_GEOCODE_URL}?address=${encodeURIComponent(q)}` +
    `&api_key=${encodeURIComponent(GOONG_API_KEY)}`
  const res = await rawHttpRequest(url, { timeoutMs: 5000 })
  if (res.status < 200 || res.status >= 300) {
    // 401/403: invalid key — 429: quota exhausted → degrade to Nominatim
    console.warn(`geocode: goong-geocode HTTP ${res.status} for q="${q}" — falling through`)
    return []
  }
  const payload = (typeof res.data === 'object' && res.data !== null ? res.data : {}) as {
    results?: GoongResult[]
    geocoding_results?: GoongResult[]
    features?: GoongResult[]
  }
  const items = payload.results ?? payload.geocoding_results ?? payload.features ?? []
  const results: GeocodeResult[] = []
  for (const d of items.slice(0, 6)) {
    const lat = d.geometry?.location?.lat
    const lng = d.geometry?.location?.lng
    const name = d.name || d.formatted_address || ''
    if (lat == null || lng == null || !name) continue
    results.push({ name, lat: Number(lat), lng: Number(lng), source: 'external' })
  }
  return results
}

async function geocodeGoong(q: string): Promise<GeocodeResult[]> {
  if (!GOONG_API_KEY) return []
  try {
    // 1) Place AutoComplete — VN text search WITH house numbers (the classic
    //    /geocode endpoint only understands near-complete addresses and
    //    mis-resolves partial input like "120 yên"). Predictions carry a
    //    place_id but NO coordinates, so each one is resolved by a parallel
    //    Place Detail call (step 2).
    const acUrl =
      `${GOONG_AUTOCOMPLETE_URL}?input=${encodeURIComponent(q)}` +
      `&limit=8&api_key=${encodeURIComponent(GOONG_API_KEY)}`
    const res = await rawHttpRequest(acUrl, { timeoutMs: 5000 })
    let results: GeocodeResult[] = []
    if (res.status >= 200 && res.status < 300) {
      const payload = (typeof res.data === 'object' && res.data !== null ? res.data : {}) as {
        predictions?: Array<{ place_id?: string }>
      }
      const placeIds = (payload.predictions ?? [])
        .map((p) => p.place_id)
        .filter((id): id is string => Boolean(id))
        .slice(0, 8)
      if (placeIds.length > 0) {
        const details = await Promise.all(
          placeIds.map(async (placeId): Promise<GeocodeResult | null> => {
            try {
              const dUrl =
                `${GOONG_PLACE_DETAIL_URL}?place_id=${encodeURIComponent(placeId)}` +
                `&api_key=${encodeURIComponent(GOONG_API_KEY)}`
              const r = await rawHttpRequest(dUrl, { timeoutMs: 5000 })
              if (r.status < 200 || r.status >= 300) return null
              const wrapper = (typeof r.data === 'object' && r.data !== null ? r.data : {}) as {
                result?: GoongResult
              }
              const d = wrapper.result ?? {}
              const lat = d.geometry?.location?.lat
              const lng = d.geometry?.location?.lng
              const name = d.formatted_address || d.name || ''
              if (lat == null || lng == null || !name) return null
              return { name, lat: Number(lat), lng: Number(lng), source: 'external' }
            } catch {
              return null
            }
          }),
        )
        results = details.filter((x): x is GeocodeResult => x !== null)
      }
    } else {
      console.warn(`geocode: goong autocomplete HTTP ${res.status} for q="${q}" — trying classic geocode`)
    }

    // 1b) classic Geocoding API fallback (full addresses)
    if (results.length === 0) results = await geocodeGoongClassic(q)
    if (results.length === 0) {
      console.warn(`geocode: goong 0 result for q="${q}" — falling through`)
    }
    return results
  } catch (e) {
    console.warn(
      `geocode: goong unreachable (${e instanceof Error ? e.message : e}) — falling through`,
    )
    return []
  }
}

async function geocodeNominatim(q: string): Promise<GeocodeResult[]> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=vn' +
    `&viewbox=105.60,21.18,106.05,20.70&bounded=1&q=${encodeURIComponent(q)}`
  const data = await fetchJson4<Array<{ display_name: string; lat: string; lon: string }>>(url, {
    timeoutMs: 5000,
  })
  if (Array.isArray(data)) {
    return data
      .filter((d) => d.lat && d.lon)
      .map((d) => ({
        name: d.display_name.split(',').slice(0, 3).join(', '),
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
        source: 'external' as const,
      }))
  }
  return []
}

export async function geocodeAddress(query: string): Promise<GeocodeResult[]> {
  const q = query.trim()
  if (!q) return []

  const key = q.toLowerCase()
  const hit = geoCache.get(key)
  if (hit) {
    const ttl = hit.results.length > 0 ? GEO_CACHE_TTL_MS : GEO_CACHE_TTL_MS / 6
    if (Date.now() - hit.at < ttl) return hit.results
  }

  // 1) Goong (VN house numbers) → 2) Nominatim → 3) local landmarks
  let results = await geocodeGoong(q)
  if (results.length === 0) results = await geocodeNominatim(q)
  if (results.length === 0) {
    const ql = q.toLowerCase()
    results = LOCAL_PLACES.filter((p) => p.name.toLowerCase().includes(ql)).slice(0, 6)
  }

  geoCache.set(key, { at: Date.now(), results })
  if (geoCache.size > GEO_CACHE_MAX) {
    const oldest = geoCache.keys().next().value
    if (oldest !== undefined) geoCache.delete(oldest)
  }
  return results
}

/** Local Hanoi landmark catalogue used as offline fallback */
export const LOCAL_PLACES: GeocodeResult[] = [
  { name: 'Hoan Kiem Lake, Hoan Kiem, Hanoi', lat: 21.0287, lng: 105.8524, source: 'local' },
  { name: 'Dong Xuan Market, Hoan Kiem, Hanoi', lat: 21.0361, lng: 105.8489, source: 'local' },
  { name: 'Old Quarter, Hoan Kiem, Hanoi', lat: 21.0335, lng: 105.8505, source: 'local' },
  { name: 'Ba Dinh Square, Ba Dinh, Hanoi', lat: 21.0336, lng: 105.8342, source: 'local' },
  { name: 'Temple of Literature, Dong Da, Hanoi', lat: 21.0278, lng: 105.8355, source: 'local' },
  { name: 'My Dinh, Nam Tu Liem, Hanoi', lat: 21.0276, lng: 105.7763, source: 'local' },
  { name: 'Keangnam Landmark 72, Nam Tu Liem, Hanoi', lat: 21.0224, lng: 105.7750, source: 'local' },
  { name: 'Big C Thang Long, Cau Giay, Hanoi', lat: 21.0269, lng: 105.7876, source: 'local' },
  { name: 'Cau Giay Park, Cau Giay, Hanoi', lat: 21.0302, lng: 105.7948, source: 'local' },
  { name: 'West Lake (Ho Tay), Tay Ho, Hanoi', lat: 21.0651, lng: 105.8231, source: 'local' },
  { name: 'Tay Ho District, Hanoi', lat: 21.0575, lng: 105.8220, source: 'local' },
  { name: 'Bach Mai Hospital, Hai Ba Trung, Hanoi', lat: 20.9921, lng: 105.8490, source: 'local' },
  { name: 'Times City, Hai Ba Trung, Hanoi', lat: 20.9975, lng: 105.8717, source: 'local' },
  { name: 'Royal City, Thanh Xuan, Hanoi', lat: 20.9994, lng: 105.8210, source: 'local' },
  { name: 'Dai Hoc Bach Kinh (HUST), Hai Ba Trung, Hanoi', lat: 21.0033, lng: 105.8430, source: 'local' },
  { name: 'National Economics University, Hai Ba Trung, Hanoi', lat: 21.0071, lng: 105.8406, source: 'local' },
  { name: 'Giap Bat Bus Station, Hoang Mai, Hanoi', lat: 21.0034, lng: 105.8412, source: 'local' },
  { name: 'Long Bien Bridge, Hanoi', lat: 21.0338, lng: 105.8592, source: 'local' },
  { name: 'Chuong Duong Bridge, Hanoi', lat: 21.0500, lng: 105.8620, source: 'local' },
  { name: 'Noi Bai International Airport, Soc Son, Hanoi', lat: 21.2212, lng: 105.8072, source: 'local' },
  { name: 'Vincom Nguyen Chi Thanh, Dong Da, Hanoi', lat: 21.0144, lng: 105.8069, source: 'local' },
  { name: 'Thang Long Industrial Park, Dong Anh, Hanoi', lat: 21.1000, lng: 105.8300, source: 'local' },
  { name: 'Hanoi Railway Station, Hoan Kiem, Hanoi', lat: 21.0223, lng: 105.8455, source: 'local' },
  { name: 'Trang Tien Plaza, Hoan Kiem, Hanoi', lat: 21.0245, lng: 105.8535, source: 'local' },
  { name: 'Lenin Park (Thong Nhat Park), Hai Ba Trung, Hanoi', lat: 21.0069, lng: 105.8435, source: 'local' },
  { name: 'Van Mieu - Quoc Tu Giam, Dong Da, Hanoi', lat: 21.0278, lng: 105.8355, source: 'local' },
  { name: 'Ho Tay Water Park, Tay Ho, Hanoi', lat: 21.0615, lng: 105.8155, source: 'local' },
  { name: 'Dong Da Hill, Dong Da, Hanoi', lat: 21.0170, lng: 105.8270, source: 'local' },
]

// ---------------------------------------------------------------- Routing

export type RouteResult = {
  coords: LatLng[]
  distanceKm: number
  durationMin: number // baseline driving duration
  source: 'osrm' | 'estimated'
}

export type RouteProfile = 'driving' | 'cycling' | 'walking'

const ROUTE_TIMEOUT_MS = 8000

/** In-memory route cache: identical trip requests within the TTL never re-hit the router */
const ROUTE_CACHE_TTL_MS = 30 * 60 * 1000
const ROUTE_CACHE_MAX = 200
const routeCache = new Map<string, { at: number; result: RouteResult }>()

function cacheKey(origin: LatLng, dest: LatLng, profile: RouteProfile): string {
  // round to 4 decimals (~11 m) so near-identical coordinates share a cache entry
  const r = (v: number) => Math.round(v * 10000) / 10000
  return `${profile}|${r(origin[0])},${r(origin[1])}|${r(dest[0])},${r(dest[1])}`
}

/** Slightly curved synthetic path between two points (last-resort offline fallback) */
function syntheticRoute(a: LatLng, b: LatLng): LatLng[] {
  const coords: LatLng[] = []
  const steps = 42
  const dx = b[1] - a[1]
  const dy = b[0] - a[0]
  const perpX = -dy
  const perpY = dx
  const mag = Math.hypot(perpX, perpY) || 1
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const bow = Math.sin(t * Math.PI) * 0.045 * (haversineKm(a, b) / 8 + 0.3)
    const lat = a[0] + dy * t + (perpY / mag) * bow
    const lng = a[1] + dx * t + (perpX / mag) * bow
    coords.push([lat, lng])
  }
  return coords
}

type OsrmJson = {
  code?: string
  routes?: Array<{ distance: number; duration: number; geometry?: { coordinates?: [number, number][] } }>
}

/** Call an OSRM-compatible endpoint; returns null when the response is unusable */
async function tryOsrm(base: string, origin: LatLng, dest: LatLng): Promise<RouteResult | null> {
  const url =
    `${base}/route/v1/driving/` +
    `${origin[1]},${origin[0]};${dest[1]},${dest[0]}` +
    `?overview=full&geometries=geojson&steps=false&annotations=false`
  const data = await fetchJson4<OsrmJson>(url, { timeoutMs: ROUTE_TIMEOUT_MS })
  const route = data?.routes?.[0]
  if (data?.code !== 'Ok' || !route?.geometry?.coordinates || route.geometry.coordinates.length < 2) {
    return null
  }
  const coords: LatLng[] = route.geometry.coordinates.map(
    (c) => [c[1], c[0]] as LatLng
  )
  return {
    coords,
    distanceKm: route.distance / 1000,
    durationMin: (route.duration / 60) * 1.35, // adjust for Hanoi traffic
    source: 'osrm',
  }
}

/**
 * Road-following route via public OSRM routers with a provider chain:
 *   1. FOSSGIS OSRM (the same router used by openstreetmap.org — fastest & most reliable)
 *   2. OSRM demo server (car profile only)
 *   3. deterministic synthetic curve (offline fallback — flagged as `estimated`)
 */
export async function getRoute(origin: LatLng, dest: LatLng, profile: RouteProfile = 'driving'): Promise<RouteResult> {
  const key = cacheKey(origin, dest, profile)
  const hit = routeCache.get(key)
  if (hit && Date.now() - hit.at < ROUTE_CACHE_TTL_MS) return hit.result

  const providers: string[] =
    profile === 'driving'
      ? ['https://routing.openstreetmap.de/routed-car', 'https://router.project-osrm.org']
      : profile === 'cycling'
        ? ['https://routing.openstreetmap.de/routed-bike']
        : ['https://routing.openstreetmap.de/routed-foot']

  for (const base of providers) {
    const result = await tryOsrm(base, origin, dest)
    if (result) {
      routeCache.set(key, { at: Date.now(), result })
      if (routeCache.size > ROUTE_CACHE_MAX) {
        const oldest = routeCache.keys().next().value
        if (oldest) routeCache.delete(oldest)
      }
      return result
    }
  }

  const coords = syntheticRoute(origin, dest)
  const distanceKm = haversineKm(origin, dest) * 1.35
  const result: RouteResult = {
    coords,
    distanceKm,
    durationMin: (distanceKm / 25) * 60,
    source: 'estimated',
  }
  routeCache.set(key, { at: Date.now(), result })
  return result
}

// ---------------------------------------------------------------- Air quality

export type AirQualityInfo = {
  aqi: number | null
  pm25: number | null
  pm10: number | null
  measuredAt: string
  source: 'open-meteo' | 'cache' | 'simulated'
  locationLabel: string
  notice?: string
}

function aqiLabel(aqi: number | null): { label: string; tone: 'good' | 'moderate' | 'unhealthy' | 'very-unhealthy' | 'hazardous' } {
  if (aqi == null) return { label: 'Unknown', tone: 'good' }
  if (aqi <= 50) return { label: 'Good', tone: 'good' }
  if (aqi <= 100) return { label: 'Moderate', tone: 'moderate' }
  if (aqi <= 150) return { label: 'Unhealthy (sensitive)', tone: 'unhealthy' }
  if (aqi <= 200) return { label: 'Unhealthy', tone: 'very-unhealthy' }
  return { label: 'Hazardous', tone: 'hazardous' }
}

export { aqiLabel }

/**
 * Deterministic simulation used when the external Air Quality Service is
 * temporarily unavailable and no cached data exists (US-19).
 * Rush hours in Hanoi push PM2.5 / AQI up.
 */
export function simulateAirQuality(lat: number, lng: number): AirQualityInfo {
  const hour = new Date().getHours()
  const seed = Math.abs(Math.sin(lat * 100 + lng * 77)) * 12
  let base = 68 + seed
  if (hour >= 7 && hour <= 9) base += 28
  if (hour >= 17 && hour <= 20) base += 32
  if (hour >= 1 && hour <= 4) base -= 22
  base = Math.max(25, Math.min(215, base))
  const pm25 = base * 0.52
  const pm10 = base * 0.78
  return {
    aqi: Math.round(base),
    pm25: Math.round(pm25 * 10) / 10,
    pm10: Math.round(pm10 * 10) / 10,
    measuredAt: new Date().toISOString(),
    source: 'simulated',
    locationLabel: 'Estimated from local model',
    notice: 'External air quality service is unavailable. This is an estimated value and may be outdated.',
  }
}
