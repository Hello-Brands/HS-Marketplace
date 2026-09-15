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
        user_id: z.string().max(64).optional().describe("Only this user's links."),
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
        // cleanable — src/lib/admin/core/owner-links.ts:86-99).
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "revoke_owner_link",
          rest,
          confirmation_token,
          `Revoke user ${rest.user_id}'s access to owner "${rest.owner_identifier}". They lose that owner's locations immediately, and the automatic email matcher will not re-link it.`,
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
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "clear_owner_link",
          rest,
          confirmation_token,
          `Delete the link row between user ${rest.user_id} and owner "${rest.owner_identifier}". If it was a revocation, the automatic matcher may re-link this owner on their next login.`,
        )
        if (prompt) return { ...prompt }
        const result = await clearOwnerLink(ctx.actor, rest.user_id, rest.owner_identifier)
        if (!result.ok) throw new Error(result.error)
        return {
          audit_id: result.auditId,
          target: {
            type: "owner_link",
            id: `${rest.user_id}:${rest.owner_identifier}`,
            deleted: true,
          },
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
