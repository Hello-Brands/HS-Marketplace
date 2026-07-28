/**
 * Backfill geocoded coordinates for owner_locations rows that don't have them.
 *
 * Run:  npx tsx scripts/geocode-owner-locations.ts            (live)
 *       npx tsx scripts/geocode-owner-locations.ts --dry-run  (no DB writes)
 *
 * Requires MAPTILER_API_KEY in .env.local — a SEPARATE, UNRESTRICTED server key
 * (server requests send no Origin header, so a domain-locked key is rejected).
 *
 * Safe to re-run: skips rows that already have coordinates, throttles between
 * calls, only accepts results above a relevance threshold, and never aborts the
 * whole run because of a single failure.
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/neon-http"
import { neon } from "@neondatabase/serverless"
import { isNull, eq } from "drizzle-orm"
import { ownerLocations } from "../src/db/schema/ownerLocations"
import { buildGeocodeQueries, parseUsAddressTail } from "../src/lib/geocode/address"
import {
  isAcceptableMatch,
  toCandidate,
  type GeocodeCandidate,
  type MapTilerFeature,
} from "../src/lib/geocode/match"

const THROTTLE_MS = 300
const DRY_RUN = process.argv.includes("--dry-run")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchTop(query: string, apiKey: string): Promise<GeocodeCandidate | null> {
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(
    query
  )}.json?key=${apiKey}&country=us&limit=1`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`MapTiler ${res.status} ${res.statusText}`)
  const data = (await res.json()) as { features?: MapTilerFeature[] }
  return toCandidate(data.features?.[0])
}

/**
 * Try the query ladder and return the first acceptable match, plus the best
 * rejected candidate so the report can explain WHY a row was left alone.
 * The accept rule is shared with src/lib/geocode/geocode.ts.
 */
async function geocodeWithLadder(
  address: string,
  apiKey: string
): Promise<{
  accepted: (GeocodeCandidate & { query: string }) | null
  best: (GeocodeCandidate & { query: string }) | null
}> {
  const expectedZip = parseUsAddressTail(address)?.zipCode ?? null
  let best: (GeocodeCandidate & { query: string }) | null = null

  for (const query of buildGeocodeQueries(address)) {
    const candidate = await fetchTop(query, apiKey)
    if (candidate) {
      if (!best || candidate.relevance > best.relevance) best = { ...candidate, query }
      if (isAcceptableMatch(candidate, expectedZip)) return { accepted: { ...candidate, query }, best }
    }
    await sleep(THROTTLE_MS)
  }
  return { accepted: null, best }
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

  const rows = await db
    .select({
      id: ownerLocations.id,
      name: ownerLocations.blvdLocationName,
      address: ownerLocations.locationAddress,
    })
    .from(ownerLocations)
    .where(isNull(ownerLocations.latitude))

  console.log(
    `Found ${rows.length} owner location(s) without coordinates.${DRY_RUN ? " (dry run)" : ""}\n`
  )

  let updated = 0
  const lowConfidence: { name: string; query: string; relevance: number }[] = []
  const skipped: { name: string; reason: string }[] = []
  const failed: { name: string; error: string }[] = []

  for (const row of rows) {
    if (!row.address) {
      skipped.push({ name: row.name, reason: "no address" })
      continue
    }
    if (buildGeocodeQueries(row.address).length === 0) {
      skipped.push({ name: row.name, reason: "empty after cleaning" })
      continue
    }

    try {
      const { accepted, best } = await geocodeWithLadder(row.address, apiKey)
      if (accepted) {
        console.log(
          `✓ ${row.name} -> ${accepted.lat.toFixed(5)}, ${accepted.lng.toFixed(5)} ` +
            `(relevance ${accepted.relevance.toFixed(2)}) [${accepted.placeName}] via "${accepted.query}"`
        )
        if (!DRY_RUN) {
          await db
            .update(ownerLocations)
            .set({ latitude: accepted.lat, longitude: accepted.lng, geocodedAt: new Date() })
            .where(eq(ownerLocations.id, row.id))
        }
        updated++
      } else if (best) {
        lowConfidence.push({ name: row.name, query: best.query, relevance: best.relevance })
      } else {
        failed.push({ name: row.name, error: "no geocoding result" })
      }
    } catch (err) {
      failed.push({ name: row.name, error: err instanceof Error ? err.message : String(err) })
    }
  }

  console.log(`\n${"=".repeat(50)}`)
  console.log(`${DRY_RUN ? "[dry run] would update" : "Updated"}: ${updated}`)
  if (lowConfidence.length) {
    console.log(`\nLow confidence (NOT written):`)
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
