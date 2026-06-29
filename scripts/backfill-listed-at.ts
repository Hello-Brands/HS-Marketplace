// One-time backfill: set listings.listedAt = createdAt for every listing that
// has ever been live (active/sold/delisted) and has no listedAt yet.
// Run once after db:push:  npx tsx scripts/backfill-listed-at.ts
import { db } from "@/db"
import { listings } from "@/db/schema/listings"
import { isNull, inArray, sql } from "drizzle-orm"

async function main() {
  const result = await db
    .update(listings)
    .set({ listedAt: sql`${listings.createdAt}` })
    .where(
      sql`${listings.listedAt} is null and ${listings.status} in ('active','sold','delisted')`,
    )
    .returning({ id: listings.id })
  console.log(`Backfilled listedAt for ${result.length} listing(s).`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
