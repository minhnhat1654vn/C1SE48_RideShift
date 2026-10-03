#!/usr/bin/env bun
/**
 * User-space PostgreSQL manager for RideShift (no root required).
 *
 * Uses the PostgreSQL 18 binaries bundled with the `embedded-postgres`
 * dev dependency. The cluster lives in db/pgdata and listens on port 5432.
 *
 * Commands:
 *   bun scripts/postgres.ts start    # init (first run) + start server
 *   bun scripts/postgres.ts stop     # fast shutdown
 *   bun scripts/postgres.ts status   # is the server running?
 *   bun scripts/postgres.ts restart
 *
 * Connection (auth=trust, local sandbox):
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:5432/rideshift
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const PLATFORM_PKG = path.join(ROOT, 'node_modules', '@embedded-postgres', 'linux-x64')
const BIN = path.join(PLATFORM_PKG, 'native', 'bin')
const NATIVE_LIB = path.join(PLATFORM_PKG, 'native', 'lib')
const PGDATA = path.join(ROOT, 'db', 'pgdata')
const LOG = path.join(ROOT, 'db', 'pg.log')
const PORT = 5432

/** bun blocks npm postinstall scripts: re-create the ICU symlinks ourselves. */
function hydrateSymlinks() {
  const linksFile = path.join(PLATFORM_PKG, 'native', 'pg-symlinks.json')
  if (!existsSync(linksFile)) return
  try {
    // JSON semantics: source = real file, target = symlink path to create
    // (both relative to PLATFORM_PKG). bun strips npm-created symlinks.
    const links = JSON.parse(readFileSync(linksFile, 'utf8')) as { source: string; target: string }[]
    for (const { source, target } of links) {
      const realFile = path.join(PLATFORM_PKG, source)
      const linkPath = path.join(PLATFORM_PKG, target)
      if (existsSync(realFile) && !existsSync(linkPath)) {
        mkdirSync(path.dirname(linkPath), { recursive: true })
        try {
          symlinkSync(realFile, linkPath)
        } catch {
          // already exists — fine
        }
      }
    }
  } catch {
    // non-fatal
  }
}

function initIfMissing() {
  if (existsSync(PGDATA)) return
  console.log('Initializing PostgreSQL cluster at db/pgdata (first run)...')
  execFileSync(
    path.join(BIN, 'initdb'),
    ['-D', PGDATA, '-U', 'postgres', '--no-locale', '-E', 'UTF8', '--auth-local=trust', '--auth-host=trust'],
    { stdio: 'inherit', env: { ...process.env, LD_LIBRARY_PATH: NATIVE_LIB } }
  )
}

/** The bundled bin/ has no createdb/psql — create the app DB via python psycopg. */
function ensureDatabase() {
  const py = [
    "import psycopg",
    "conn = psycopg.connect('postgresql://postgres@127.0.0.1:5432/postgres', autocommit=True)",
    "row = conn.execute(\"SELECT 1 FROM pg_database WHERE datname='rideshift'\").fetchone()",
    "if row is None:",
    "    conn.execute('CREATE DATABASE rideshift')",
    "    print('database rideshift created')",
    "else:",
    "    print('database rideshift already exists')",
    "conn.close()",
  ].join('\n')
  try {
    execFileSync('python3', ['-c', py], {
      stdio: 'inherit',
      env: { ...process.env, LD_LIBRARY_PATH: NATIVE_LIB },
    })
  } catch (e) {
    console.warn(`WARN: could not ensure rideshift database (${(e as Error).message})`)
  }
}

const command = process.argv[2] as 'start' | 'stop' | 'status' | 'restart' | undefined
if (!command || !['start', 'stop', 'status', 'restart'].includes(command)) {
  console.error('Usage: bun scripts/postgres.ts <start|stop|status|restart>')
  process.exit(1)
}

if (!existsSync(path.join(BIN, 'pg_ctl'))) {
  console.error('PostgreSQL binaries missing — run `bun install` first.')
  process.exit(1)
}

hydrateSymlinks()
initIfMissing()

const PG_ENV = { ...process.env, LD_LIBRARY_PATH: NATIVE_LIB }

function serverRunning(): boolean {
  try {
    execFileSync(path.join(BIN, 'pg_ctl'), ['-D', PGDATA, 'status'], { stdio: 'ignore', env: PG_ENV })
    return true
  } catch {
    return false
  }
}

if (command === 'start') {
  if (serverRunning()) {
    console.log('PostgreSQL already running — nothing to do.')
  } else {
    execFileSync(
      path.join(BIN, 'pg_ctl'),
      ['-D', PGDATA, '-o', `-p ${PORT} -k /tmp`, '-l', LOG, 'start'],
      { stdio: 'inherit', env: PG_ENV }
    )
  }
  ensureDatabase()
} else if (command === 'restart') {
  execFileSync(path.join(BIN, 'pg_ctl'), ['-D', PGDATA, '-m', 'fast', 'restart'], {
    stdio: 'inherit',
    env: PG_ENV,
  })
  ensureDatabase()
} else if (command === 'stop') {
  execFileSync(path.join(BIN, 'pg_ctl'), ['-D', PGDATA, '-m', 'fast', 'stop'], {
    stdio: 'inherit',
    env: PG_ENV,
  })
} else {
  // status
  execFileSync(path.join(BIN, 'pg_ctl'), ['-D', PGDATA, 'status'], { stdio: 'inherit', env: PG_ENV })
}
