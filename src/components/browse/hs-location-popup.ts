import type { UnlistedHsLocation } from "@/lib/hs-locations-filter"
import { escapeHtml } from "@/lib/escape-html"

/**
 * Brand-styled hover card for an open Hello Sugar location.
 * NON-PII ONLY: name, city/state (or nothing), and "Open since {year}".
 * The `owned` variant swaps the "not for sale" badge for a "Your location"
 * badge and adds a details CTA — still non-PII, it only reflects what the
 * signed-in owner already knows about their own location.
 */
export function hsLocationPopupHtml(loc: UnlistedHsLocation, owned = false): string {
  const place = [loc.city, loc.state]
    .filter((s): s is string => !!s)
    .map(escapeHtml)
    .join(", ")

  const badge = owned
    ? `<div style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:#DBEBE1;color:#3F7D5B;padding:2px 8px;border-radius:999px;margin-bottom:6px;">Your location</div>`
    : `<div style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:#EEE2DA;color:#8F7067;padding:2px 8px;border-radius:999px;margin-bottom:6px;">Hello Sugar · not for sale</div>`

  const placeLine = place
    ? `<div style="font-size:12px;color:#8F7067;margin-top:6px;">${place}</div>`
    : ""

  const sinceLine =
    loc.openedSince != null
      ? `<div style="font-size:12px;color:#8F7067;margin-top:6px;">Open since ${loc.openedSince}</div>`
      : ""

  const cta = owned
    ? `<div style="margin-top:8px;font-size:13px;color:#3F7D5B;font-weight:500;">Click to view details →</div>`
    : ""

  return `
    <div style="font-family:'Montserrat',system-ui,sans-serif;padding:4px 4px 2px;max-width:220px;">
      ${badge}
      <div style="font-size:15px;font-weight:700;color:#1F1917;line-height:1.25;">${escapeHtml(loc.name)}</div>
      ${placeLine}
      ${sinceLine}
      ${cta}
    </div>`
}
