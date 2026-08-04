/**
 * Recency of a competitor closure.
 *
 * `closedAt` is when the external competitor-monitor scraper FIRST DETECTED the
 * closure — NOT when the business actually closed. User-facing copy must say
 * "Detected", never "Closed on".
 *
 * Two accepted limitations, both properties of the scraper's data rather than
 * of this code (see the design doc's data check, 2026-08-04):
 *   - 22 of 79 production rows have a null `closedAt` and can never be flagged
 *     new. Correct by omission: we don't claim recency we don't know.
 *   - The scraper reconciles weekly/monthly, so newly-detected closures arrive
 *     in batches and badges appear in clumps rather than trickling in.
 *
 * Pure, and free of any `server-only` import, so the client list/map components
 * and vitest can both import it.
 */

/** A closure counts as "new" for this many days after it was first detected. */
export const NEW_CLOSURE_WINDOW_DAYS = 14

const MS_PER_DAY = 86_400_000

/**
 * True when `closedAt` parses and was detected within the last
 * NEW_CLOSURE_WINDOW_DAYS. `now` is injected so the boundary is testable
 * without faking the clock.
 *
 * A timestamp slightly in the future — clock skew between the Railway scraper
 * and this app — counts as new: badging a few seconds early is harmless, while
 * suppressing a genuinely new closure is the failure that matters.
 */
export function isNewClosure(closedAt: string | null, now: Date): boolean {
  if (!closedAt) return false
  const detected = Date.parse(closedAt)
  if (Number.isNaN(detected)) return false
  return now.getTime() - detected <= NEW_CLOSURE_WINDOW_DAYS * MS_PER_DAY
}

/**
 * Fixed display timezone for detection dates.
 *
 * Deliberately NOT the viewer's local zone: a fixed zone makes this formatter
 * produce identical output on the server and the client, which is what lets the
 * server-rendered favorites page, the client-rendered browse list, and the map
 * popup's imperative HTML string all share one implementation without risking a
 * hydration mismatch.
 */
export const CLOSURE_DETECTED_TIMEZONE = "America/Denver"

/**
 * The card line for when the scraper detected a closure, or null when we have
 * no usable date — in which case the caller renders NOTHING. 22 of 79
 * production rows have a null `closedAt`; correct by omission.
 *
 * Says "detected", never "closed on": see this module's header.
 */
export function formatClosureDetected(
  closedAt: string | Date | null
): string | null {
  if (!closedAt) return null
  const detected = closedAt instanceof Date ? closedAt : new Date(closedAt)
  if (Number.isNaN(detected.getTime())) return null
  const date = detected.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: CLOSURE_DETECTED_TIMEZONE,
  })
  return `Closure detected ${date}`
}
