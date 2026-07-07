import { test, expect } from "@playwright/test"

// Seller smoke path: /seller/listings/new loads -> wizard step 1 -> advance
// to step 2. This is the exact flow that regressed in the wizard bug fixed
// on this branch (step-scoped validation blocking advancement), so it's the
// highest-value seller path to guard going forward.

test.describe("seller: new listing wizard", () => {
  test("signed-out visitor hitting /seller/listings/new is redirected to /login", async ({
    page,
  }) => {
    await page.goto("/seller/listings/new")

    await expect(page).toHaveURL(/\/login$/)
  })

  // TODO: needs a seeded authenticated session (NextAuth/Google) for a user
  // with at least one Hello Sugar location assigned, so LocationSelector has
  // something to pick (src/components/listings/LocationSelector.tsx). Unskip
  // once auth fixtures / a test user + seed script exist. Selectors below
  // match the real markup:
  //   - disclaimer checkbox + "Continue to Form" button
  //     (src/components/listings/ListingDisclaimerGate.tsx)
  //   - step 1 type buttons ("Suite" etc.) + "Next" button
  //     (src/components/listings/steps/TypeLocationStep.tsx)
  //   - step 2 heading "Verified data (pulled from Hello Sugar)"
  //     (src/components/listings/steps/FinancialsStep.tsx)
  test.skip("seller can complete step 1 and advance to step 2", async ({ page }) => {
    await page.goto("/seller/listings/new")

    // Disclaimer gate must be acknowledged before the wizard renders.
    await page.getByRole("checkbox").check()
    await page.getByRole("button", { name: "Continue to Form" }).click()

    // Step 1: pick a listing type and a location, then advance.
    await page.getByRole("button", { name: "Suite", exact: true }).click()
    // TODO: select a location from LocationSelector once seeded data exists.
    await page.getByRole("button", { name: "Next", exact: true }).click()

    // Step 2 (FinancialsStep) should now be visible.
    await expect(
      page.getByText("Verified data (pulled from Hello Sugar)")
    ).toBeVisible()
  })
})
