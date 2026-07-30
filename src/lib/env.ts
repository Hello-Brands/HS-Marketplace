import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

const skipValidation = !!process.env.SKIP_ENV_VALIDATION

const validatedEnv = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    DATABASE_URL_DIRECT: z.string().url(),
    AUTH_SECRET: z.string().min(32),
    AUTH_GOOGLE_ID: z.string().min(1),
    AUTH_GOOGLE_SECRET: z.string().min(1),
    RESEND_API_KEY: z.string().startsWith("re_"),
    EMAIL_FROM: z.string().min(1).optional(),
    EMAIL_OVERRIDE: z.string().optional(),
    INITIAL_ADMIN_EMAIL: z.string().email().optional(),
    GOOGLE_WORKSPACE_DOMAIN: z.string().default("hellosugar.salon"),
    BLOB_READ_WRITE_TOKEN: z.string().min(1),
    ACTION_TOKEN_SECRET: z.string().min(32),
    CRON_SECRET: z.string().min(16),
    // Server-side MapTiler key for backfill/geocoding. Must be UNRESTRICTED
    // (no domain allowlist) — server requests send no Origin header.
    MAPTILER_API_KEY: z.string().min(1).optional(),
    BOULEVARD_API_URL: z.string().url().optional(),
    BOULEVARD_API_KEY: z.string().min(1).optional(),
    // BigQuery / GCP credentials (read by src/lib/bigquery/client.ts).
    BIGQUERY_PROJECT_ID: z.string().min(1).optional(),
    GCP_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
    BIGQUERY_CREDENTIALS: z.string().min(1).optional(),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
    // Fine-grained PAT for Hello-Brands/competitor-monitor repository_dispatch
    // (read by src/lib/brand-requests/dispatch.ts). Optional: when unset,
    // dispatches fail soft and admins retry from the request detail view.
    GITHUB_DISPATCH_TOKEN: z.string().min(1).optional(),
    // Internal KPI API (read by src/lib/kpi/fetch.ts).
    HS_INTERNAL_API_URL: z.string().url().optional(),
    HS_INTERNAL_API_TOKEN: z.string().min(1).optional(),
    // Placeholder — declared for future error-monitoring wiring, not read yet.
    SENTRY_DSN: z.string().optional(),
  },
  client: {
    // Public key exposed to client — domain-restricted in MapTiler Cloud dashboard
    NEXT_PUBLIC_MAPTILER_API_KEY: z.string().min(1),
    // Absolute base URL used to build links in emails/cron notifications.
    NEXT_PUBLIC_APP_URL: z.string().url(),
    // Placeholder — declared for future error-monitoring wiring, not read yet.
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_MAPTILER_API_KEY: process.env.NEXT_PUBLIC_MAPTILER_API_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  // Validate in dev/build/runtime; skipped under the test runner, which sets
  // SKIP_ENV_VALIDATION (see vitest.config.mts) so tests don't need real vars.
  skipValidation,
})

// Under the test runner (SKIP_ENV_VALIDATION set), @t3-oss/env-nextjs builds
// runtimeEnv as `{ ...process.env, ...experimental__runtimeEnv }` — a snapshot
// captured at import time. That means `vi.stubEnv()` calls made in a test's
// beforeEach (i.e. AFTER the module graph is imported) would not be visible
// through `env.X`. To keep `env.X` behaving exactly like the raw `process.env.X`
// reads these call sites used to do, expose a live view of process.env in test
// mode. Validation stays skipped in both branches.
export const env = skipValidation
  ? (new Proxy({} as Record<string, string | undefined>, {
      get: (_target, prop) => (typeof prop === "string" ? process.env[prop] : undefined),
    }) as unknown as typeof validatedEnv)
  : validatedEnv
