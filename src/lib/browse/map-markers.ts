/**
 * Pure selection rules for the /browse map's DOM markers — which brand asset a
 * marker renders, and how the four marker populations stack.
 *
 * Deliberately free of any `@maptiler/sdk` or `server-only` import: MapView.tsx
 * pulls in the MapTiler SDK *and its CSS* at module scope, so it can never be
 * imported by a vitest (node-environment) test. Keeping these rules here is
 * what makes them testable, and it lets MapLegend read the same MARKER_ICON so
 * the on-map key cannot drift from the map again.
 */

/** The four marker populations the browse map draws. */
export type MarkerLayer = "competitor" | "forSale" | "owned" | "unlistedHs"

/** Which brand asset a Hello Sugar marker renders. */
export type MarkerVariant = "forSale" | "owned" | "unlisted"

/** Which of the two Hello Sugar marker effects a marker came from. */
export type HsMarkerKind = "listing" | "hsLocation"

export const MARKER_ICON: Record<MarkerVariant, string> = {
  // The wide "Hello Sugar" wordmark on a red field — the loudest mark in the
  // set, so it flags the thing a buyer opened /browse for: an actual for-sale
  // salon. (Before 2026-08-04 this asset marked owned locations, which is why
  // its filename still says "owner".)
  forSale: "/markers/hs-marker-owner.png",
  // Red swirl glyph — salons the viewer owns.
  owned: "/markers/hs-marker-color.png",
  // White swirl glyph — an open Hello Sugar salon that is not for sale.
  unlisted: "/markers/hs-marker-white.png",
}

/**
 * Brand mark for a Hello Sugar marker. Ownership outranks for-sale status: an
 * owned listing and an owned unlisted salon both render `owned`, and their
 * popups carry the distinction. (That was already true when both rendered the
 * wordmark badge, so it is not a new limitation.)
 *
 * `isMine` is expected to be pre-gated on the "Your locations" legend toggle by
 * the caller, so flipping that toggle off returns markers to their layer's
 * normal mark.
 */
export function markerVariant(kind: HsMarkerKind, isMine: boolean): MarkerVariant {
  if (isMine) return "owned"
  return kind === "listing" ? "forSale" : "unlisted"
}

/** Stacking layer for a Hello Sugar marker — same shape as markerVariant. */
export function hsMarkerLayer(kind: HsMarkerKind, isMine: boolean): MarkerLayer {
  if (isMine) return "owned"
  return kind === "listing" ? "forSale" : "unlistedHs"
}

/**
 * Base stacking order. Competitor closures sit on top — they are what owners
 * open /browse for — and unlisted Hello Sugar salons sit at the bottom.
 *
 * Bands are 10 apart for two reasons: a hovered marker can lift within its own
 * band without crossing the layer above, and a future layer can be inserted
 * without renumbering.
 */
export const MARKER_Z_BASE: Record<MarkerLayer, number> = {
  competitor: 40,
  forSale: 30,
  owned: 20,
  unlistedHs: 10,
}

/** How far a hovered marker lifts. Must stay under the 10-wide band gap. */
const HOVER_LIFT = 5

/**
 * z-index for a marker, as a string ready for `element.style.zIndex`.
 *
 * Callers MUST use this for the non-hovered case too. Resetting a marker's
 * zIndex to "" on hover-out (as the code did before base bands existed) would
 * silently drop it back to accidental DOM order.
 */
export function markerZIndex(layer: MarkerLayer, hovered = false): string {
  return String(MARKER_Z_BASE[layer] + (hovered ? HOVER_LIFT : 0))
}
