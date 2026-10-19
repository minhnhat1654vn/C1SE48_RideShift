// Frontend → backend gateway helper.
//
// Architecture (per proposal): the Next.js app is the React front-end only.
// All REST calls go to the Python + FastAPI backend service
// (mini-services/fastapi-backend) listening on port 8000. In this sandbox
// every request is routed through the local gateway using the
// `XTransformPort` query parameter; in a standard deployment set
// NEXT_PUBLIC_API_BASE to the FastAPI origin instead.

const BACKEND_PORT = 8000

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? ''

/** Rewrite an app-relative /api/... path to the FastAPI backend. */
export function apiUrl(path: string): string {
  if (API_BASE) return `${API_BASE}${path}`
  const [base, query] = path.split('?')
  const params = new URLSearchParams(query ?? '')
  params.set('XTransformPort', String(BACKEND_PORT))
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

/** fetch wrapper with the same semantics the components already use.
 *
 * `credentials: 'include'` is REQUIRED for the Docker deployment where the
 * browser talks to the backend cross-origin (localhost:3000 → localhost:8000):
 * the default 'same-origin' mode neither sends nor stores the admin session
 * cookie (`rs_admin_session`) on cross-origin requests, which logged everyone
 * out on refresh. On the sandbox (same-origin gateway) it is a no-op. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), { credentials: 'include', ...init })
}
