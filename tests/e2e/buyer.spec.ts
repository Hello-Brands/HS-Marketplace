import { test, expect } from "@playwright/test"

// Buyer smoke path: home/browse loads -> open a listing detail -> contact CTA
// present. Every authed route in this app redirects to /login when there is
// no session (see src/app/browse/page.tsx, src/app/listings/[id]/page.tsx),
// so the two tests below split the flow: the redirect behavior is real and
// runs unauthenticated, while the deeper authed flow is scaffolded with
// test.skip until a seeded session is available (see TODO).

test.describe("buyer: browse and listing detail", () => {
  test("signed-out visitor sees the marketing home page", async ({ page }) => {
    await page.goto("/")

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hello Sugar")
    await expect(page.getByRole("link", { name: "Sign In" }).first()).toHaveAttribute(
      "href",
      "/login"
    )
  })

  test("signed-out visitor hitting /browse is redirected to /login", async ({ page }) => {
    await page.goto("/browse")

    await expect(page).toHaveURL(/\/login$/)
  })

  // TODO: needs a seeded authenticated session (NextAuth/Google) + at least
  // one published listing in the DB. Unskip once auth fixtures / a test user
  // + seed script exist (see storageState pattern:
  // https://playwright.dev/docs/auth). Selectors below are wired to the real
  // markup (ListingCard -> /listings/[id], ContactForm "Send Message" button)
  // so this only needs a logged-in `page` to run for real.
  test.skip("signed-in buyer can open a listing and see the contact CTA", async ({ page }) => {
    await page.goto("/browse")

    // ListingCard links to /listings/{id} (src/components/browse/ListingCard.tsx)
    const firstListing = page.locator('a[href^="/listings/"]').first()
    await expect(firstListing).toBeVisible()
    await firstListing.click()

    await expect(page).toHaveURL(/\/listings\/[^/]+$/)

    // ContactForm (src/app/listings/[id]/ContactForm.tsx) renders a "Send
    // Message" submit button once a buyer has not yet contacted the seller.
    await expect(page.getByRole("button", { name: "Send Message" })).toBeVisible()
  })
})
