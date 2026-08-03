import { Resend } from "resend"
import { formatUsdCents } from "@/lib/money"
import { env } from "@/lib/env"

// Initialize Resend client
const resend = new Resend(env.RESEND_API_KEY)

// From address configuration. Must be on a domain the Resend API key is
// authorized for — the verified sending domain is the `noreply.hellosugar.salon`
// subdomain (not the apex). Override per-environment with EMAIL_FROM if needed.
const FROM_ADDRESS =
  env.EMAIL_FROM || "Hello Sugar Marketplace <marketplace@noreply.hellosugar.salon>"

// Type definitions
export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text?: string
}

export interface StatusChangeEmailData {
  recipientEmail: string
  recipientName: string
  listingTitle: string
  listingId: string
  newStatus: "pending" | "active" | "rejected"
  rejectionReason?: string
}

export interface ContactNotificationData {
  sellerEmail: string
  sellerName: string
  buyerName: string
  buyerEmail: string
  listingTitle: string
  listingId: string
  message?: string
}

export interface AlertMatchData {
  buyerEmail: string
  buyerName: string
  listingTitle: string
  listingId: string
  listingType: string
  city: string
  state: string
  askingPrice: number
}

export interface ReminderEmailData {
  sellerEmail: string
  sellerName: string
  listingTitle: string
  listingId: string
  daysSinceUpdate: number
  markSoldUrl?: string
}

export interface CompetitorAlertData {
  buyerEmail: string
  buyerName: string
  searchName: string
  searchUrl: string
  competitors: Array<{
    brandName: string
    city: string | null
    state: string | null
    nearestHsName: string | null
    nearestHsMiles: number | null
    mapsUrl: string | null
  }>
}

/**
 * Low-level send function — use specific functions below for typed templates
 */
