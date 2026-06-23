export type OwnerLinkDecision =
  | { action: "link"; ownerIdentifier: string }
  | { action: "skip"; reason: "no_match" | "multiple_owners" | "manual_locked" }

/**
 * Decide whether a logged-in user should be auto-linked to an owner.
 *
 *  - source=manual is an admin override and is NEVER overwritten.
 *  - exactly one distinct owner_identifier  -> link (source=auto)
 *  - zero matches                           -> skip (not a known owner; can still browse/buy)
 *  - multiple distinct owner_identifiers    -> skip + flag for admin (ambiguous)
 *
 * `matchedOwnerIdentifiers` MUST already exclude the "Unknown Owner" bucket —
 * those rows are never assignable to a user even when they carry an email.
 */
export function decideOwnerLink(args: {
  matchedOwnerIdentifiers: string[]
  currentLinkSource: "auto" | "manual" | null
}): OwnerLinkDecision {
  if (args.currentLinkSource === "manual") {
    return { action: "skip", reason: "manual_locked" }
  }
  const distinct = [...new Set(args.matchedOwnerIdentifiers)]
  if (distinct.length === 1) return { action: "link", ownerIdentifier: distinct[0] }
  if (distinct.length === 0) return { action: "skip", reason: "no_match" }
  return { action: "skip", reason: "multiple_owners" }
}
