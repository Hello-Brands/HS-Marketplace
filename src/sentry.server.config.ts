// Sentry server-runtime init (Node.js). Loaded from instrumentation.ts `register()`.
// Inert unless SENTRY_DSN is set (provision it in Vercel prod env), so this is a
// no-op in local/dev/test and until ops turns it on. Read via process.env directly
// (not the validated env module) to stay safe across the edge/node boundary and to
// match Sentry's standard config convention.
import * as Sentry from "@sentry/nextjs"

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    // Conservative default; tune once real prod traffic is observed.
    tracesSampleRate: 0.1,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  })
}
