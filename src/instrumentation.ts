// Error monitoring (DEBT-026 → pre-launch audit 2026-07-06, Pillar 2 High).
//
// `register()` initializes Sentry for the active runtime; `onRequestError` fires for
// every uncaught server-side error (Server Components, route handlers, server actions)
// and both (a) emits a structured log line for Vercel runtime logging and (b) forwards
// the error to Sentry. Sentry is INERT until SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN are set
// (provision in Vercel prod env), so nothing changes locally or in tests until ops turns
// it on. Structured logging remains as a dependency-free floor so the app never launches
// blind even before the DSN is provisioned.
import type { Instrumentation } from "next"
import * as Sentry from "@sentry/nextjs"

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as { name?: string; message?: string; stack?: string } | undefined
  console.error(
    JSON.stringify({
      level: "error",
      source: "onRequestError",
      name: e?.name ?? "UnknownError",
      message: e?.message ?? String(err),
      method: request?.method,
      path: request?.path,
      routePath: context?.routePath,
      routeType: context?.routeType,
      stack: e?.stack,
    }),
  )

  // Forward to Sentry (no-op until a DSN is configured).
  await Sentry.captureRequestError(err, request, context)
}
