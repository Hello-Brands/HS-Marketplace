import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    DATABASE_URL_DIRECT: z.string().url(),
    AUTH_SECRET: z.string().min(32),
    AUTH_GOOGLE_ID: z.string().min(1),
    AUTH_GOOGLE_SECRET: z.string().min(1),
    RESEND_API_KEY: z.string().startsWith("re_"),
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
  },
  client: {
    // Public key exposed to client — domain-restricted in MapTiler Cloud dashboard
    NEXT_PUBLIC_MAPTILER_API_KEY: z.string().min(1),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_MAPTILER_API_KEY: process.env.NEXT_PUBLIC_MAPTILER_API_KEY,
  },
  // Validate in dev/build/runtime; skipped under the test runner, which sets
  // SKIP_ENV_VALIDATION (see vitest.config.mts) so tests don't need real vars.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
})
