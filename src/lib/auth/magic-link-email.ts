import { Resend } from "resend"
import type { EmailProviderSendVerificationRequestParams } from "next-auth/providers/email"
import { FROM_ADDRESS } from "@/lib/email"
import { env } from "@/lib/env"

/**
 * Magic-link sign-in email (Auth.js Resend provider).
 *
 * This deliberately does NOT go through `sendEmail` in src/lib/email.ts. That
 * helper hard-skips every non-production send unless EMAIL_OVERRIDE is set,
 * which for a sign-in link means the link is silently swallowed and local dev
 * can never log in. The environment rules below mirror `sendEmail` but the
 * non-production fallback prints the link to the server console instead of
 * dropping it.
 */

/** Links are short-lived: 15 minutes, single use. */
export const MAGIC_LINK_MAX_AGE_SECONDS = 15 * 60

/** Escape the five characters that matter inside HTML text and attribute values. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function buildMagicLinkEmail(input: { url: string; expiresMinutes: number }): {
  subject: string
  html: string
  text: string
} {
  const { url, expiresMinutes } = input
  const safeUrl = escapeHtml(url)
  const subject = "Your Hello Sugar Marketplace sign-in link"

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #ED1845;">Sign in to Hello Sugar Marketplace</h1>
      <p>Click the button below to sign in. This link expires in ${expiresMinutes} minute${expiresMinutes === 1 ? "" : "s"} and works only once.</p>
      <p>
        <a href="${safeUrl}" style="display: inline-block; background: #ED1845; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          Sign in
        </a>
      </p>
      <p style="color: #8F7067; font-size: 14px; word-break: break-all;">
        Button not working? Paste this link into your browser:<br />
        ${safeUrl}
      </p>
      <p>If you didn't request this email, you can safely ignore it.</p>
      <hr style="border: none; border-top: 1px solid #E8DED7; margin: 24px 0;" />
      <p style="color: #8F7067; font-size: 14px;">
        Hello Sugar Marketplace
      </p>
    </div>
  `

  const text = [
    "Sign in to Hello Sugar Marketplace",
    "",
    `Use this link to sign in. It expires in ${expiresMinutes} minute${expiresMinutes === 1 ? "" : "s"} and works only once.`,
    "",
    url,
    "",
    "If you didn't request this email, you can safely ignore it.",
    "",
    "Hello Sugar Marketplace",
  ].join("\n")

  return { subject, html, text }
}

export async function sendMagicLinkEmail(
  params: EmailProviderSendVerificationRequestParams,
): Promise<void> {
  const isProduction = process.env.VERCEL_ENV === "production"
  const override = env.EMAIL_OVERRIDE?.trim()

  const expiresMinutes = Math.max(
    1,
    Math.round((params.expires.getTime() - Date.now()) / 60_000),
  )
  const built = buildMagicLinkEmail({ url: params.url, expiresMinutes })

  // Local dev / preview with no override inbox: print the link instead of
  // sending it. Copy it out of the terminal to sign in. Never reached in
  // production, so the token is never logged there.
  if (!isProduction && !override) {
    console.warn(
      `[magic-link] non-production: not sending. Sign-in link for ${params.identifier}: ${params.url}`,
    )
    return
  }

  const redirect = !isProduction && !!override
  const recipient = isProduction ? params.identifier : override!
  const subject = redirect ? `[to: ${params.identifier}] ${built.subject}` : built.subject

  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set")

  // Constructed lazily: at module scope this would run inside the Auth.js
  // config graph on every import, including where no key exists.
  const resend = new Resend(env.RESEND_API_KEY)

  // The Resend SDK reports API errors in `error` rather than throwing, so a
  // rejected send would otherwise look like a successful one.
  const { error } = await resend.emails.send({
    from: params.provider.from ?? FROM_ADDRESS,
    to: recipient,
    subject,
    html: built.html,
    text: built.text,
  })

  if (error) {
    throw new Error(`Resend rejected sign-in email: ${error.message}`)
  }
}
