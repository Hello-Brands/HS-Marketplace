import type { OwnerLinkSource } from "@/db/schema"

/** A link row as the reconciler sees it — identifier plus current state. */
export type ExistingOwnerLink = {
  ownerIdentifier: string
  source: OwnerLinkSource
}

/**
 * What login should do to a user's links. `skipped` is for observability only
 * (so "why isn't this owner linked?" is answerable from logs) — it is never
 * persisted and callers must not branch on it.
 */
export type OwnerLinkPlan = {
  toAdd: string[]
  toRemove: string[]
  skipped: { ownerIdentifier: string; reason: "revoked" | "manual" }[]
}

// Frozen (including its arrays — Object.freeze is shallow) because
// linkOwnerAtLogin returns this exact shared singleton on its blank-email and
// error paths. If a caller ever mutated .toAdd/.toRemove/.skipped on it,
// state would leak across every subsequent call.
export const EMPTY_OWNER_LINK_PLAN: OwnerLinkPlan = Object.freeze({
  toAdd: Object.freeze([]) as unknown as string[],
  toRemove: Object.freeze([]) as unknown as string[],
  skipped: Object.freeze([]) as unknown as OwnerLinkPlan["skipped"],
}) as OwnerLinkPlan

/** Effective links are the ones that grant access; revoked ones never do. */
export function isEffectiveLinkSource(source: OwnerLinkSource): boolean {
  return source === "auto" || source === "manual"
}

/**
 * Reconcile a user's auto links against the owner profiles their directory
 * email currently matches. Pure — no I/O.
 *
 *   match + no row    -> add as auto
 *   match + auto      -> leave (idempotent)
 *   match + manual    -> leave; never downgrade an admin's link to auto
 *   match + revoked   -> skip; an admin suppression outlives the directory
 *   no match + auto   -> REMOVE. This is what makes the system self-healing:
 *                        correcting owner_contact_email in Monday drops the
 *                        bad link on the user's next login, with no admin
 *                        action. Without it, a wrong email grants access
 *                        permanently.
 *   no match + manual -> leave (durable by design)
 *   no match + revoked-> leave (durable by design)
 *
 * `matchedOwnerIdentifiers` MUST already exclude the "Unknown Owner" bucket —
 * those rows are never assignable to a user even when they carry an email.
 * Duplicates are fine; they are collapsed here.
 *
 * Outputs are sorted so callers and tests see a stable order regardless of
 * how the directory query happened to return rows.
 */
export function planOwnerLinks(args: {
  matchedOwnerIdentifiers: string[]
  existingLinks: ExistingOwnerLink[]
}): OwnerLinkPlan {
  const matched = new Set(args.matchedOwnerIdentifiers)
  const sourceByOwner = new Map(args.existingLinks.map((l) => [l.ownerIdentifier, l.source]))

  const toAdd: string[] = []
  const skipped: OwnerLinkPlan["skipped"] = []

  for (const ownerIdentifier of matched) {
    const source = sourceByOwner.get(ownerIdentifier)
    if (source === undefined) {
      toAdd.push(ownerIdentifier)
    } else if (source === "revoked") {
      skipped.push({ ownerIdentifier, reason: "revoked" })
    } else if (source === "manual") {
      skipped.push({ ownerIdentifier, reason: "manual" })
    }
    // source === "auto" -> already correct; nothing to do.
  }

  const toRemove = args.existingLinks
    .filter((l) => l.source === "auto" && !matched.has(l.ownerIdentifier))
    .map((l) => l.ownerIdentifier)

  const byOwner = (a: { ownerIdentifier: string }, b: { ownerIdentifier: string }) =>
    a.ownerIdentifier.localeCompare(b.ownerIdentifier)

  return {
    toAdd: toAdd.sort((a, b) => a.localeCompare(b)),
    toRemove: toRemove.sort((a, b) => a.localeCompare(b)),
    skipped: skipped.sort(byOwner),
  }
}
