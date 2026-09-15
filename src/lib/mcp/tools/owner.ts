// Owner directory reads and the four owner-link / directory writes.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import { queryOwnerDirectory, queryUsersWithLinks } from "@/lib/owner-directory/data"
import { addOwnerLink, revokeOwnerLink, clearOwnerLink } from "@/lib/admin/core/owner-links"
import { refreshOwnerDirectory } from "@/lib/admin/core/owner-directory"
import { requireConfirmation } from "@/lib/mcp/confirm"
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ANNOTATIONS,
  REQUIRES_USER_INTERACTION,
  WRITE_ANNOTATIONS,
  confirmationField,
  cursorField,
  deletedTarget,
  limitField,
  paginateArray,
  readTool,
  searchField,
  writeTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

const userIdField = z.string().min(1).max(64).describe("The user's id.")
const ownerIdentifierField = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe("The owner_identifier string exactly as it appears in the owner directory.")

type OwnerLink = Awaited<ReturnType<typeof queryUsersWithLinks>>[number]["links"][number]

/**
 * Who a destructive link tool is about to act on, and what that link looks like
 * right now.
 *
 * ENRICHMENT, never a gate. The cores deliberately validate nothing here — an
 * orphaned link, and even a user id matching nobody, must stay revocable and
 * clearable — so nothing in this path throws or refuses. A missing user or a
 * missing link simply produces a different, equally factual sentence. Without it
 * the preview names only an opaque id, and a mistyped user_id reads exactly like
 * the intended one.
 */
async function linkContext(
  userId: string,
  ownerIdentifier: string,
): Promise<{ who: string; link: OwnerLink | undefined }> {
  const user = (await queryUsersWithLinks()).find((u) => u.id === userId)
  if (!user) return { who: `unknown user ${userId}`, link: undefined }
  return {
    who: `${user.email ?? user.name ?? "no email on file"} (user ${user.id})`,
    link: user.links.find((l) => l.ownerIdentifier === ownerIdentifier),
  }
}

/** How the user is linked to that owner today, as one sentence. */
function currentLinkSentence(link: OwnerLink | undefined): string {
  if (!link) return "They have no link to that owner right now."
  if (link.source === "revoked") return "That owner is already revoked for them."
  if (link.source === "manual") return "Their link to that owner is a manual admin override."
  return "Their link to that owner was matched automatically from their sign-in email."
}

/** What deleting that exact row does, as one sentence — no hedging. */
function clearConsequenceSentence(link: OwnerLink | undefined): string {
  if (!link) return "There is no such link row right now, so this deletes nothing."
  if (link.source === "revoked") {
    return (
      "That row is a revocation, so deleting it makes this owner eligible for automatic " +
      "re-linking on their next login."
    )
  }
  if (link.source === "manual") {
    return (
      "That row is a manual admin override, so deleting it removes this owner unless the " +
      "automatic email match re-links it on their next login."
    )
  }
  return (
    "That row is an automatic email match, so deleting it removes this owner until the " +
    "matcher re-links it on their next login."
  )
}

