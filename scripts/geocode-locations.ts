/**
 * Backfill geocoded coordinates for salon listing_locations that don't have them.
 *
 * Why this exists: new listings capture coordinates from the seller-location
 * source at save time, but existing rows (and any future row saved without
 * coords) need geocoding. Territory locations use territoryLat/Lng and are skipped.
 *
 * Run:  npx tsx scripts/geocode-locations.ts            (live)
 *       npx tsx scripts/geocode-locations.ts --dry-run  (no DB writes)
 *
 * Requires MAPTILER_API_KEY in .env.local — a SEPARATE, UNRESTRICTED key
 * (server requests send no Origin header, so a domain-locked key is rejected).
 *
 * Safe to re-run: it skips rows that already have coordinates (idempotent),
 * throttles between calls, only accepts results above a relevance threshold,
 * logs low-confidence / failed rows for manual review, and never aborts the
 * whole run because of a single failure.
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/neon-http"
import { neon } from "@neondatabase/serverless"
import { and, eq, isNull } from "drizzle-orm"
import { listingLocations } from "../src/db/schema/listings"
import { cleanAddress, parseUsAddressTail } from "../src/lib/geocode/address"

const RELEVANCE_THRESHOLD = 0.8 // MapTiler relevance (0..1); below this we don't trust the match
const THROTTLE_MS = 300 // delay between geocoding calls
const DRY_RUN = process.argv.includes("--dry-run")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function buildQuery(loc: {
  address: string | null
  city: string | null
  state: string | null
  zipCode: string | null
}): string | null {
  // A directory address is self-contained ("street, City ST ZIP"), so it stands
  // on its own once unit/suite noise is stripped. Fall back to city+state+zip
  // only when there's no address at all.
  if (loc.address) return cleanAddress(loc.address)
  const parts = [loc.city, loc.state, loc.zipCode].filter(Boolean)
  return parts.length >= 2 ? parts.join(", ") : null
}

interface GeocodeResult {
  lat: number
  lng: number
  relevance: number
  placeName: string
}

async function geocode(query: string, apiKey: string): Promise<GeocodeResult | null> {
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(
    query
  )}.json?key=${apiKey}&country=us&limit=1`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`MapTiler ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as {
    features?: { center?: [number, number]; relevance?: number; place_name?: string }[]
  }
  const top = data.features?.[0]
  if (!top?.center) return null
  const [lng, lat] = top.center
  return { lat, lng, relevance: top.relevance ?? 0, placeName: top.place_name ?? "" }
}

async function main() {
  const apiKey = process.env.MAPTILER_API_KEY
  if (!apiKey) {
    console.error(
      "MAPTILER_API_KEY is not set. Add an UNRESTRICTED server key to .env.local (see .env.example)."
    )
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required.")
    process.exit(1)
  }

  const db = drizzle(neon(process.env.DATABASE_URL))

  // Idempotent: only salon rows missing coordinates.
  const rows = await db
    .select({
      id: listingLocations.id,
      name: listingLocations.name,
      address: listingLocations.address,
      city: listingLocations.city,
      state: listingLocations.state,
      zipCode: listingLocations.zipCode,
    })
    .from(listingLocations)
    .where(and(eq(listingLocations.locationType, "salon"), isNull(listingLocations.latitude)))

  console.log(
    `Found ${rows.length} salon location(s) without coordinates.${DRY_RUN ? " (dry run)" : ""}\n`
  )

  let updated = 0
  const lowConfidence: { name: string; query: string; relevance: number }[] = []
  const skipped: { name: string; reason: string }[] = []
  const failed: { name: string; error: string }[] = []

  for (const row of rows) {
    const query = buildQuery(row)
    if (!query) {
      skipped.push({ name: row.name, reason: "insufficient address data" })
      continue
    }

    try {
      const result = await geocode(query, apiKey)
      if (!result) {
        failed.push({ name: row.name, error: "no geocoding result" })
      } else if (result.relevance < RELEVANCE_THRESHOLD) {
        // Honest about uncertainty: log for manual review, do NOT guess.
        lowConfidence.push({ name: row.name, query, relevance: result.relevance })
      } else {
        console.log(
          `✓ ${row.name} -> ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)} ` +
            `(relevance ${result.relevance.toFixed(2)}) [${result.placeName}]`
        )
        if (!DRY_RUN) {
          // Also backfill any missing display components from the address tail.
          const parsed = row.address ? parseUsAddressTail(row.address) : null
          await db
            .update(listingLocations)
            .set({
              latitude: result.lat,
              longitude: result.lng,
              geocodedAt: new Date(),
              geocodeSource: "maptiler",
              ...(parsed && row.city == null ? { city: parsed.city } : {}),
              ...(parsed && row.state == null ? { state: parsed.state } : {}),
              ...(parsed && row.zipCode == null ? { zipCode: parsed.zipCode } : {}),
            })
            .where(eq(listingLocations.id, row.id))
        }
        updated++
      }
    } catch (err) {
      // Never abort the whole run on a single failure.
      failed.push({ name: row.name, error: err instanceof Error ? err.message : String(err) })
    }

    await sleep(THROTTLE_MS)
  }

  console.log(`\n${"=".repeat(50)}`)
  console.log(`${DRY_RUN ? "[dry run] would update" : "Updated"}: ${updated}`)
  if (lowConfidence.length) {
    console.log(`\nLow confidence (review manually, NOT written):`)
    for (const r of lowConfidence) console.log(`  - ${r.name} — relevance ${r.relevance.toFixed(2)} — "${r.query}"`)
  }
  if (skipped.length) {
    console.log(`\nSkipped:`)
    for (const r of skipped) console.log(`  - ${r.name} — ${r.reason}`)
  }
  if (failed.length) {
    console.log(`\nFailed:`)
    for (const r of failed) console.log(`  - ${r.name} — ${r.error}`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error("Backfill failed:", e)
  process.exit(1)
})
