#!/usr/bin/env node
/**
 * Guard around `drizzle-kit push`.
 *
 * `push` mutates the database schema directly WITHOUT generating a tracked
 * migration file. That is exactly how production drifted (pre-launch audit
 * 2026-07-06 — the schema-migrations Blocker: four tables and a column rename
 * reached prod via push with no migration recording them).
 *
 * Push is allowed only against a local database, or with an explicit
 * ALLOW_REMOTE_PUSH=1 override for a deliberate scratch-DB case.
 *
 * For real schema changes use the tracked path:
 *   npm run db:generate   ->   review the SQL   ->   npm run db:migrate
 */
import { spawnSync } from 'node:child_process'

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || ''
const redacted = url.replace(/:\/\/[^@/]*@/, '://***@')
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) || url.includes('localhost')
const override = process.env.ALLOW_REMOTE_PUSH === '1'

if (!url) {
  console.error('[db:push guard] No DATABASE_URL_DIRECT/DATABASE_URL set. Refusing to push.')
  process.exit(1)
}

if (!isLocal && !override) {
  console.error(
    '\n[db:push guard] Refusing `drizzle-kit push` against a non-local database.\n' +
      `  target: ${redacted}\n\n` +
      'Push mutates schema without a tracked migration — this is how prod drifted.\n' +
      'For schema changes use:  npm run db:generate  ->  review SQL  ->  npm run db:migrate\n' +
      'For a local/scratch DB, point DATABASE_URL_DIRECT at localhost.\n' +
      'To override intentionally (rare):  ALLOW_REMOTE_PUSH=1 npm run db:push\n',
  )
  process.exit(1)
}

const res = spawnSync('npx', ['drizzle-kit', 'push'], { stdio: 'inherit', shell: true })
process.exit(res.status ?? 1)
