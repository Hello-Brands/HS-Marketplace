// Sentry edge-runtime init (middleware / edge routes). Loaded from instrumentation.ts
// `register()`. Inert unless SENTRY_DSN is set. See sentry.server.config.ts.
import * as Sentry from "@sentry/nextjs"

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  })
}
