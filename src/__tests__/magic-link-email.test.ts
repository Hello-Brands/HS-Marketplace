import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// vi.mock is hoisted, so the spies have to be created in a hoisted block to be
// referenceable from both the factory and the assertions.
const { sendSpy, ctorCalls } = vi.hoisted(() => ({
  sendSpy: vi.fn(),
  ctorCalls: [] as (string | undefined)[],
}))

vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = { send: sendSpy }
    constructor(apiKey?: string) {
      ctorCalls.push(apiKey)
    }
  },
}))

import {
  buildMagicLinkEmail,
  sendMagicLinkEmail,
  MAGIC_LINK_MAX_AGE_SECONDS,
} from "@/lib/auth/magic-link-email"
import type { EmailProviderSendVerificationRequestParams } from "next-auth/providers/email"

function makeParams(
  overrides: Partial<EmailProviderSendVerificationRequestParams> = {},
): EmailProviderSendVerificationRequestParams {
  return {
    identifier: "partner@external.com",
    url: "https://marketplace.hellosugar.salon/api/auth/callback/resend?callbackUrl=%2Fbrowse&token=abc&email=partner%40external.com",
    expires: new Date(Date.now() + MAGIC_LINK_MAX_AGE_SECONDS * 1000),
    token: "abc",
    // Only `from` is read; the rest of the provider config is irrelevant here.
    provider: { from: "Hello Sugar <marketplace@noreply.hellosugar.salon>" },
    theme: {},
    request: new Request("https://marketplace.hellosugar.salon/api/auth/signin/resend"),
    ...overrides,
  } as EmailProviderSendVerificationRequestParams
}

beforeEach(() => {
  sendSpy.mockReset()
  sendSpy.mockResolvedValue({ data: { id: "mock-id" }, error: null })
  // src/lib/email.ts constructs a client at module scope (once, at import), so
  // clear the log here to make "did this call construct one?" meaningful.
  ctorCalls.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("buildMagicLinkEmail", () => {
  it("returns the house subject, heading, CTA and expiry", () => {
    const { subject, html, text } = buildMagicLinkEmail({
      url: "https://example.com/x",
      expiresMinutes: 15,
    })
    expect(subject).toBe("Your Hello Sugar Marketplace sign-in link")
    expect(html).toContain("Sign in to Hello Sugar Marketplace")
    expect(html).toContain("#ED1845")
    expect(html).toContain("15 minutes")
    expect(text).toContain("15 minutes")
    expect(text).toContain("Sign in to Hello Sugar Marketplace")
  })

  it("puts the url in the href and as visible fallback text, and raw in the text part", () => {
    const url = "https://example.com/cb?token=abc"
    const { html, text } = buildMagicLinkEmail({ url, expiresMinutes: 15 })
    expect(html).toContain(`href="${url}"`)
    // Visible fallback below the button (href + fallback = two occurrences).
    expect(html.split(url).length - 1).toBeGreaterThanOrEqual(2)
    expect(text).toContain(url)
  })

  it("html-escapes & in the url but leaves the plain-text copy raw", () => {
    const url = "https://example.com/cb?token=abc&email=a%40b.com"
    const { html, text } = buildMagicLinkEmail({ url, expiresMinutes: 15 })
    expect(html).toContain("token=abc&amp;email=a%40b.com")
    expect(html).not.toContain("token=abc&email=")
    expect(text).toContain(url)
  })

  it("mentions single-use and the ignore-if-unrequested line", () => {
    const { html, text } = buildMagicLinkEmail({ url: "https://e.com/x", expiresMinutes: 1 })
    expect(html).toContain("1 minute and works only once")
    expect(html).toContain("you can safely ignore it")
    expect(text).toContain("you can safely ignore it")
  })
})

describe("sendMagicLinkEmail", () => {
  it("logs the link and sends nothing outside production with no override", async () => {
    vi.stubEnv("VERCEL_ENV", "")
    vi.stubEnv("EMAIL_OVERRIDE", "")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const params = makeParams()
    await sendMagicLinkEmail(params)

    expect(sendSpy).not.toHaveBeenCalled()
    expect(ctorCalls).toHaveLength(0)
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n")
    expect(logged).toContain("[magic-link]")
    expect(logged).toContain("non-production")
    expect(logged).toContain(params.identifier)
    expect(logged).toContain(params.url)
    warn.mockRestore()
  })

  it("redirects to EMAIL_OVERRIDE with a [to: ...] subject prefix outside production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview")
    vi.stubEnv("EMAIL_OVERRIDE", "test-inbox@hellosugar.salon")

    await sendMagicLinkEmail(makeParams())

    expect(sendSpy).toHaveBeenCalledTimes(1)
    const payload = sendSpy.mock.calls[0][0]
    expect(payload.to).toBe("test-inbox@hellosugar.salon")
    expect(payload.subject).toBe(
      "[to: partner@external.com] Your Hello Sugar Marketplace sign-in link",
    )
    expect(payload.from).toBe("Hello Sugar <marketplace@noreply.hellosugar.salon>")
    expect(payload.html).toContain("Sign in to Hello Sugar Marketplace")
    expect(payload.text).toContain("https://marketplace.hellosugar.salon/api/auth/callback/resend")
    // Client is built inside the call, not at module scope.
    expect(ctorCalls).toEqual(["re_test"])
  })

  it("delivers to the real identifier in production with an untouched subject", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    vi.stubEnv("EMAIL_OVERRIDE", "test-inbox@hellosugar.salon")

    await sendMagicLinkEmail(makeParams())

    expect(sendSpy).toHaveBeenCalledTimes(1)
    const payload = sendSpy.mock.calls[0][0]
    expect(payload.to).toBe("partner@external.com")
    expect(payload.subject).toBe("Your Hello Sugar Marketplace sign-in link")
  })

  it("throws when Resend reports an error instead of throwing one", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    sendSpy.mockResolvedValue({ data: null, error: { message: "boom" } })

    await expect(sendMagicLinkEmail(makeParams())).rejects.toThrow("boom")
  })

  it("throws a clear error when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    vi.stubEnv("RESEND_API_KEY", "")

    await expect(sendMagicLinkEmail(makeParams())).rejects.toThrow("RESEND_API_KEY is not set")
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it("floors the rendered expiry at 1 minute for an already-expired token", async () => {
    vi.stubEnv("VERCEL_ENV", "production")

    await sendMagicLinkEmail(makeParams({ expires: new Date(Date.now() - 60_000) }))

    const payload = sendSpy.mock.calls[0][0]
    expect(payload.html).toContain("1 minute")
  })
})
