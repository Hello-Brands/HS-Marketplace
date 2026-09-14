'use server'

import { requireAdmin } from '@/lib/auth-guards'
import { uiActorFromSession } from '@/lib/admin/core/actor'
import * as core from '@/lib/admin/core/listings'
import type { ListingStatus, ListingFormData } from '@/lib/listings/types'

/**
 * Admin listing-moderation server actions. Each export is a public POST
 * endpoint, so every one begins with `requireAdmin()`. The logic lives in
 * src/lib/admin/core/listings.ts so the MCP server can share it.
 */

export async function getPendingListings() {
  await requireAdmin()
  return core.getPendingListings()
}

export async function getAllListings(statusFilter?: ListingStatus) {
  await requireAdmin()
  return core.getAllListings(statusFilter)
}

export async function approveListing(listingId: string) {
  const admin = await requireAdmin()
  return core.approveListing(uiActorFromSession(admin), listingId)
}

export async function rejectListing(listingId: string, reason: string, notes?: string) {
  const admin = await requireAdmin()
  return core.rejectListing(uiActorFromSession(admin), listingId, reason, notes)
}

export async function adminUpdateListing(listingId: string, input: Partial<ListingFormData>) {
  const admin = await requireAdmin()
  return core.adminUpdateListing(uiActorFromSession(admin), listingId, input)
}

export async function adminMarkSold(listingId: string) {
  const admin = await requireAdmin()
  return core.adminMarkSold(uiActorFromSession(admin), listingId)
}
