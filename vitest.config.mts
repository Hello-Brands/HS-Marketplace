import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"

// NOTE: this config is .mts (ESM) on purpose. Under .ts the CJS loader pulls in
// vitest/config's CJS build, which require()s the ESM-only std-env and crashes
// on Node < 20.19 (ERR_REQUIRE_ESM). Loading as ESM resolves vitest/config to
// its ESM build. `import.meta.dirname` replaces __dirname (unavailable in ESM).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    // Playwright e2e specs live under tests/e2e/**/*.spec.ts — already outside
    // the include glob above (different dir, different suffix), but excluded
    // explicitly too so vitest's `test`/`expect` globals never collide with
    // @playwright/test's globals if the layout ever changes.
    exclude: ["tests/e2e/**", "node_modules/**"],
    globals: true,
    // Eight test files use `vi.resetModules()` + dynamic `await import()` to
    // rewire module-level mocks per test, which re-transforms the module graph
    // on every case. Cumulative import time on a Windows dev box runs ~60s, so
    // under parallel workers those re-imports routinely exceed vitest's 5s
    // default and fail as timeouts — every affected test passes in isolation.
    // Raised to 30s so CPU contention can't masquerade as a test failure.
    testTimeout: 30000,
    env: {
      SKIP_ENV_VALIDATION: "1",
      RESEND_API_KEY: "re_test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // `server-only` is a Next.js bundler marker with no standalone resolution;
      // stub it so tests can import modules that guard themselves with it.
      "server-only": path.resolve(import.meta.dirname, "./test/stubs/server-only.ts"),
    },
  },
})
