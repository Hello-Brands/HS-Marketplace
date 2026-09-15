// User roster, allowlist, and the five account writes.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import {
  adminCount,
  getUsers,
  setUserRole,
  setSellerAccess,
  removeUser,
} from "@/lib/admin/core/users"
import { getAllowlist, addToAllowlist, removeFromAllowlist } from "@/lib/admin/core/allowlist"
import { getUserAnalytics } from "@/lib/admin/core/analytics"
import { userDetail } from "@/lib/mcp/queries/users"
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

type UserRow = {
  id: string
  name: string | null
  email: string | null
  role: string
  sellerAccess: boolean
  loginCount: number
  lastLoginAt: Date | null
  createdAt: Date
}

function userSummary(row: UserRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    seller_access: row.sellerAccess,
    login_count: row.loginCount,
    last_login_at: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
  }
}

async function loadUserOrThrow(userId: string): Promise<UserRow> {
  const row = ((await getUsers()) as UserRow[]).find((u) => u.id === userId)
  if (!row) throw new Error("User not found")
  return row
}

export function registerUserTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_users",
    {
      title: "List users",
      description:
        "Every registered marketplace user with their role, seller access, login count and " +
        "last login. Filter by role, by seller access, or by a case-insensitive `search` " +
        "matched against name and email. Returns { items, next_cursor }.",
      inputSchema: z.object({
        role: z.enum(["user", "admin"]).optional().describe("Only users with this role."),
        seller_access: z
          .boolean()
          .optional()
          .describe("Only users who do (true) or do not (false) have seller access."),
        search: searchField,
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_users", args, async () => {
        const rows = (await getUsers()) as UserRow[]
        const needle = args.search?.trim().toLowerCase()
        const filtered = rows.filter((row) => {
          if (args.role && row.role !== args.role) return false
          if (args.seller_access !== undefined && row.sellerAccess !== args.seller_access) {
            return false
          }
          if (needle && !`${row.name ?? ""} ${row.email ?? ""}`.toLowerCase().includes(needle)) {
            return false
          }
          return true
        })
        const page = paginateArray(filtered, args.limit, args.cursor)
        return { items: page.items.map(userSummary), next_cursor: page.next_cursor }
      }),
  )

  server.registerTool(
    "get_user",
    {
      title: "Get user",
      description:
        "One user in full: the account row, their engagement metrics (listings posted, " +
        "inquiries sent and received, saves, login history), their owner-directory links " +
        "(including revoked ones), their listings, their saved searches and their favorites.",
      inputSchema: z.object({ user_id: userIdField }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "get_user", args, async () => {
        const row = await loadUserOrThrow(args.user_id)
        const [analytics, detail] = await Promise.all([getUserAnalytics(), userDetail(args.user_id)])
        const metrics = analytics.find((a) => a.id === args.user_id)
        return {
          user: userSummary(row),
          activity: {
            listings_posted: metrics?.listingsPosted ?? 0,
            reach_outs_sent: metrics?.reachOutsSent ?? 0,
            inquiries_received: metrics?.inquiriesReceived ?? 0,
            saves_made: metrics?.savesMade ?? 0,
            login_count: metrics?.loginCount ?? row.loginCount,
            logins_last_30d: metrics?.spark ?? [],
          },
          ...detail,
        }
      }),
  )

  server.registerTool(
    "list_allowlist",
    {
      title: "List sign-in allowlist",
      description:
        "Addresses and whole domains permitted to sign in. An entry beginning with '@' is a " +
        "domain entry covering every address at that domain; anything else is one address. " +
        "Returns { items, next_cursor }.",
      inputSchema: z.object({ search: searchField, limit: limitField, cursor: cursorField }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_allowlist", args, async () => {
        const rows = (await getAllowlist()) as {
          id: string
          email: string
          addedBy: string | null
          addedAt: Date
        }[]
        const needle = args.search?.trim().toLowerCase()
        const filtered = needle ? rows.filter((r) => r.email.toLowerCase().includes(needle)) : rows
        const page = paginateArray(filtered, args.limit, args.cursor)
        return {
          items: page.items.map((r) => ({
            id: r.id,
            email: r.email,
            kind: r.email.startsWith("@") ? "domain" : "address",
            added_by: r.addedBy,
            added_at: r.addedAt.toISOString(),
          })),
          next_cursor: page.next_cursor,
        }
      }),
  )

  if (!ctx.canWrite) return

  server.registerTool(
    "set_seller_access",
    {
      title: "Set seller access",
      description:
        "Grant or revoke a user's ability to create listings. Reversible with a second call, " +
        "so it executes immediately with no confirmation step.",
      inputSchema: z.object({
        user_id: userIdField,
        seller_access: z.boolean().describe("true to grant, false to revoke."),
      }),
      annotations: { ...WRITE_ANNOTATIONS, idempotentHint: true },
    },
    async (args) =>
      writeTool(ctx, "set_seller_access", args, async () => {
        const result = await setSellerAccess(ctx.actor, args.user_id, args.seller_access)
        return { audit_id: result.auditId, target: userSummary(await loadUserOrThrow(args.user_id)) }
      }),
  )

  server.registerTool(
    "add_to_allowlist",
    {
      title: "Add to sign-in allowlist",
      description:
        "Permit an individual address ('jane@partnerbrand.com') or a whole company " +
        "('@partnerbrand.com') to sign in. Refuses a malformed entry or one already present.",
      inputSchema: z.object({
        entry: z
          .string()
          .trim()
          .min(3)
          .max(200)
          .describe("An email address, or '@domain.com' for a whole company."),
      }),
      annotations: { ...WRITE_ANNOTATIONS, idempotentHint: true },
    },
    async (args) =>
      writeTool(ctx, "add_to_allowlist", args, async () => {
        const result = await addToAllowlist(ctx.actor, args.entry)
        // This core returns { ok: false } rather than throwing, because Next redacts
        // thrown server-action messages in production. Convert it to a tool error here.
        if (!result.ok) throw new Error(result.error)
        return {
          audit_id: result.auditId,
          target: { type: "allowlist", id: args.entry },
        }
      }),
  )

  server.registerTool(
    "set_user_role",
    {
      title: "Set user role",
      description:
        "Promote a user to admin or demote an admin to user. An admin can do everything this " +
        "connection can do, so promotion is a privilege grant. The last remaining admin " +
        "cannot demote themselves. DESTRUCTIVE: preview first, then re-send with " +
        "confirmation_token.",
      inputSchema: z.object({
        user_id: userIdField,
        role: z.enum(["user", "admin"]).describe("The role to set."),
        confirmation_token: confirmationField,
      }),
      annotations: { ...DESTRUCTIVE_ANNOTATIONS, idempotentHint: true },
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "set_user_role", args, async () => {
        const { confirmation_token, ...rest } = args
        const row = await loadUserOrThrow(rest.user_id)
        // The core's last-admin rule, re-run on the preview path (spec §7.5) so a
        // doomed demotion never mints a token. Only reachable when the target is
        // themselves the sole admin — which, since the caller is an admin too, is
        // exactly the self-demotion the core refuses.
        if (row.role === "admin" && rest.role === "user" && (await adminCount()) <= 1) {
          throw new Error("Cannot demote the last admin")
        }
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "set_user_role",
          rest,
          confirmation_token,
          `Change ${row.name ?? row.email ?? row.id} (${row.email ?? row.id}) from role "${row.role}" to "${rest.role}".` +
            (rest.role === "admin"
              ? " An admin can read and change everything on the marketplace."
              : ""),
        )
        if (prompt) return { ...prompt }
        const result = await setUserRole(ctx.actor, rest.user_id, rest.role)
        return { audit_id: result.auditId, target: userSummary(await loadUserOrThrow(rest.user_id)) }
      }),
  )

  server.registerTool(
    "remove_from_allowlist",
    {
      title: "Remove from sign-in allowlist",
      description:
        "Delete an allowlist entry. Removing a '@domain.com' entry withdraws sign-in from " +
        "everyone at that domain who has no individual entry. DESTRUCTIVE: preview first, " +
        "then re-send with confirmation_token.",
      inputSchema: z.object({
        email: z.string().trim().min(3).max(200).describe("The exact entry to remove."),
        confirmation_token: confirmationField,
      }),
      annotations: { ...DESTRUCTIVE_ANNOTATIONS, idempotentHint: true },
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "remove_from_allowlist", args, async () => {
        const { confirmation_token, ...rest } = args
        const isDomain = rest.email.trim().startsWith("@")
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "remove_from_allowlist",
          rest,
          confirmation_token,
          isDomain
            ? `Remove the domain entry "${rest.email}" from the sign-in allowlist. Everyone at that domain without their own entry loses sign-in.`
            : `Remove "${rest.email}" from the sign-in allowlist. That address can no longer sign in.`,
        )
        if (prompt) return { ...prompt }
        const result = await removeFromAllowlist(ctx.actor, rest.email)
        return { audit_id: result.auditId, target: deletedTarget("allowlist", rest.email) }
      }),
  )

  server.registerTool(
    "remove_user",
    {
      title: "Remove user",
      description:
        "Permanently delete a user account. Their listings, saved searches, favorites and " +
        "inquiries cascade away with them. You cannot remove yourself, and the last remaining " +
        "admin cannot be removed. DESTRUCTIVE and irreversible: preview first, then re-send " +
        "with confirmation_token.",
      inputSchema: z.object({ user_id: userIdField, confirmation_token: confirmationField }),
      annotations: { ...DESTRUCTIVE_ANNOTATIONS, idempotentHint: true },
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "remove_user", args, async () => {
        const { confirmation_token, ...rest } = args
        // Both pre-checks the core enforces, re-run here (spec §7.5) so a doomed
        // call is refused before a token is ever minted.
        if (rest.user_id === ctx.actor.userId) throw new Error("Cannot remove yourself")
        const row = await loadUserOrThrow(rest.user_id)
        if (row.role === "admin" && (await adminCount()) <= 1) {
          throw new Error("Cannot remove the last admin")
        }
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "remove_user",
          rest,
          confirmation_token,
          `Permanently delete ${row.name ?? row.id} (${row.email ?? "no email"}). Their listings, saved searches, favorites and inquiries are deleted with them. This cannot be undone.`,
        )
        if (prompt) return { ...prompt }
        const result = await removeUser(ctx.actor, rest.user_id)
        return { audit_id: result.auditId, target: deletedTarget("user", rest.user_id) }
      }),
  )
}
