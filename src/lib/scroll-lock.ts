// Counted body-scroll lock shared by every overlay (nav drawer, filter sheet,
// bottom sheets). Counting means a nested overlay closing can't unlock the
// body out from under the overlay that's still open — the bug risk with the
// previous two ad-hoc mechanisms (body.drawer-open class vs inline style).

export type ScrollLockTarget = { style: { overflow: string } }

let holders = 0

export function acquireScrollLock(target?: ScrollLockTarget): void {
  const t = target ?? document.body
  holders++
  if (holders === 1) t.style.overflow = "hidden"
}

export function releaseScrollLock(target?: ScrollLockTarget): void {
  const t = target ?? document.body
  holders = Math.max(0, holders - 1)
  if (holders === 0) t.style.overflow = ""
}

/** Test-only: reset the holder count between cases. */
export function _resetScrollLockForTests(): void {
  holders = 0
}
