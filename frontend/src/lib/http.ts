// Low-level HTTP client for external services (routing, geocoding, air quality).
//
// Why not global fetch? Node's fetch (undici) uses Happy-Eyeballs connection
// racing and, in some sandboxed network environments, its IPv6 attempt fails
// with ENETUNREACH and its IPv4 attempt is aborted with a fast ETIMEDOUT even
// though plain IPv4 TCP/TLS connections work perfectly (verified with
// node:https `family: 4` and curl). Until that is fixed upstream, every
// external request goes through node:https pinned to IPv4.

import https from 'node:https'
import http from 'node:http'
import zlib from 'node:zlib'

const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_UA = 'RideShift/1.0 (C1SE.48 Capstone)'

export type RawHttpOptions = {
  timeoutMs?: number
  headers?: Record<string, string>
  method?: 'GET' | 'POST'
  body?: string
}

export type RawHttpResponse = {
  status: number
  data: unknown // parsed JSON when possible, raw text otherwise
  text: string
}

function decompress(buf: Buffer, encoding?: string | string[]): Buffer {
  const enc = (Array.isArray(encoding) ? encoding[0] : encoding ?? '').toLowerCase()
  try {
    if (enc.includes('br')) return zlib.brotliDecompressSync(buf)
    if (enc.includes('gzip')) return zlib.gunzipSync(buf)
    if (enc.includes('deflate')) return zlib.inflateSync(buf)
  } catch {
    return buf
  }
  return buf
}

export function rawHttpRequest(url: string, opts: RawHttpOptions = {}): Promise<RawHttpResponse> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, method = 'GET', body } = opts
  return new Promise((resolve, reject) => {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      reject(new Error(`Invalid URL: ${url}`))
      return
    }
    const client = u.protocol === 'http:' ? http : https
    const req = client.request(
      u,
      {
        method,
        // force IPv4 — IPv6 is unreachable in many sandboxed networks
        family: 4,
        timeout: timeoutMs,
        headers: {
          'User-Agent': DEFAULT_UA,
          Accept: 'application/json, text/plain;q=0.8',
          ...(body
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0
        // follow up to 3 redirects (301/302/307/308) as cheap insurance
        if ([301, 302, 307, 308].includes(status) && res.headers.location) {
          res.resume() // drain
          const next = new URL(res.headers.location, u).toString()
          rawHttpRequest(next, { ...opts, headers: { ...headers, 'User-Agent': DEFAULT_UA } })
            .then(resolve, reject)
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = decompress(Buffer.concat(chunks), res.headers['content-encoding']).toString('utf-8')
          let data: unknown = text
          try {
            data = JSON.parse(text)
          } catch {
            // keep raw text
          }
          resolve({ status, data, text })
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

/**
 * GET a JSON document pinned to IPv4.
 * Returns null on any failure (network error, timeout, non-2xx, invalid JSON).
 */
export async function fetchJson4<T>(url: string, opts: RawHttpOptions = {}): Promise<T | null> {
  try {
    const res = await rawHttpRequest(url, opts)
    if (res.status < 200 || res.status >= 300) return null
    return res.data as T
  } catch {
    return null
  }
}
