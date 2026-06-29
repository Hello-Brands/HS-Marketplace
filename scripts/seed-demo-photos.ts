/**
 * Seed demonstration salon photos onto active listings.
 *
 * Why this exists: active listings ship with no photos, so the marketplace
 * browse/detail UI looks empty in demos. This attaches a rotating set of
 * curated, free-to-use salon/beauty-studio stock photos (Unsplash) to each
 * active listing so the collage, gallery, and cards render realistically.
 *
 * Demo photos are isolated under a `demo/` blob prefix and identified in the DB
 * by their URL, so `--clean` can remove every demo photo without touching real
 * seller uploads.
 *
 * Run:  npx tsx scripts/seed-demo-photos.ts             (seed active listings)
 *       npx tsx scripts/seed-demo-photos.ts --dry-run   (no writes, just report)
 *       npx tsx scripts/seed-demo-photos.ts --clean     (remove all demo photos)
 *       npx tsx scripts/seed-demo-photos.ts --include-drafts  (also seed drafts)
 *
 * Requires BLOB_READ_WRITE_TOKEN (public store) + DATABASE_URL in .env.local.
 * Safe to re-run: it skips listings that already have photos.
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/neon-http"
import { neon } from "@neondatabase/serverless"
import { eq, inArray, like } from "drizzle-orm"
import { put, del } from "@vercel/blob"
import { listings, listingPhotos } from "../src/db/schema/listings"

const DRY_RUN = process.argv.includes("--dry-run")
const CLEAN = process.argv.includes("--clean")
const INCLUDE_DRAFTS = process.argv.includes("--include-drafts")

const PHOTOS_PER_LISTING = 5
// Blob folder that scopes every demo photo (used by --clean to find them).
const DEMO_PREFIX = "demo/listings"
// Substring that marks a listing_photos row as demo data.
const DEMO_URL_MARKER = "/demo/listings/"

// Curated Unsplash photo IDs — clean, modern salon/beauty-studio interiors.
// Heroes first; accents last. Hot-linkable & free to use (Unsplash license).
const SALON_IMAGES = [
  "1626383137804-ff908d2753a2", // salon chair row (hero)
  "1695527081848-1e46c06e6458", // stylist blow-dry, bright (hero)
  "1695527081874-b674c46f40fb", // bright studio with plants (hero)
  "1746723378067-83a345ff3160", // reception desk + product wall (hero)
  "1626383120723-2a941488860d", // styling chair + artwork (hero)
  "1695527081728-e3a42f0ce261", // studio with mural, treatment (hero)
  "1695527081827-fdbc4e77be9b", // shampoo basin + plant
  "1676536162793-faa565d976d4", // nail-polish wall + plants
  "1695527081882-a8b051dac51e", // mirror vignette, products (accent)
  "1695527081851-289a6214969d", // organic mirror reflection (accent)
  "1637777277435-3c44f82fd0c9", // neon "really pretty" sign (accent)
  "1695527082039-5f96003b97e4", // dried-flower arrangement (accent)
]

function imageUrl(id: string): string {
  return `https://images.unsplash.com/photo-${id}?w=1600&h=1067&fit=crop&q=80`
}

// 5 distinct images per listing; rotate the window so every listing gets a
// different cover (start = i*5 mod pool size).
function imagesForListing(index: number): string[] {
  const n = SALON_IMAGES.length
  const start = (index * PHOTOS_PER_LISTING) % n
  return Array.from({ length: PHOTOS_PER_LISTING }, (_, k) => imageUrl(SALON_IMAGES[(start + k) % n]))
}

function getEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing ${name} in .env.local`)
  return v
}

async function main() {
  const token = getEnv("BLOB_READ_WRITE_TOKEN")
  const db = drizzle(neon(getEnv("DATABASE_URL")))

  if (CLEAN) {
    await clean(db, token)
    return
  }

  const statuses = INCLUDE_DRAFTS ? ["active", "draft"] : ["active"]
  const targets = await db
    .select({ id: listings.id, title: listings.title, status: listings.status })
    .from(listings)
    .where(inArray(listings.status, statuses as ("active" | "draft")[]))

  console.log(`Found ${targets.length} listing(s) with status ${statuses.join("/")}`)
  if (DRY_RUN) console.log("(--dry-run: no uploads or DB writes)\n")

  let seeded = 0
  let skipped = 0

  for (let i = 0; i < targets.length; i++) {
    const listing = targets[i]
    const label = listing.title ?? listing.id

    const existing = await db
      .select({ id: listingPhotos.id })
      .from(listingPhotos)
      .where(eq(listingPhotos.listingId, listing.id))
    if (existing.length > 0) {
      console.log(`  • SKIP "${label}" — already has ${existing.length} photo(s)`)
      skipped++
      continue
    }

    const urls = imagesForListing(i)
    console.log(`  + SEED "${label}" (${urls.length} photos)`)
    if (DRY_RUN) {
      seeded++
      continue
    }

    for (let order = 0; order < urls.length; order++) {
      const res = await fetch(urls[order])
      if (!res.ok) throw new Error(`Image fetch failed (${res.status}) for ${urls[order]}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const filename = `salon-${order + 1}.jpg`
      const blob = await put(`${DEMO_PREFIX}/${listing.id}/${filename}`, buf, {
        access: "public",
        addRandomSuffix: true,
        contentType: "image/jpeg",
        token,
      })
      await db.insert(listingPhotos).values({
        listingId: listing.id,
        url: blob.url,
        filename,
        displayOrder: order,
      })
    }
    seeded++
  }

  console.log(`\nDone. Seeded ${seeded}, skipped ${skipped}.`)
}

async function clean(db: ReturnType<typeof drizzle>, token: string) {
  const rows = await db
    .select({ id: listingPhotos.id, url: listingPhotos.url })
    .from(listingPhotos)
    .where(like(listingPhotos.url, `%${DEMO_URL_MARKER}%`))

  console.log(`Found ${rows.length} demo photo(s) to remove`)
  if (DRY_RUN) {
    console.log("(--dry-run: no deletes)")
    return
  }

  for (const row of rows) {
    await del(row.url, { token })
    await db.delete(listingPhotos).where(eq(listingPhotos.id, row.id))
  }
  console.log(`Removed ${rows.length} demo photo(s) (blobs + DB rows).`)
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e)
  process.exit(1)
})
