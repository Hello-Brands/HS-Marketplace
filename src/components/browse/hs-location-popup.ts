import type { UnlistedHsLocation } from "@/lib/hs-locations-filter"
import { escapeHtml } from "@/lib/escape-html"

/**
 * Brand-styled hover card for an open Hello Sugar location.
 * NON-PII ONLY: name, city/state (or nothing), suite/flagship type chips, and
 * "Open since {year}".
 * The `owned` variant swaps the "not for sale" badge for a "Your location"
 * badge and adds View / Watch-this-area action buttons (wired up by MapView via
 * the `data-hs-popup-action` attributes) — still non-PII, it only reflects what
 * the signed-in owner already knows about their own location.
 */
export function hsLocationPopupHtml(loc: UnlistedHsLocation, owned = false): string {
  const place = [loc.city, loc.state]
    .filter((s): s is string => !!s)
    .map(escapeHtml)
    .join(", ")

  const pill = (bg: string, color: string, label: string) =>
    `<span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:${bg};color:${color};padding:2px 8px;border-radius:999px;">${label}</span>`

  const badge = owned
    ? pill("#DBEBE1", "#3F7D5B", "Your location")
    : pill("#EEE2DA", "#8F7067", "Hello Sugar · not for sale")

  // Suite/flagship type chips (color-coded: caramel = suite, rose = flagship).
  const suiteChip = pill("#E2CCB9", "#6E4A2F", "Suite")
  const flagshipChip = pill("#F7DCDA", "#AD4C52", "Flagship")
  const typeChips =
    loc.locationType === "both"
      ? suiteChip + flagshipChip
      : loc.locationType === "suite"
        ? suiteChip
        : loc.locationType === "flagship"
          ? flagshipChip
          : ""

  const pillRow = `<div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:6px;">${badge}${typeChips}</div>`

  const placeLine = place
    ? `<div style="font-size:12px;color:#8F7067;margin-top:6px;">${place}</div>`
    : ""

  const sinceLine =
    loc.openedSince != null
      ? `<div style="font-size:12px;color:#8F7067;margin-top:6px;">Open since ${loc.openedSince}</div>`
      : ""

  const cta = owned
    ? `<div style="margin-top:10px;display:flex;gap:8px;">
      <button type="button" data-hs-popup-action="view" style="flex:1;font-family:inherit;font-size:12px;font-weight:600;color:#3F7D5B;background:#fff;border:1px solid #DBEBE1;border-radius:8px;padding:6px 8px;cursor:pointer;">View location</button>
      <button type="button" data-hs-popup-action="watch" style="flex:1;font-family:inherit;font-size:12px;font-weight:600;color:#fff;background:#3F7D5B;border:none;border-radius:8px;padding:6px 8px;cursor:pointer;">Watch this area</button>
    </div>`
    : ""

  return `
    <div style="font-family:'Montserrat',system-ui,sans-serif;padding:4px 4px 2px;max-width:220px;">
      ${pillRow}
      <div style="font-size:15px;font-weight:700;color:#1F1917;line-height:1.25;">${escapeHtml(loc.name)}</div>
      ${placeLine}
      ${sinceLine}
      ${cta}
    </div>`
}
