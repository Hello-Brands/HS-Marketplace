// READ-ONLY data audit (DEBT-020). Follow-up to DEBT-001: while the admin
// dollars->cents bug was live (fixed 2026-07-02, PR #23), admin-edited money
// fields were stored at 1/100th of their real value. The code path is fixed,
// but historical rows may still hold corrupted values.
//
// This script ONLY READS. It flags listings whose money fields are implausibly
// low so a human can confirm and repair them manually. It writes nothing.
//
// Run:  npx tsx scripts/audit-cents-corruption.ts
//   (needs DATABASE_URL in the environment, like the other scripts here)
import { db } from "@/db"
import { listings } from "@/db/schema/listings"
import { lt } from "drizzle-orm"

// The bug fix landed 2026-07-02. Rows last updated before then are the prime
// suspects, but we surface every implausibly-low row regardless of date.
const FIX_DATE = new Date("2026-07-02T00:00:00Z")

// Threshold in CENTS. A real business asking price below $10,000 is almost
// certainly a 100x-too-small corrupted value (dollars stored into a cents
// column). ttm_profit is shown for context but not thresholded — it can be
// legitimately small or negative, so asking_price is the reliable signal.
const ASKING_MIN_CENTS = 10_000 * 100 // $10,000

const fmtUsd = (cents: number | null) =>
  cents == null ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function main() {
  const rows = await db
    .select({
      id: listings.id,
      sellerId: listings.sellerId,
      status: listings.status,
      askingPrice: listings.askingPrice,
      ttmProfit: listings.ttmProfit,
      createdAt: listings.createdAt,
      updatedAt: listings.updatedAt,
    })
    .from(listings)
    .where(lt(listings.askingPrice, ASKING_MIN_CENTS))

  if (rows.length === 0) {
    console.log("No implausibly-low money values found. Nothing to review.")
    return
  }

  console.log(
    `Found ${rows.length} listing(s) with a suspiciously low asking price.\n` +
      `Threshold: asking_price < ${fmtUsd(ASKING_MIN_CENTS)}.\n` +
      `"pre-fix?" = last updated before ${FIX_DATE.toISOString().slice(0, 10)} (prime suspects).\n` +
      `Review each; if a value is 100x too small, the repair is value * 100.\n`,
  )

  for (const r of rows) {
    const preFix = r.updatedAt < FIX_DATE ? "YES" : "no"
    console.log(
      [
        `id=${r.id}`,
        `status=${r.status}`,
        `asking=${fmtUsd(r.askingPrice)}`,
        `ttmProfit=${fmtUsd(r.ttmProfit)}`,
        `updated=${r.updatedAt.toISOString().slice(0, 10)}`,
        `pre-fix?=${preFix}`,
        `seller=${r.sellerId}`,
      ].join("  "),
    )
  }

  console.log(
    `\nThis was READ-ONLY. To repair a confirmed row, run a targeted UPDATE ` +
      `manually (e.g. set asking_price = asking_price * 100 for the specific id).`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
