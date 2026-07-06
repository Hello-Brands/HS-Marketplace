import type { ListingFormData } from './types'
import { dollarsToCents } from '@/lib/money'

/**
 * Single home for a listing's money + asset scalar normalization, shared by the
 * seller path (`saveDraft`) and the admin path (`adminUpdateListing`). Keeping it in
 * one place — and free of any `@/db` import so it stays trivially unit-testable — is
 * what closes the drift that let DEBT-001 (dollars written into cents columns on
 * admin edits) hide.
 */

// The scalar row fields the update helper falls back onto for a partial edit.
export type ExistingListingScalars = {
  askingPrice: number
  ttmProfit: number | null
  inventoryIncluded: boolean
  laserIncluded: boolean
}

/**
 * Normalize the money + asset scalar fields for a listing write. Form values are in
 * whole dollars; money columns store integer cents (via {@link dollarsToCents}).
 *
 * When `existing` is supplied (an edit), money/flag fields absent from `data` fall
 * back to the stored row instead of being reset — so a partial admin edit that only
 * touches, say, notes leaves the price untouched. On a fresh create (`existing`
 * omitted) they default to 0 / null / false.
 *
 * Title and `type` are intentionally NOT handled here: their fallback semantics differ
 * per path (seller generates the title from locations with an 'Untitled Listing'
 * fallback; admin falls back to the existing title), so each action sets them itself.
 * `updatedAt` is likewise the caller's concern (create relies on the column default).
 */
export function buildListingUpdate(
  data: Partial<ListingFormData>,
  existing?: ExistingListingScalars | null,
) {
  const inventoryIncluded = data.inventoryIncluded ?? existing?.inventoryIncluded ?? false
  return {
    askingPrice:
      data.askingPrice != null ? dollarsToCents(data.askingPrice) : existing?.askingPrice ?? 0,
    ttmProfit:
      data.ttmProfit != null ? dollarsToCents(data.ttmProfit) : existing?.ttmProfit ?? null,
    reasonForSelling: data.reasonForSelling,
    notes: data.notes,
    inventoryIncluded,
    laserIncluded: data.laserIncluded ?? existing?.laserIncluded ?? false,
    otherAssets: data.otherAssets,
    // Clear the cost when inventory isn't included so we never persist a stale value.
    inventoryCostEstimate:
      inventoryIncluded && data.inventoryCostEstimate
        ? dollarsToCents(data.inventoryCostEstimate)
        : null,
  }
}
