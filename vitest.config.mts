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
    globals: true,
    env: {
      SKIP_ENV_VALIDATION: "1",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})
