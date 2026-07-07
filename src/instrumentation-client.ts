// Sentry browser init. Next.js loads this file automatically on the client.
// Inert unless NEXT_PUBLIC_SENTRY_DSN is set, so it's a no-op in local/dev/test and
// until ops provisions the DSN in Vercel.
import * as Sentry from "@sentry/nextjs"

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
  })
}

// Instruments client-side navigations for tracing (no-op when Sentry isn't initialized).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
