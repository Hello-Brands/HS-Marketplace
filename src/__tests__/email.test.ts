import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock Resend — use a class to satisfy `new Resend()` usage
// Note: vi.mock is hoisted, so all mock logic must be self-contained inside the factory
vi.mock("resend", () => {
  const sendFn = vi.fn().mockResolvedValue({ id: "mock-email-id" })
  return {
    Resend: class MockResend {
      emails = { send: sendFn }
      constructor(_apiKey: string | undefined) {}
    },
  }
})

// Import after mocking
import {
  sendEmail,
  sendStatusChangeEmail,
  sendContactNotification,
  sendAlertMatchEmail,
  sendReminderEmail,
} from "@/lib/email"

// sendEmail only delivers when a key is set AND (production OR an EMAIL_OVERRIDE
// inbox is configured). Set both so the send path runs against the mocked SDK.
beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key")
  vi.stubEnv("EMAIL_OVERRIDE", "test-inbox@hellosugar.salon")
})
afterEach(() => {
  vi.unstubAllEnvs()
})

// The mock factory closes over a single sendFn, so any instance exposes the same
// spy — that's how we assert which address actually got the mail.
import { Resend } from "resend"
type SendSpy = ReturnType<typeof vi.fn>
const sendSpy = new (Resend as unknown as new (k?: string) => {
  emails: { send: SendSpy }
})("k").emails.send

// Regression: EMAIL_OVERRIDE must NEVER reroute production mail. The send path
// read `override || to` with no environment gate while EMAIL_OVERRIDE was set in
// the production environment, so every seller reminder, buyer inquiry reply and
// alert email went to one inbox instead of the intended recipient.
describe("Email - EMAIL_OVERRIDE recipient routing", () => {
  beforeEach(() => {
    sendSpy.mockClear()
  })

  it("delivers to the real recipient in production even when EMAIL_OVERRIDE is set", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    vi.stubEnv("EMAIL_OVERRIDE", "override@hellosugar.salon")

    await sendEmail({ to: "seller@example.com", subject: "Reminder", html: "<p>hi</p>" })

    expect(sendSpy).toHaveBeenCalledTimes(1)
    const payload = sendSpy.mock.calls[0][0]
    expect(payload.to).toBe("seller@example.com")
    // No "[to: …]" prefix in production — the subject is untouched.
    expect(payload.subject).toBe("Reminder")
  })

  it("redirects to the override inbox on a preview deployment", async () => {
    // NODE_ENV is "production" on preview builds, which is why the gate keys on
    // VERCEL_ENV instead.
    vi.stubEnv("VERCEL_ENV", "preview")
    vi.stubEnv("EMAIL_OVERRIDE", "override@hellosugar.salon")

    await sendEmail({ to: "seller@example.com", subject: "Reminder", html: "<p>hi</p>" })

    expect(sendSpy).toHaveBeenCalledTimes(1)
    const payload = sendSpy.mock.calls[0][0]
    expect(payload.to).toBe("override@hellosugar.salon")
    expect(payload.subject).toBe("[to: seller@example.com] Reminder")
  })

  it("skips sending outside production when no override is configured", async () => {
    vi.stubEnv("VERCEL_ENV", "preview")
    vi.stubEnv("EMAIL_OVERRIDE", "")

    const result = await sendEmail({
      to: "seller@example.com",
      subject: "Reminder",
      html: "<p>hi</p>",
    })

    expect(result).toMatchObject({ success: false, skipped: true })
    expect(sendSpy).not.toHaveBeenCalled()
  })
})

describe("Email - Base sendEmail function", () => {
  it("exports sendEmail function", () => {
    expect(sendEmail).toBeDefined()
    expect(typeof sendEmail).toBe("function")
  })

  it("skips sending when RESEND_API_KEY is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "")
    const result = await sendEmail({ to: "x@example.com", subject: "Hi", html: "<p>hi</p>" })
    expect(result).toMatchObject({ success: false, skipped: true })
  })
})

describe("Email - Status Change Notifications", () => {
  it("sendStatusChangeEmail is exported", () => {
    expect(sendStatusChangeEmail).toBeDefined()
    expect(typeof sendStatusChangeEmail).toBe("function")
  })

  it("handles pending status", async () => {
    const result = await sendStatusChangeEmail({
      recipientEmail: "seller@hellosugar.salon",
      recipientName: "Jane",
      listingTitle: "Atlanta Suite",
      listingId: "123",
      newStatus: "pending",
    })
    expect(result.success).toBe(true)
  })

  it("handles active status", async () => {
    const result = await sendStatusChangeEmail({
      recipientEmail: "seller@hellosugar.salon",
      recipientName: "Jane",
      listingTitle: "Atlanta Suite",
      listingId: "123",
      newStatus: "active",
    })
    expect(result.success).toBe(true)
  })

  it("handles rejected status with reason", async () => {
    const result = await sendStatusChangeEmail({
      recipientEmail: "seller@hellosugar.salon",
      recipientName: "Jane",
      listingTitle: "Atlanta Suite",
      listingId: "123",
      newStatus: "rejected",
      rejectionReason: "Missing required photos",
    })
    expect(result.success).toBe(true)
  })
})

describe("Email - Contact Notifications", () => {
  it("sendContactNotification is exported", () => {
    expect(sendContactNotification).toBeDefined()
    expect(typeof sendContactNotification).toBe("function")
  })

  it("sends notification with message", async () => {
    const result = await sendContactNotification({
      sellerEmail: "seller@hellosugar.salon",
      sellerName: "Jane",
      buyerName: "John",
      buyerEmail: "john@example.com",
      listingTitle: "Atlanta Suite",
      listingId: "123",
      message: "I'm very interested in this location!",
    })
    expect(result.success).toBe(true)
  })

  it("sends notification without message", async () => {
    const result = await sendContactNotification({
      sellerEmail: "seller@hellosugar.salon",
      sellerName: "Jane",
      buyerName: "John",
      buyerEmail: "john@example.com",
      listingTitle: "Atlanta Suite",
      listingId: "123",
    })
    expect(result.success).toBe(true)
  })
})

describe("Email - Alert Match Notifications", () => {
  it("sendAlertMatchEmail is exported", () => {
    expect(sendAlertMatchEmail).toBeDefined()
    expect(typeof sendAlertMatchEmail).toBe("function")
  })

  it("formats price correctly", async () => {
    const result = await sendAlertMatchEmail({
      buyerEmail: "buyer@hellosugar.salon",
      buyerName: "John",
      listingTitle: "Dallas Flagship",
      listingId: "456",
      listingType: "flagship",
      city: "Dallas",
      state: "TX",
      askingPrice: 50000000, // $500,000 in cents
    })
    expect(result.success).toBe(true)
  })
})

describe("Email - Reminder Notifications", () => {
  it("sendReminderEmail is exported", () => {
    expect(sendReminderEmail).toBeDefined()
    expect(typeof sendReminderEmail).toBe("function")
  })

  it("includes days since update", async () => {
    const result = await sendReminderEmail({
      sellerEmail: "seller@hellosugar.salon",
      sellerName: "Jane",
      listingTitle: "Atlanta Suite",
      listingId: "123",
      daysSinceUpdate: 35,
    })
    expect(result.success).toBe(true)
  })
})
