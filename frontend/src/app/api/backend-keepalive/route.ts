import net from 'net'
import { spawn } from 'child_process'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** TCP probe: is anything listening on 127.0.0.1:8000? */
function probePort(port: number, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const done = (up: boolean) => {
      socket.destroy()
      resolve(up)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
}

/**
 * Backend self-healing keepalive.
 *
 * The sandbox reaps shell-spawned background processes, but children of the
 * boot-born Next.js server survive. When the API is down, this route spawns
 * scripts/ensure-backend.sh (installs deps if needed, ensures the Postgres
 * database, starts uvicorn) as a DETACHED CHILD OF THIS SERVER, so the API
 * stays up for the whole session. The frontend pings this route on load and
 * every 45s.
 */
export async function GET() {
  const up = await probePort(8000)
  if (up) {
    return NextResponse.json({ backend: 'up' })
  }

  // Spawn detached so the script outlives this request; unref so Node does
  // not wait for it. The script double-checks port 8000 before starting.
  const child = spawn('bash', ['/home/z/my-project/scripts/ensure-backend.sh'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })
  child.unref()

  return NextResponse.json({ backend: 'starting', pid: child.pid })
}
