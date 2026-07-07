import { NextResponse } from 'next/server'
import { changeListingStatus } from '@/lib/listings/actions'
import type { ListingStatus } from '@/lib/listings/types'
import { requireSellerAccess } from '@/lib/auth-guards'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Defense-in-depth: reject unauthenticated callers with 401 before touching
  // the state machine. changeListingStatus still enforces per-listing ownership.
  try {
    await requireSellerAccess()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const { targetStatus, reason } = await request.json() as { action: string; targetStatus: ListingStatus; reason?: string }

    await changeListingStatus(id, targetStatus, reason)

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    )
  }
}
