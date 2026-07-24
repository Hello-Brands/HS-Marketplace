import { describe, it, expect, beforeEach } from "vitest"
import { acquireScrollLock, releaseScrollLock, _resetScrollLockForTests } from "@/lib/scroll-lock"

function fakeBody() {
  return { style: { overflow: "" } }
}

describe("scroll-lock", () => {
  beforeEach(() => _resetScrollLockForTests())

  it("locks on first acquire and unlocks on last release", () => {
    const body = fakeBody()
    acquireScrollLock(body)
    expect(body.style.overflow).toBe("hidden")
    releaseScrollLock(body)
    expect(body.style.overflow).toBe("")
  })

  it("stays locked while any holder remains (nested overlays)", () => {
    const body = fakeBody()
    acquireScrollLock(body) // e.g. filter sheet
    acquireScrollLock(body) // e.g. nested sort sheet
    releaseScrollLock(body)
    expect(body.style.overflow).toBe("hidden")
    releaseScrollLock(body)
    expect(body.style.overflow).toBe("")
  })

  it("ignores extra releases", () => {
    const body = fakeBody()
    releaseScrollLock(body)
    expect(body.style.overflow).toBe("")
    acquireScrollLock(body)
    expect(body.style.overflow).toBe("hidden")
  })
})
