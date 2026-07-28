import type { OwnerLinkSource } from "@/db/schema"
import { UNKNOWN_OWNER } from "./constants"

/**
 * A user's legacy link state, as the old scalar columns recorded it, plus the
 * owner profiles their normalized email matches today (Unknown Owner already
 * excluded by the caller).
 */
export type LegacyLinkState = {
  userId: string
  ownerIdentifier: string | null
  ownerLinkSource: "auto" | "manual" | null
  emailMatchedOwners: string[]
}

export type BackfillLinkRow = {
  userId: string
  ownerIdentifier: string
  source: OwnerLinkSource
}

/**
 * Map one user's legacy scalar state onto user_owner_links rows.
 *
 *   identifier + auto    -> one auto row
 *   identifier + manual  -> one manual row
 *   identifier + null    -> one auto row (shouldn't exist; better than
 *                           silently dropping a live link)
 *   null + manual        -> a REVOKED row per matching owner. This is the
 *                           "deliberately unlinked, don't re-link me" state
 *                           manuallyUnlinkUser wrote. Skipping it would let
 *                           the next login auto-link them and reverse an
 *                           admin decision.
 *   null + null          -> nothing (never linked)
 *
 * Pure, so this table is testable without a database.
 */
export function planBackfillRows(state: LegacyLinkState): BackfillLinkRow[] {
  if (state.ownerIdentifier && state.ownerIdentifier !== UNKNOWN_OWNER) {
    return [
      {
        userId: state.userId,
        ownerIdentifier: state.ownerIdentifier,
        source: state.ownerLinkSource === "manual" ? "manual" : "auto",
      },
    ]
  }

  if (state.ownerLinkSource === "manual") {
    return [...new Set(state.emailMatchedOwners)]
      .sort((a, b) => a.localeCompare(b))
      .map((ownerIdentifier) => ({
        userId: state.userId,
        ownerIdentifier,
        source: "revoked" as const,
      }))
  }

  return []
}
