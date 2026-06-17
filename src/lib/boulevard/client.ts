import "server-only"
import { monthlySalesResponse, locationsResponse, monthlyMembershipResponse, type MonthlySales } from "./types"

const TIMEOUT_MS = 8000

// --- Live-iteration point: confirm against the real Admin API. -------------
const SALES_QUERY = `
  query LocationMonthlySales($id: ID!, $months: Int!) {
    location(id: $id) { monthlySales(lastMonths: $months) { month salesCents } }
  }`
const LOCATIONS_QUERY = `query Locations { locations { id name } }`
// ---------------------------------------------------------------------------

function creds(): { url: string; key: string } | null {
  const url = process.env.BOULEVARD_API_URL
  const key = process.env.BOULEVARD_API_KEY
  return url && key ? { url, key } : null
}

async function gql(query: string, variables: Record<string, unknown>): Promise<unknown | null> {
  const c = creds()
  if (!c) return null
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(c.url, {
      method: "POST",
      headers: {
        // Admin API: HTTP Basic with the API key. Confirm exact format during iteration.
        Authorization: `Basic ${Buffer.from(`${c.key}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal: ctrl.signal,
    })
    if (!res.ok) {
      console.warn(`[boulevard] API ${res.status}`)
      return null
    }
    return await res.json()
  } catch (err) {
    console.warn("[boulevard] request failed:", err)
    return null
  } finally {
    clearTimeout(t)
  }
}

export async function fetchMonthlySales(boulevardLocationId: string, months: number): Promise<MonthlySales[] | null> {
  const raw = await gql(SALES_QUERY, { id: boulevardLocationId, months })
  if (raw === null) return null
  const parsed = monthlySalesResponse.safeParse(raw)
  if (!parsed.success || !parsed.data.data.location) {
    console.warn("[boulevard] sales validation failed")
    return null
  }
  return parsed.data.data.location.monthlySales.map((m) => ({ month: m.month, sales: m.salesCents }))
}

export async function listBoulevardLocations(): Promise<{ id: string; name: string }[] | null> {
  const raw = await gql(LOCATIONS_QUERY, {})
  if (raw === null) return null
  const parsed = locationsResponse.safeParse(raw)
  return parsed.success ? parsed.data.data.locations : null
}

// --- Live-iteration point: confirm against the real Admin API. ---
const MEMBERSHIP_QUERY = `
  query LocationMonthlyMembership($id: ID!, $months: Int!) {
    location(id: $id) {
      monthlyMembership(lastMonths: $months) { month newMembers uniqueOrderingClients }
    }
  }`
// -----------------------------------------------------------------

export async function fetchMonthlyMembership(
  boulevardLocationId: string,
  months: number
): Promise<{ month: string; rate: number }[] | null> {
  const raw = await gql(MEMBERSHIP_QUERY, { id: boulevardLocationId, months })
  if (raw === null) return null
  const parsed = monthlyMembershipResponse.safeParse(raw)
  if (!parsed.success || !parsed.data.data.location) {
    console.warn("[boulevard] membership validation failed")
    return null
  }
  return parsed.data.data.location.monthlyMembership.map((m) => ({
    month: m.month,
    rate: m.uniqueOrderingClients > 0 ? m.newMembers / m.uniqueOrderingClients : 0,
  }))
}
