import { test, expect } from "@playwright/test"

// Admin smoke path: /admin/queue loads behind auth. AdminLayout
// (src/app/admin/layout.tsx) redirects unauthenticated visitors to /login
// and non-admin users to /access-denied, so the redirect case is real and
// runs without a session; the authed moderation-queue view is scaffolded
// with test.skip until a seeded admin session is available.

test.describe("admin: moderation queue", () => {
  test("signed-out visitor hitting /admin/queue is redirected to /login", async ({
    page,
  }) => {
    await page.goto("/admin/queue")

    await expect(page).toHaveURL(/\/login$/)
  })

  // TODO: needs a seeded authenticated session for a user with role "admin"
  // (see AdminLayout's `session.user.role !== 'admin'` check). Unskip once
  // auth fixtures / a test admin user exist. Selectors below match the real
  // markup (src/app/admin/queue/page.tsx, src/components/admin/ModerationQueue.tsx).
  test.skip("admin sees the pending-listings approval queue", async ({ page }) => {
    await page.goto("/admin/queue")

    await expect(page.getByRole("heading", { name: "Approval Queue" })).toBeVisible()
    await expect(page.getByText(/listing.* pending/)).toBeVisible()
  })
})