export async function sendEmail({ to, subject, html, text }: SendEmailOptions) {
  // No key configured → don't attempt a send (it would error); make it visible.
  if (!env.RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY not set — skipped "${subject}" to ${to}`)
    return { success: false as const, skipped: true as const }
  }

  // Safe-by-default outside production: only deliver to real recipients when an
  // EMAIL_OVERRIDE inbox is set (point it at your own address to test).
  //
  // Production ALWAYS delivers to the real recipient, regardless of override.
  // This used to read `override || to` unconditionally, and EMAIL_OVERRIDE was in
  // fact set in the production environment — so every seller reminder, buyer
  // inquiry reply, alert match and brand-request email was silently redirected to
  // one inbox, with the intended address only echoed into the subject line.
  // Sellers never got reminders, buyers never got replies, and that inbox
  // accumulated other people's PII plus live one-click action tokens.
  //
  // The signal is VERCEL_ENV, not NODE_ENV: NODE_ENV is "production" on preview
  // deployments too, so keying on it would both mislabel previews as production
  // and (before this) let previews send real mail whenever no override was set.
  const override = env.EMAIL_OVERRIDE?.trim()
  const isProduction = process.env.VERCEL_ENV === "production"

  if (isProduction && override) {
    console.warn(
      "[email] EMAIL_OVERRIDE is set in production and is being IGNORED — remove it from the production environment",
    )
  }
  if (!override && !isProduction) {
    console.warn(`[email] non-production: skipped "${subject}" to ${to} (set EMAIL_OVERRIDE to test real sends)`)
    return { success: false as const, skipped: true as const }
  }
  const redirect = !isProduction && !!override
  const recipient = redirect ? override! : to

  try {
    // The Resend SDK returns API errors in `error` (it does NOT throw on them),
    // so a 4xx like an unverified domain must be checked explicitly.
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: recipient,
      subject: redirect ? `[to: ${to}] ${subject}` : subject,
      html,
      text,
    })
    if (error) {
      console.error(`[email] Resend rejected "${subject}" to ${recipient}:`, error)
      return { success: false as const, error }
    }
    return { success: true as const, data }
  } catch (error) {
    console.error(`[email] Failed to send "${subject}" to ${recipient}:`, error)
    return { success: false as const, error }
  }
}

/**
 * Send listing status change notification to seller
 */
export async function sendStatusChangeEmail(data: StatusChangeEmailData) {
  const { recipientEmail, recipientName, listingTitle, listingId, newStatus, rejectionReason } = data

  const statusMessages = {
    pending: {
      subject: `Your listing is pending review: ${listingTitle}`,
      heading: "Listing Submitted for Review",
      body: "Your listing has been submitted and is now pending admin approval. You'll receive an email once it's reviewed.",
    },
    active: {
      subject: `Your listing is now live: ${listingTitle}`,
      heading: "Listing Approved!",
      body: "Great news! Your listing has been approved and is now visible to potential buyers on the marketplace.",
    },
    rejected: {
      subject: `Action needed: ${listingTitle}`,
      heading: "Listing Needs Changes",
      body: rejectionReason
        ? `Your listing was not approved. Reason: ${rejectionReason}`
        : "Your listing was not approved. Please review and make necessary changes.",
    },
  }

  const msg = statusMessages[newStatus]
  const listingUrl = `${env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"}/listings/${listingId}`

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #ED1845;">${msg.heading}</h1>
      <p>Hi ${recipientName},</p>
      <p>${msg.body}</p>
      <p><strong>Listing:</strong> ${listingTitle}</p>
      <p>
        <a href="${listingUrl}" style="display: inline-block; background: #ED1845; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          View Listing
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #E8DED7; margin: 24px 0;" />
      <p style="color: #8F7067; font-size: 14px;">
        Hello Sugar Marketplace
      </p>
    </div>
  `

  return sendEmail({
    to: recipientEmail,
    subject: msg.subject,
    html,
  })
}

/**
 * Send contact notification to seller when buyer expresses interest
 */
export async function sendContactNotification(data: ContactNotificationData) {
  const { sellerEmail, sellerName, buyerName, buyerEmail, listingTitle, listingId, message } = data
  const listingUrl = `${env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"}/listings/${listingId}`

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #ED1845;">Someone is Interested!</h1>
      <p>Hi ${sellerName},</p>
      <p><strong>${buyerName}</strong> has expressed interest in your listing:</p>
      <p><strong>Listing:</strong> ${listingTitle}</p>
      ${message ? `<div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;"><p style="margin: 0;"><strong>Their message:</strong></p><p style="margin: 8px 0 0 0;">${message}</p></div>` : ""}
      <p><strong>Contact them at:</strong> <a href="mailto:${buyerEmail}">${buyerEmail}</a></p>
      <p>
        <a href="${listingUrl}" style="display: inline-block; background: #ED1845; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          View Your Listing
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #E8DED7; margin: 24px 0;" />
      <p style="color: #8F7067; font-size: 14px;">
        Hello Sugar Marketplace
      </p>
    </div>
  `

  return sendEmail({
    to: sellerEmail,
    subject: `Interest in your listing: ${listingTitle}`,
    html,
  })
}

/**
 * Send alert match notification to buyer when new listing matches their criteria
 */
export async function sendAlertMatchEmail(data: AlertMatchData) {
  const { buyerEmail, buyerName, listingTitle, listingId, listingType, city, state, askingPrice } = data
  const listingUrl = `${env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"}/listings/${listingId}`
  const formattedPrice = formatUsdCents(askingPrice)

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #ED1845;">New Listing Matches Your Alert</h1>
      <p>Hi ${buyerName},</p>
      <p>A new listing has been posted that matches your saved alert criteria:</p>
      <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0;"><strong>${listingTitle}</strong></p>
        <p style="margin: 0 0 4px 0;">Type: ${listingType}</p>
        <p style="margin: 0 0 4px 0;">Location: ${city}, ${state}</p>
        <p style="margin: 0;">Asking Price: ${formattedPrice}</p>
      </div>
      <p>
        <a href="${listingUrl}" style="display: inline-block; background: #ED1845; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          View Listing
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #E8DED7; margin: 24px 0;" />
      <p style="color: #8F7067; font-size: 14px;">
        Hello Sugar Marketplace<br />
        <a href="${env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"}/account/alerts" style="color: #8F7067;">Manage your alerts</a>
      </p>
    </div>
  `

  return sendEmail({
    to: buyerEmail,
    subject: `New listing alert: ${listingTitle}`,
    html,
  })
}

/**
 * Send 30-day reminder to seller when listing needs attention
 */
export async function sendReminderEmail(data: ReminderEmailData) {
  const { sellerEmail, sellerName, listingTitle, listingId, daysSinceUpdate, markSoldUrl } = data
  const listingUrl = `${env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"}/seller/listings/${listingId}/edit`

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #ED1845;">Is Your Listing Still Active?</h1>
      <p>Hi ${sellerName},</p>
      <p>Your listing <strong>${listingTitle}</strong> has been active for ${daysSinceUpdate} days without an update.</p>
      <p>Has this location sold? If so, you can mark it sold with one click — no login required:</p>
      ${markSoldUrl ? `
      <p>
        <a href="${markSoldUrl}" style="display: inline-block; background: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          Mark as Sold
        </a>
      </p>
      ` : ''}
      <p style="margin-top: 16px;">Still looking for a buyer? Keep your listing current to attract serious buyers:</p>
      <ul>
        <li>Recent financials or performance data</li>
        <li>New photos</li>
        <li>Updated asking price</li>
        <li>Any changes to included assets</li>
      </ul>
      <p>
        <a href="${listingUrl}" style="display: inline-block; background: #ED1845; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          Update Listing
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #E8DED7; margin: 24px 0;" />
      <p style="color: #8F7067; font-size: 14px;">
        Hello Sugar Marketplace
      </p>
    </div>
  `

  return sendEmail({
    to: sellerEmail,
    subject: `Reminder: Is your listing still active? - ${listingTitle}`,
    html,
  })
}

/**
 * Build the competitor-closure digest email (pure — exported for tests).
 */
export function buildCompetitorAlertEmail(data: CompetitorAlertData): { subject: string; html: string } {
  const { buyerName, searchName, searchUrl, competitors } = data
  const n = competitors.length
  const subject = `${n} new competitor closure${n !== 1 ? "s" : ""} near your saved search`
  const appUrl = env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"

  const cards = competitors
    .map((c) => {
      const loc = [c.city, c.state].filter(Boolean).join(", ")
      const nearest =
        c.nearestHsName != null && c.nearestHsMiles != null
          ? `<p style="margin: 0 0 4px 0; color: #8F7067;">Nearest Hello Sugar: ${c.nearestHsName} (${c.nearestHsMiles} mi)</p>`
          : ""
      const maps = c.mapsUrl
        ? `<p style="margin: 0;"><a href="${c.mapsUrl}" style="color: #ED1845;">View on Google Maps</a></p>`
        : ""
      return `
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 0 0 12px 0;">
          <p style="margin: 0 0 4px 0;"><strong>${c.brandName}</strong></p>
          ${loc ? `<p style="margin: 0 0 4px 0;">${loc}</p>` : ""}
          ${nearest}
          ${maps}
        </div>`
    })
    .join("")

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #ED1845;">New Competitor Closures Near Your Search</h1>
      <p>Hi ${buyerName},</p>
      <p>${n} new competitor closure${n !== 1 ? "s" : ""} appeared in the area of your saved search <strong>${searchName}</strong>:</p>
      ${cards}
      <p>
        <a href="${searchUrl}" style="display: inline-block; background: #ED1845; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          View your saved search
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #E8DED7; margin: 24px 0;" />
      <p style="color: #8F7067; font-size: 14px;">
        Hello Sugar Marketplace<br />
        <a href="${appUrl}/account/alerts" style="color: #8F7067;">Manage your alerts</a>
      </p>
    </div>
  `

  return { subject, html }
}

/**
 * Send the competitor-closure digest to a saved-search owner.
 */
export async function sendCompetitorAlertEmail(data: CompetitorAlertData) {
  const { subject, html } = buildCompetitorAlertEmail(data)
  return sendEmail({ to: data.buyerEmail, subject, html })
}
