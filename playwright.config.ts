import { defineConfig, devices } from "@playwright/test"

// e2e smoke suite. NEVER point this at the live prod app
// (https://marketplace.hellosugar.salon) — a prior manual audit run against
// prod created ~12 junk listings there. Base URL is env-driven and defaults
// to localhost so an accidental `npx playwright test` never touches prod.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // gitignored — see .gitignore (playwright-report/, test-results/)
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Opt-in only: uncomment to have Playwright boot a local prod-mode server
  // (`npm run start`, i.e. `next start`) before the suite and reuse it if one
  // is already running. Left commented out on purpose so importing/running
  // this config never auto-starts a server — CI/preview wiring should decide
  // when this is turned on, and it must never target prod.
  //
  // webServer: {
  //   command: "npm run start",
  //   url: baseURL,
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120_000,
  // },
})
