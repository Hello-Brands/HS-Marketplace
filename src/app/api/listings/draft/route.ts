import { NextResponse } from 'next/server'
import { saveDraft } from '@/lib/listings/actions'
import { requireSellerAccess } from '@/lib/auth-guards'

export async function POST(request: Request) {
  // Defense-in-depth: re-check auth at the handler level so a middleware bypass
  // returns 401 rather than falling through to saveDraft (which would surface as
  // a generic 400). saveDraft still enforces per-listing ownership.
  try {
    await requireSellerAccess()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data, listingId } = await request.json()
    const result = await saveDraft(data, listingId)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    )
  }
}