export function registerOwnerTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_owner_directory",
    {
      title: "List owner directory",
      description:
        "Synced franchise-owner records: one row per owner per Boulevard location, with the " +
        "owner identifier, contact email, location name and number, and the resolved " +
        "BigQuery location name. `search` matches the owner identifier, owner name, contact " +
        "email or location name. Returns { items, next_cursor }.",
      inputSchema: z.object({ search: searchField, limit: limitField, cursor: cursorField }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_owner_directory", args, async () => {
        const rows = await queryOwnerDirectory(args.search)
        const page = paginateArray(rows, args.limit, args.cursor)
        return {
          items: page.items.map((r) => ({
            id: r.id,
            owner_identifier: r.ownerIdentifier,
            owner_name: r.ownerName,
            owner_contact_email: r.ownerContactEmail,
            location_name: r.blvdLocationName,
            location_number: r.blvdLocationNumber,
            location_address: r.locationAddress,
            resolved_bq_location_name: r.resolvedBqLocationName,
            match_method: r.blvdMatchMethod,
            match_confidence: r.blvdMatchConfidence,
            synced_at: r.syncedAt.toISOString(),
          })),
          next_cursor: page.next_cursor,
        }
      }),
  )

  server.registerTool(
    "list_owner_links",
    {
      title: "List user-to-owner links",
      description:
        'Every user with all of their owner-directory links. A link\'s `source` is "auto" ' +
        '(matched from the sign-in email), "manual" (an admin override) or "revoked" (an ' +
        "admin suppression that survives re-sync and re-login) — revoked rows are included " +
        "deliberately so a suppression is never invisible. Returns { items, next_cursor }.",
      inputSchema: z.object({
        // .min(1) matters: without it `user_id: ""` is a valid filter that matches
        // no user, so the tool would silently return the WHOLE roster instead.
        user_id: z.string().min(1).max(64).optional().describe("Only this user's links."),
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_owner_links", args, async () => {
        const rows = await queryUsersWithLinks()
        const filtered = args.user_id ? rows.filter((r) => r.id === args.user_id) : rows
        const page = paginateArray(filtered, args.limit, args.cursor)
        return {
          items: page.items.map((r) => ({
            id: r.id,
            name: r.name,
            email: r.email,
            links: r.links.map((l) => ({
              owner_identifier: l.ownerIdentifier,
              source: l.source,
            })),
          })),
          next_cursor: page.next_cursor,
        }
      }),
  )

  if (!ctx.canWrite) return

  server.registerTool(
    "add_owner_link",
    {
      title: "Link user to owner",
      description:
        "Manually link a user to an owner_identifier so they see that owner's locations. " +
        "Manual links are never overwritten by the automatic email match. The owner must " +
        "already exist in the directory and cannot be the Unknown Owner bucket. Reversible " +
        "with revoke_owner_link, so it executes immediately.",
      inputSchema: z.object({ user_id: userIdField, owner_identifier: ownerIdentifierField }),
      annotations: { ...WRITE_ANNOTATIONS, idempotentHint: true },
    },
    async (args) =>
      writeTool(ctx, "add_owner_link", args, async () => {
        const result = await addOwnerLink(ctx.actor, args.user_id, args.owner_identifier)
        // This core returns { ok: false } rather than throwing, because Next redacts
        // thrown server-action messages in production. Convert it to a tool error here.
        if (!result.ok) throw new Error(result.error)
        return {
          audit_id: result.auditId,
          target: {
            type: "owner_link",
            id: `${args.user_id}:${args.owner_identifier}`,
            source: "manual",
          },
        }
      }),
  )

  server.registerTool(
    "revoke_owner_link",
    {
      title: "Revoke owner link",
      description:
        "Suppress one owner profile for a user. Durable: the sign-in matcher skips revoked " +
        "owners, so this survives directory re-sync and the user's next login. The user " +
        "immediately loses access to that owner's locations. DESTRUCTIVE: preview first, " +
        "then re-send with confirmation_token.",
      inputSchema: z.object({
        user_id: userIdField,
        owner_identifier: ownerIdentifierField,
        confirmation_token: confirmationField,
      }),
      annotations: { ...DESTRUCTIVE_ANNOTATIONS, idempotentHint: true },
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "revoke_owner_link", args, async () => {
        const { confirmation_token, ...rest } = args
        // No pre-check to mirror: revokeOwnerLink refuses nothing (it deliberately
        // skips the directory-membership check so an orphaned link is still
        // cleanable — src/lib/admin/core/owner-links.ts:86-99). The lookup below
        // only enriches the preview; it never gates the write.
        const { who, link } = await linkContext(rest.user_id, rest.owner_identifier)
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "revoke_owner_link",
          rest,
          confirmation_token,
          `Revoke ${who}'s access to owner "${rest.owner_identifier}". ${currentLinkSentence(link)} They lose that owner's locations immediately, and the automatic email matcher will not re-link it.`,
        )
        if (prompt) return { ...prompt }
        const result = await revokeOwnerLink(ctx.actor, rest.user_id, rest.owner_identifier)
        if (!result.ok) throw new Error(result.error)
        return {
          audit_id: result.auditId,
          target: {
            type: "owner_link",
            id: `${rest.user_id}:${rest.owner_identifier}`,
            source: "revoked",
          },
        }
      }),
  )

  server.registerTool(
    "clear_owner_link",
    {
      title: "Clear owner link",
      description:
        "Delete a link row outright. This undoes a revocation (the owner becomes eligible for " +
        "automatic re-linking on the user's next login) or removes a manual link. Use " +
        "revoke_owner_link instead when you want the suppression to stick. DESTRUCTIVE: " +
        "preview first, then re-send with confirmation_token.",
      inputSchema: z.object({
        user_id: userIdField,
        owner_identifier: ownerIdentifierField,
        confirmation_token: confirmationField,
      }),
      annotations: { ...DESTRUCTIVE_ANNOTATIONS, idempotentHint: true },
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "clear_owner_link", args, async () => {
        const { confirmation_token, ...rest } = args
        // No pre-check to mirror: clearOwnerLink refuses nothing — a delete that
        // matches no row is a no-op (src/lib/admin/core/owner-links.ts:104-124).
        // The lookup below only enriches the preview; it never gates the write.
        const { who, link } = await linkContext(rest.user_id, rest.owner_identifier)
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "clear_owner_link",
          rest,
          confirmation_token,
          `Delete the link row between ${who} and owner "${rest.owner_identifier}". ${clearConsequenceSentence(link)}`,
        )
        if (prompt) return { ...prompt }
        const result = await clearOwnerLink(ctx.actor, rest.user_id, rest.owner_identifier)
        if (!result.ok) throw new Error(result.error)
        return {
          audit_id: result.auditId,
          target: deletedTarget("owner_link", `${rest.user_id}:${rest.owner_identifier}`),
        }
      }),
  )

  server.registerTool(
    "refresh_owner_directory",
    {
      title: "Refresh owner directory",
      description:
        "Run the owner-directory sync now instead of waiting for the nightly cron. Pulls the " +
        "current owner/location roster, re-resolves Boulevard matches and stamps coordinates. " +
        "Returns the inserted/updated/deleted counts. Takes no arguments.",
      inputSchema: z.object({}),
      annotations: WRITE_ANNOTATIONS,
    },
    async () =>
      writeTool(ctx, "refresh_owner_directory", {}, async () => {
        const result = await refreshOwnerDirectory(ctx.actor)
        if (!result.ok) throw new Error(result.error)
        return {
          audit_id: result.auditId,
          target: { type: "owner_directory", id: null, result: result.result },
        }
      }),
  )
}
