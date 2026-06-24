import { Resend } from "resend"

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY)

// From address configuration
const FROM_ADDRESS = "Hello Sugar Marketplace <noreply@hellosugar.salon>"

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

/**
 * Low-level send function — use specific functions below for typed templates
 */
export async function sendEmail({ to, subject, html, text }: SendEmailOptions) {
  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
      text,
    })
    return { success: true, data: result }
  } catch (error) {
    console.error("Failed to send email:", error)
    return { success: false, error }
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
  const listingUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"}/listings/${listingId}`

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #db2777;">${msg.heading}</h1>
      <p>Hi ${recipientName},</p>
      <p>${msg.body}</p>
      <p><strong>Listing:</strong> ${listingTitle}</p>
      <p>
        <a href="${listingUrl}" style="display: inline-block; background: #db2777; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          View Listing
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #6b7280; font-size: 14px;">
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
  const listingUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"}/listings/${listingId}`

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #db2777;">Someone is Interested!</h1>
      <p>Hi ${sellerName},</p>
      <p><strong>${buyerName}</strong> has expressed interest in your listing:</p>
      <p><strong>Listing:</strong> ${listingTitle}</p>
      ${message ? `<div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;"><p style="margin: 0;"><strong>Their message:</strong></p><p style="margin: 8px 0 0 0;">${message}</p></div>` : ""}
      <p><strong>Contact them at:</strong> <a href="mailto:${buyerEmail}">${buyerEmail}</a></p>
      <p>
        <a href="${listingUrl}" style="display: inline-block; background: #db2777; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          View Your Listing
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #6b7280; font-size: 14px;">
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
  const listingUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"}/listings/${listingId}`
  const formattedPrice = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(askingPrice / 100)

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #db2777;">New Listing Matches Your Alert</h1>
      <p>Hi ${buyerName},</p>
      <p>A new listing has been posted that matches your saved alert criteria:</p>
      <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0;"><strong>${listingTitle}</strong></p>
        <p style="margin: 0 0 4px 0;">Type: ${listingType}</p>
        <p style="margin: 0 0 4px 0;">Location: ${city}, ${state}</p>
        <p style="margin: 0;">Asking Price: ${formattedPrice}</p>
      </div>
      <p>
        <a href="${listingUrl}" style="display: inline-block; background: #db2777; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          View Listing
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #6b7280; font-size: 14px;">
        Hello Sugar Marketplace<br />
        <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"}/account/alerts" style="color: #6b7280;">Manage your alerts</a>
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
  const listingUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"}/seller/listings/${listingId}/edit`

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #db2777;">Is Your Listing Still Active?</h1>
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
        <a href="${listingUrl}" style="display: inline-block; background: #db2777; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          Update Listing
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #6b7280; font-size: 14px;">
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
