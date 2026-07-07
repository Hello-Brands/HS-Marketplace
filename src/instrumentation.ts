// Error monitoring hook (DEBT-026). Next's `onRequestError` fires for every
// uncaught server-side error (Server Components, route handlers, server actions).
// We emit a single structured line so production errors are captured by Vercel's
// runtime logging/observability instead of vanishing.
//
// To upgrade to Sentry: `npm i @sentry/nextjs`, set SENTRY_DSN, and forward `err`
// from here (and add the client/edge configs). Structured logging is the
// dependency-free interim so the app does not launch blind.

type RequestErrorContext = {
  routerKind: string
  routePath: string
  routeType: string
}

export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: RequestErrorContext,
) {
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
}
