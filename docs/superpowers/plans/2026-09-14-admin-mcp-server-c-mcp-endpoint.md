# Admin MCP Server — PR C: MCP Endpoint, Tools, and Destructive Confirmation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `POST /api/mcp` — a bearer-authenticated, stateless Streamable HTTP MCP endpoint that exposes every marketplace admin read and every admin write the web UI can already do, with two-step confirmation on destructive tools.

**Architecture:** The route verifies the bearer with `verifyMcpToken` (PR B), then builds a **fresh `McpServer` per request** with the actor captured in a closure and hands it to `createMcpHandler(...).fetch()`. Tools live in one module per domain under `src/lib/mcp/tools/`, each exporting a `register<Domain>Tools(server, ctx)` that registers reads unconditionally and writes only when the token carries `marketplace:write` — so `tools/list` filters by scope for free. Every read funnels through a shared `readTool()` wrapper (audit via `recordMcpRead` + result shaping + error mapping); every write through `writeTool()` (per-token rate limit + the same shaping). Destructive tools mint and verify a stateless HMAC confirmation token so a preview call and the executing call are provably the same arguments, actor, and tool.

**Tech Stack:** Next.js 15 App Router (Node runtime route handler), TypeScript, `@modelcontextprotocol/server@^2` + `@modelcontextprotocol/core@^2` (runtime) and `@modelcontextprotocol/client@^2` (dev/tests), zod 4, Drizzle ORM on Neon (neon-http), `node:crypto` HMAC, Sentry, vitest (node env).

**Spec:** `docs/superpowers/specs/2026-09-14-admin-mcp-server-design.md` — this plan covers **§7 (endpoint, tools, confirmation, rate limiting)**, **§8 (testing)** and **§9 (rollout, PR 3 of 3)**. §3 lists the codebase constraints. Read the spec alongside this plan.

**Depends on:** PR A (core extraction + `admin_audit_log` + activity feed) and PR B (OAuth server + `verifyMcpToken` + `MCP_CONFIRM_SECRET`) are merged to `origin/main` before this branch is cut. Every interface listed under "Interfaces provided by earlier PRs" below is imported, never redefined.

## Global Constraints

- **SDK line is v2.** `@modelcontextprotocol/server@^2` and `@modelcontextprotocol/core@^2` as runtime deps, `@modelcontextprotocol/client@^2` as a dev dep. `dist-tags.latest` is `2.0.0` for all three (published 2026-07-27). Do **not** use `@modelcontextprotocol/sdk@^1.x`; the v1 fallback is documented in "References → SDK version decision" and is only for if v2 fails the Task 3 gate.
- **The v2 handler is a factory, not a server.** `createMcpHandler(factory)` calls the factory **once per HTTP request**. Register tools inside the factory. Never register tools on a shared module-level `McpServer`.
- **`authInfo` is strictly pass-through.** The SDK handler validates no `Host` header, no `Origin` header, and no token. Bearer verification happens in `route.ts` before `handler.fetch(...)`.
- **`inputSchema` is a full zod object** (`z.object({ … })`), not a raw `{ field: z.string() }` shape. The raw-shape overload is `@deprecated` in v2.
- **Tool handler context is `ctx`, not `extra`.** Auth is `ctx.http?.authInfo`; the raw request is `ctx.http?.req`. `extra.authInfo` / `extra.requestInfo` are v1 names and do not exist here.
- **Tool names are exactly the spec's** (`§7.3` / `§7.4`): `snake_case`, unprefixed. This deliberately departs from `.agents/skills/mcp-builder/reference/mcp_best_practices.md`, which recommends a `{service}_` prefix — the spec fixes the names and MCP clients already namespace by server name (`hs-marketplace`). Do not rename.
- **Pagination on every list tool:** `limit` integer 1–100, **default 25**; `cursor` opaque base64url string; result is `{ items, next_cursor }` where `next_cursor` is `null` on the last page.
- **Money is always `{ cents, formatted }`** built from `src/lib/money.ts`. Never emit a bare number for a money field, never emit dollars.
- **Free-text input caps:** `search` ≤ 200 chars; reasons and notes ≤ 2 000 chars. Enforced in the zod schema, not in the handler.
- **Annotations are effect-based and honest:** every tool sets `openWorldHint: false`. Reads set `readOnlyHint: true, destructiveHint: false, idempotentHint: true`. Writes set `readOnlyHint: false`. `idempotentHint` describes whether a repeated call changes state further — not whether the second call returns the same message.
- **Every destructive tool** sets `destructiveHint: true`, `_meta: { "anthropic/requiresUserInteraction": true }`, and accepts an optional `confirmation_token`.
- **Confirmation tokens are stateless HMAC-SHA256** over canonical JSON of `{ tool, args, userId, exp }` keyed by `env.MCP_CONFIRM_SECRET` (≥ 32 chars, added by PR B). TTL is **600 seconds**. Verification uses `timingSafeEqual`.
- **Write rate limit: 30 writes / minute / token**, via `checkRateLimit(\`mcp-write:${tokenId}\`, 30, 60_000)` from `src/lib/rate-limit.ts`. That limiter is per-instance and in-memory (**DEBT-028**) — best-effort only, never described as a guarantee.
- **Every MCP read writes one audit row** via `recordMcpRead(actor, tool, args)` (`action = "mcp.read"`). Every MCP write goes through a PR A core function that already calls `withAudit` and returns `auditId` — the one exception is `revoke_mcp_connection`, which wraps `revokeMcpToken` in `withAudit` itself.
- **Every write result is `{ audit_id, target }`**, where `target` is the post-write state (or `{ type, id, deleted: true }` when the row is gone).
- **Error mapping:** a thrown plain `Error` (i.e. `err.name === "Error"`) is the UI's own message and is returned as `{ isError: true }` with that message verbatim. Anything else goes to Sentry with a generated reference and returns `"Unexpected error (ref <ref>)"`.
- **New modules are NOT `"use server"` modules.** Every new file under `src/lib/mcp/` carries the same "NOT a use server module" header used by `src/lib/alerts/matching.ts`. Do not add `import "server-only"` to them (tsx scripts crash on transitive `server-only`; vitest stubs it so tests would never catch it).
- **Neon HTTP driver has no transactions.** Any multi-row write uses `db.batch`. PR C adds no multi-row writes of its own.
- **No migrations in PR C.** `0011` (audit log) ships in PR A, `0012` (OAuth tables) in PR B. If you find yourself writing SQL DDL, stop — you are out of scope.
- **`brand_requests` is co-written by the external competitor-monitor repo. Never cache reads of it.** No `unstable_cache`, no `revalidate`, no memoization.
- **`competitor_opportunities` and `monitored_brands` are scraper-owned and read-only.** No tool writes to them.
- **No new admin powers.** Every write tool wraps an existing PR A core function. There is no admin delist, no suspend, no admin-triggered alert matching, no email resend.
- **Tests:** vitest, node environment, `src/__tests__/**/*.test.ts` only. No component tests. Mock the DB with `vi.mock("@/db")` + `builder()` from `test/helpers/drizzle-mock.ts`.
- **`npm install` already applies `--legacy-peer-deps`** (`.npmrc` has `legacy-peer-deps=true`; `vercel.json` sets `installCommand: "npm install --legacy-peer-deps"`). Pass the flag explicitly anyway so the command is correct on a clean checkout.
- **Windows:** never run `next build` while a dev server is running (`.next` lock). Use `npx tsc --noEmit` as the per-task type gate. **Never start `npm run dev` unprompted** — the manual verification task asks the user to start it.
- **Every commit message ends with** `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Interfaces provided by earlier PRs — import, never redefine

```ts
// PR A — src/lib/admin/core/actor.ts
export interface AdminActor { userId: string; source: "ui" | "mcp"; clientId?: string; tokenId?: string }

// PR A — src/lib/admin/audit.ts
export interface AuditTarget { type: "listing"|"user"|"allowlist"|"brand_request"|"owner_link"|"listing_location"|"owner_directory"|"mcp_token"; id: string | null }
export function withAudit<T>(actor: AdminActor, action: string, target: AuditTarget | null, args: unknown, fn: () => Promise<T>): Promise<{ result: T; auditId: string }>
export function recordMcpRead(actor: AdminActor, tool: string, args: unknown): Promise<string>

// PR A — src/db/schema/adminAuditLog.ts
//   adminAuditLog: id, actorUserId, source, mcpClientId, mcpTokenId, action,
//                  targetType, targetId, args (jsonb), outcome, error, durationMs, createdAt

// PR A — src/lib/admin/activity.ts
export type ActivityKind = "admin_action"|"listing_created"|"listing_listed"|"listing_updated"|"inquiry"|"favorite"|"login"|"brand_request_submitted"|"brand_request_decided"|"owner_link_changed"
export interface ActivityItem { at: Date; kind: ActivityKind; id: string; actor: { id: string; name: string | null; email: string | null } | null; target: { type: string; id: string; label: string | null } | null; summary: string; source?: "ui" | "mcp" }
export async function getRecentActivity(opts: { kinds?: ActivityKind[]; actorUserId?: string; since?: Date; cursor?: string | null; limit: number }): Promise<{ items: ActivityItem[]; nextCursor: string | null }>

// PR A — src/lib/admin/core/*.ts (all actor-first; all call withAudit internally)
//   listings.ts:        getPendingListings(), getAllListings(statusFilter?),
//                       approveListing(actor, listingId) -> { success: true, auditId }
//                       rejectListing(actor, listingId, reason, notes?) -> { success: true, auditId }
//                       adminUpdateListing(actor, listingId, input) -> { success: true, auditId }
//                       adminMarkSold(actor, listingId) -> { success: true, auditId }
//   users.ts:           getUsers(), setUserRole(actor, userId, "user"|"admin") -> { auditId }
//                       setSellerAccess(actor, userId, boolean) -> { auditId }
//                       removeUser(actor, userId) -> { auditId }
//   allowlist.ts:       getAllowlist(), addToAllowlist(actor, raw) -> { ok: true, auditId } | { ok: false, error }
//                       removeFromAllowlist(actor, email) -> { auditId }
//   brand-requests.ts:  approveBrandRequest(actor, id, { withoutRecon? }) -> { success: true, dispatched: boolean, auditId }
//                       rejectBrandRequest(actor, id, reason) -> { success: true, auditId }
//                       retryMonitorDispatch(actor, id, "recon"|"build") -> { success: true, auditId }
//   owner-links.ts:     addOwnerLink / revokeOwnerLink / clearOwnerLink (actor, userId, ownerIdentifier)
//                         -> { ok: true, auditId } | { ok: false, error }
//   owner-directory.ts: refreshOwnerDirectory(actor) -> { ok: true, result, auditId } | { ok: false, error }
//   data-mappings.ts:   setLocationMapping(actor, locationId, { bqLocationName, status })
//                         -> { ok: true, auditId } | { ok: false, error }
//   inquiries.ts:       getInquiries()
//   analytics.ts:       getAnalyticsSummary(), getLoginTrend(), getUserAnalytics()

// PR B — src/lib/mcp/auth/verify-token.ts
export interface McpActor { userId: string; email: string | null; scopes: string[]; clientId: string; tokenId: string }
export async function verifyMcpToken(bearer: string | null | undefined): Promise<McpActor | null>
export const MCP_SCOPES = ["marketplace:read", "marketplace:write"] as const

// PR B — src/lib/mcp/oauth/urls.ts
export function issuerUrl(): string
export function mcpResourceUrl(): string
export function protectedResourceMetadataUrl(): string

// PR B — src/lib/mcp/oauth/grants.ts
export function listMcpConnections(opts: { userId: string; all?: boolean }): Promise<McpConnection[]>
export function revokeMcpToken(opts: { tokenId: string; requesterUserId: string; ownOnly?: boolean }): Promise<{ ok: true } | { ok: false; error: string }>
```

`McpActor` → `AdminActor` is always `{ userId, source: "mcp", clientId, tokenId }`.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/lib/mcp/tools/_shared.ts` | `McpToolContext`, pagination + cursor codec, `money()`, `toolResult`/`toolError`, `isExpectedToolError`, `readTool`/`writeTool` wrappers, shared zod fragments, annotation presets |
| `src/lib/mcp/confirm.ts` | `canonicalJson`, `createConfirmationToken`, `verifyConfirmationToken`, `requireConfirmation` |
| `src/lib/mcp/server.ts` | `buildMcpServer(actor)`, `WRITE_TOOL_NAMES`, server identity constants |
| `src/lib/mcp/queries/overview.ts` | `marketplaceOverview()` — counts no existing module provides |
| `src/lib/mcp/queries/audit.ts` | `listAuditLog(filters)` — keyset page over `admin_audit_log` |
| `src/lib/mcp/queries/listings.ts` | `listingExtras(listingId)` — inquiries, views, audit history for one listing |
| `src/lib/mcp/queries/users.ts` | `userDetail(userId)` — owner links, listings, alerts, favorites for one user |
| `src/lib/mcp/queries/data-mappings.ts` | `unresolvedMappings()` — blocking salon locations plus BigQuery suggestions |
| `src/lib/mcp/queries/brand-requests.ts` | `listBrandRequests(filters)`, `getBrandRequestDetail(id)` — uncached by contract |
| `src/lib/mcp/queries/alerts.ts` | `listAlerts(filters)` — alerts joined to their owner |
| `src/lib/mcp/tools/overview.ts` | `get_marketplace_overview`, `list_recent_activity`, `list_audit_log` |
| `src/lib/mcp/tools/listings.ts` | `list_listings`, `get_listing`, `approve_listing`, `reject_listing`, `update_listing`, `mark_listing_sold` |
| `src/lib/mcp/tools/users.ts` | `list_users`, `get_user`, `list_allowlist`, `set_user_role`, `set_seller_access`, `add_to_allowlist`, `remove_from_allowlist`, `remove_user` |
| `src/lib/mcp/tools/brand-requests.ts` | `list_brand_requests`, `get_brand_request`, `approve_brand_request`, `reject_brand_request`, `retry_brand_request_dispatch` |
| `src/lib/mcp/tools/inquiries.ts` | `list_inquiries` |
| `src/lib/mcp/tools/owner.ts` | `list_owner_directory`, `list_owner_links`, `add_owner_link`, `revoke_owner_link`, `clear_owner_link`, `refresh_owner_directory` |
| `src/lib/mcp/tools/data.ts` | `list_unresolved_data_mappings`, `set_location_data_mapping` |
| `src/lib/mcp/tools/market.ts` | `list_competitor_closures`, `list_alerts` |
| `src/lib/mcp/tools/connections.ts` | `list_mcp_connections`, `revoke_mcp_connection` |
| `src/app/api/mcp/route.ts` | POST (verify → 401/403 → dispatch), GET/DELETE → 405 |
| `test/helpers/mcp-harness.ts` | Loopback client↔handler pair used by every tool test |

**Modified**

| File | Change |
|---|---|
| `package.json` | three dependency additions |
| `src/lib/owner-directory/data.ts` | add session-free `queryOwnerDirectory` / `queryUsersWithLinks`; the guarded exports delegate |
| `src/lib/listings/load-listing.ts` | export session-free `queryAdminListing(id)`; `loadAdminListing` delegates |

**Tests created:** `src/__tests__/mcp/shared.test.ts`, `confirm.test.ts`, `server.test.ts`, `tools-overview.test.ts`, `tools-listings.test.ts`, `tools-users.test.ts`, `tools-brand-requests.test.ts`, `tools-owner.test.ts`, `tools-data.test.ts`, `tools-market.test.ts`, `tools-connections.test.ts`, `route.test.ts`, plus `src/__tests__/mcp/queries-*.test.ts`.

---

### Task 1: Dependencies and the shared tool toolkit

Everything every tool needs: pagination, the cursor codec, money shaping, result/error shaping, and the two wrappers (`readTool`, `writeTool`) that make each tool body ten lines. Nothing here touches the DB, so it is all pure-function testable.

**Files:**
- Modify: `package.json` (dependencies + devDependencies)
- Create: `src/lib/mcp/tools/_shared.ts`
- Test: `src/__tests__/mcp/shared.test.ts`

**Interfaces:**
- Consumes: `AdminActor` (`@/lib/admin/core/actor`), `recordMcpRead` (`@/lib/admin/audit`), `McpActor` (`@/lib/mcp/auth/verify-token`), `checkRateLimit` (`@/lib/rate-limit`), `formatUsdCents` (`@/lib/money`), `CallToolResult` + `ToolAnnotations` (`@modelcontextprotocol/server`).
- Produces:
  - `interface McpToolContext { actor: AdminActor; mcp: McpActor; canWrite: boolean }`
  - `function toolContext(mcp: McpActor): McpToolContext`
  - `const DEFAULT_LIMIT = 25`, `const MAX_LIMIT = 100`, `const WRITE_LIMIT_PER_MINUTE = 30`
  - zod fragments `limitField`, `cursorField`, `searchField`, `reasonField`, `notesField`, `confirmationField`
  - `function encodeCursor(payload: Record<string, unknown>): string`
  - `function decodeCursor(cursor: string | undefined): Record<string, unknown> | null`
  - `function paginateArray<T>(rows: T[], limit: number | undefined, cursor: string | undefined): { items: T[]; next_cursor: string | null }`
  - `function money(cents: number | null | undefined): { cents: number; formatted: string } | null`
  - `function toolResult(structured: Record<string, unknown>): CallToolResult`
  - `function toolError(message: string): CallToolResult`
  - `function isExpectedToolError(err: unknown): err is Error`
  - `function readTool(ctx, tool: string, args: Record<string, unknown>, run: () => Promise<Record<string, unknown>>): Promise<CallToolResult>`
  - `function writeTool(ctx, tool: string, args: Record<string, unknown>, run: () => Promise<Record<string, unknown>>): Promise<CallToolResult>`
  - `const READ_ANNOTATIONS`, `const WRITE_ANNOTATIONS`, `const DESTRUCTIVE_ANNOTATIONS`, `const REQUIRES_USER_INTERACTION`
  - `function deletedTarget(type: string, id: string): Record<string, unknown>`

- [ ] **Step 1: Add the dependencies**

Run from the repo root (`--legacy-peer-deps` is already the default via `.npmrc`, but pass it explicitly so the command is correct on a clean checkout):

```bash
npm install --legacy-peer-deps @modelcontextprotocol/server@^2 @modelcontextprotocol/core@^2
npm install --legacy-peer-deps -D @modelcontextprotocol/client@^2
```

Expected result in `package.json`: `"@modelcontextprotocol/core": "^2.0.0"` and `"@modelcontextprotocol/server": "^2.0.0"` under `dependencies`, `"@modelcontextprotocol/client": "^2.0.0"` under `devDependencies`. The repo is already on `zod@^4.3.6`, which satisfies the SDK's `zod@^4.2.0` dependency — no zod change is needed and none should be made.

- [ ] **Step 2: Verify the install resolved v2, not v1**

```bash
npm ls @modelcontextprotocol/server @modelcontextprotocol/core @modelcontextprotocol/client
```

Expected: all three at `2.0.0` (or a later `2.x`). If any resolved to a `1.x`, stop — the `^2` range was not honoured and the rest of this plan does not apply.

- [ ] **Step 3: Write the failing tests**

Create `src/__tests__/mcp/shared.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const { recordMcpRead, captureException } = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead }))
vi.mock("@sentry/nextjs", () => ({ captureException }))

import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  WRITE_LIMIT_PER_MINUTE,
  toolContext,
  encodeCursor,
  decodeCursor,
  paginateArray,
  money,
  toolResult,
  toolError,
  isExpectedToolError,
  readTool,
  writeTool,
  deletedTarget,
  READ_ANNOTATIONS,
  DESTRUCTIVE_ANNOTATIONS,
  REQUIRES_USER_INTERACTION,
} from "@/lib/mcp/tools/_shared"
import { __resetRateLimits } from "@/lib/rate-limit"

const MCP = {
  userId: "u-1",
  email: "admin@hellosugar.salon",
  scopes: ["marketplace:read", "marketplace:write"],
  clientId: "claude-code",
  tokenId: "tok-1",
}

describe("toolContext", () => {
  it("maps an McpActor onto an mcp-sourced AdminActor", () => {
    const ctx = toolContext(MCP)
    expect(ctx.actor).toEqual({
      userId: "u-1",
      source: "mcp",
      clientId: "claude-code",
      tokenId: "tok-1",
    })
    expect(ctx.canWrite).toBe(true)
  })

  it("is read-only when the token lacks marketplace:write", () => {
    expect(toolContext({ ...MCP, scopes: ["marketplace:read"] }).canWrite).toBe(false)
  })
})

describe("cursor codec", () => {
  it("round-trips a payload through an opaque string", () => {
    const c = encodeCursor({ o: 50 })
    expect(c).not.toContain("{")
    expect(c).not.toMatch(/[+/=]/) // base64url, not base64
    expect(decodeCursor(c)).toEqual({ o: 50 })
  })

  it("returns null for an absent cursor", () => {
    expect(decodeCursor(undefined)).toBeNull()
  })

  it("returns null rather than throwing for a garbage cursor", () => {
    expect(() => decodeCursor("not-a-cursor")).not.toThrow()
    expect(decodeCursor("not-a-cursor")).toBeNull()
  })
})

describe("paginateArray", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}` }))

  it("defaults to 25 items and hands back a cursor", () => {
    const page = paginateArray(rows, undefined, undefined)
    expect(page.items).toHaveLength(DEFAULT_LIMIT)
    expect(page.items[0].id).toBe("r0")
    expect(page.next_cursor).not.toBeNull()
  })

  it("resumes exactly where the previous page stopped", () => {
    const first = paginateArray(rows, 10, undefined)
    const second = paginateArray(rows, 10, first.next_cursor!)
    expect(second.items[0].id).toBe("r10")
  })

  it("ends with a null cursor on the last page", () => {
    const page = paginateArray(rows, 100, undefined)
    expect(page.items).toHaveLength(30)
    expect(page.next_cursor).toBeNull()
  })

  it("clamps a limit above the maximum", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}` }))
    expect(paginateArray(many, 1000, undefined).items).toHaveLength(MAX_LIMIT)
  })

  it("treats a garbage cursor as the first page", () => {
    expect(paginateArray(rows, 5, "garbage").items[0].id).toBe("r0")
  })
})

describe("money", () => {
  it("returns cents alongside the shared formatter's output", () => {
    expect(money(12345600)).toEqual({ cents: 12345600, formatted: "$123,456" })
  })

  it("returns null for a missing amount so callers omit the field", () => {
    expect(money(null)).toBeNull()
    expect(money(undefined)).toBeNull()
  })

  it("keeps zero as a real value, not a missing one", () => {
    expect(money(0)).toEqual({ cents: 0, formatted: "$0" })
  })
})

describe("toolResult / toolError", () => {
  it("emits compact JSON text plus structuredContent", () => {
    const r = toolResult({ ok: true, n: 1 })
    expect(r.structuredContent).toEqual({ ok: true, n: 1 })
    expect(r.content).toEqual([{ type: "text", text: '{"ok":true,"n":1}' }])
    expect(r.isError).toBeUndefined()
  })

  it("emits an isError result carrying the message in both channels", () => {
    const r = toolError("Cannot demote the last admin")
    expect(r.isError).toBe(true)
    expect(r.content).toEqual([{ type: "text", text: "Cannot demote the last admin" }])
    expect(r.structuredContent).toEqual({ error: "Cannot demote the last admin" })
  })
})

describe("isExpectedToolError", () => {
  it("accepts a plain Error — the convention core mutations throw", () => {
    expect(isExpectedToolError(new Error("Listing not found"))).toBe(true)
  })

  it("rejects an Error subclass, which signals a bug or infrastructure failure", () => {
    expect(isExpectedToolError(new TypeError("x is not a function"))).toBe(false)
    class NeonDbError extends Error {
      name = "NeonDbError"
    }
    expect(isExpectedToolError(new NeonDbError("connection terminated"))).toBe(false)
  })

  it("rejects a thrown non-Error", () => {
    expect(isExpectedToolError("boom")).toBe(false)
  })
})

describe("readTool", () => {
  beforeEach(() => {
    recordMcpRead.mockReset().mockResolvedValue("audit-1")
    captureException.mockReset()
  })

  it("audits the read and returns the payload", async () => {
    const r = await readTool(toolContext(MCP), "list_listings", { status: "pending" }, async () => ({
      items: [],
      next_cursor: null,
    }))
    expect(recordMcpRead).toHaveBeenCalledWith(toolContext(MCP).actor, "list_listings", {
      status: "pending",
    })
    expect(r.structuredContent).toEqual({ items: [], next_cursor: null })
  })

  it("surfaces a plain Error's message verbatim without Sentry", async () => {
    const r = await readTool(toolContext(MCP), "get_listing", {}, async () => {
      throw new Error("Listing not found")
    })
    expect(r.isError).toBe(true)
    expect(r.content[0]).toEqual({ type: "text", text: "Listing not found" })
    expect(captureException).not.toHaveBeenCalled()
  })

  it("sends an unexpected failure to Sentry and returns a reference", async () => {
    const r = await readTool(toolContext(MCP), "get_listing", {}, async () => {
      throw new TypeError("rows.map is not a function")
    })
    expect(captureException).toHaveBeenCalledTimes(1)
    const text = (r.content[0] as { text: string }).text
    expect(text).toMatch(/^Unexpected error \(ref [0-9a-f-]{36}\)$/)
    // The same reference is tagged on the Sentry event so an operator can find it.
    const ref = text.slice("Unexpected error (ref ".length, -1)
    expect(captureException.mock.calls[0][1]).toMatchObject({ tags: { mcp_ref: ref } })
  })

  it("never lets an audit-write failure block the read", async () => {
    recordMcpRead.mockRejectedValue(new Error("audit table unavailable"))
    const r = await readTool(toolContext(MCP), "list_users", {}, async () => ({ items: [] }))
    expect(r.isError).toBeUndefined()
    expect(r.structuredContent).toEqual({ items: [] })
  })
})

describe("writeTool", () => {
  beforeEach(() => {
    __resetRateLimits()
    captureException.mockReset()
  })

  it("returns the payload and does not write an mcp.read row", async () => {
    recordMcpRead.mockReset()
    const r = await writeTool(toolContext(MCP), "approve_listing", { listing_id: "l1" }, async () => ({
      audit_id: "a1",
      target: { id: "l1" },
    }))
    expect(r.structuredContent).toEqual({ audit_id: "a1", target: { id: "l1" } })
    expect(recordMcpRead).not.toHaveBeenCalled()
  })

  it("blocks the 31st write in a minute for the same token", async () => {
    const ctx = toolContext(MCP)
    for (let i = 0; i < WRITE_LIMIT_PER_MINUTE; i++) {
      const ok = await writeTool(ctx, "approve_listing", {}, async () => ({ audit_id: `a${i}` }))
      expect(ok.isError).toBeUndefined()
    }
    const blocked = await writeTool(ctx, "approve_listing", {}, async () => ({ audit_id: "a31" }))
    expect(blocked.isError).toBe(true)
    expect((blocked.content[0] as { text: string }).text).toMatch(/Too many write operations/)
  })

  it("keys the limit on the token, so another token is unaffected", async () => {
    const a = toolContext(MCP)
    for (let i = 0; i < WRITE_LIMIT_PER_MINUTE; i++) {
      await writeTool(a, "approve_listing", {}, async () => ({ audit_id: `a${i}` }))
    }
    const b = toolContext({ ...MCP, tokenId: "tok-2" })
    const r = await writeTool(b, "approve_listing", {}, async () => ({ audit_id: "b1" }))
    expect(r.isError).toBeUndefined()
  })
})

describe("annotation presets", () => {
  it("never claims an open world", () => {
    expect(READ_ANNOTATIONS.openWorldHint).toBe(false)
    expect(DESTRUCTIVE_ANNOTATIONS.openWorldHint).toBe(false)
  })

  it("marks reads read-only and destructive writes destructive", () => {
    expect(READ_ANNOTATIONS).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    expect(DESTRUCTIVE_ANNOTATIONS).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  })

  it("carries the Claude per-call interaction flag for destructive tools", () => {
    expect(REQUIRES_USER_INTERACTION).toEqual({ "anthropic/requiresUserInteraction": true })
  })
})

describe("deletedTarget", () => {
  it("describes a row that no longer exists", () => {
    expect(deletedTarget("user", "u-9")).toEqual({ type: "user", id: "u-9", deleted: true })
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

```
npx vitest run src/__tests__/mcp/shared.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/mcp/tools/_shared"`.

- [ ] **Step 5: Write the implementation**

Create `src/lib/mcp/tools/_shared.ts`:

```ts
// Shared toolkit for every MCP tool module.
//
// NOT a use server module. Every "use server" export is a public POST endpoint;
// these are plain functions imported by the MCP tool modules, which are reached
// only through the bearer-verified POST /api/mcp route handler.
//
// Deliberately NOT marked `import "server-only"`: tsx scripts crash on any
// transitive server-only import and vitest stubs it, so the guard would buy
// nothing here and could break a future script.
import { z } from "zod"
import * as Sentry from "@sentry/nextjs"
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server"
import type { AdminActor } from "@/lib/admin/core/actor"
import { recordMcpRead } from "@/lib/admin/audit"
import type { McpActor } from "@/lib/mcp/auth/verify-token"
import { checkRateLimit } from "@/lib/rate-limit"
import { formatUsdCents } from "@/lib/money"

/** Per-request identity threaded into every tool handler. */
export interface McpToolContext {
  /** The audit-log actor. Always `source: "mcp"`. */
  actor: AdminActor
  /** The verified token, kept for rate-limit keying and the connection tools. */
  mcp: McpActor
  /** Whether the token carries `marketplace:write`. Gates write-tool registration. */
  canWrite: boolean
}

export function toolContext(mcp: McpActor): McpToolContext {
  return {
    actor: { userId: mcp.userId, source: "mcp", clientId: mcp.clientId, tokenId: mcp.tokenId },
    mcp,
    canWrite: mcp.scopes.includes("marketplace:write"),
  }
}

export const DEFAULT_LIMIT = 25
export const MAX_LIMIT = 100
export const WRITE_LIMIT_PER_MINUTE = 30
const WRITE_WINDOW_MS = 60_000

/** Shared zod fragments so every tool spells the same constraint the same way. */
export const limitField = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .optional()
  .describe(`Maximum items to return (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`)

export const cursorField = z
  .string()
  .max(512)
  .optional()
  .describe("Opaque pagination cursor from a previous call's next_cursor. Omit for the first page.")

export const searchField = z
  .string()
  .max(200)
  .optional()
  .describe("Case-insensitive substring filter (max 200 characters).")

export const reasonField = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .describe("Reason shown to the affected user (max 2000 characters).")

export const notesField = z
  .string()
  .max(2000)
  .optional()
  .describe("Optional internal note appended to the reason (max 2000 characters).")

export const confirmationField = z
  .string()
  .max(4096)
  .optional()
  .describe(
    "Token from this tool's own preview response. Omit on the first call to receive a preview and a token; " +
      "pass it back UNCHANGED, with identical arguments, to execute.",
  )

/** Opaque, URL-safe cursor. Opaque on purpose: the shape is ours to change. */
export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

/**
 * Decode a cursor, or null when it is absent or unusable. Never throws: a client
 * that replays a stale or hand-edited cursor gets page one, not a 500.
 */
export function decodeCursor(cursor: string | undefined): Record<string, unknown> | null {
  if (!cursor) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Offset pagination over an already-materialized array. Used by the tools whose
 * source (a PR A core read) returns the whole set in one query — those reads are
 * the same ones the admin pages already run, so paging in memory is honest here.
 * DB-backed lists (audit log, activity, brand requests) use keyset cursors instead.
 */
export function paginateArray<T>(
  rows: T[],
  limit: number | undefined,
  cursor: string | undefined,
): { items: T[]; next_cursor: string | null } {
  const size = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const decoded = decodeCursor(cursor)
  const rawOffset = decoded && typeof decoded.o === "number" ? decoded.o : 0
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0
  const items = rows.slice(offset, offset + size)
  const nextOffset = offset + items.length
  return {
    items,
    next_cursor: nextOffset < rows.length ? encodeCursor({ o: nextOffset }) : null,
  }
}

/**
 * Every money field on the wire. Cents is the stored unit (see src/lib/money.ts);
 * `formatted` exists so the model never has to divide by 100 and get it wrong.
 */
export function money(
  cents: number | null | undefined,
): { cents: number; formatted: string } | null {
  if (cents === null || cents === undefined) return null
  return { cents, formatted: formatUsdCents(cents) }
}

/** Success: compact JSON in one text block, plus the same object as structuredContent. */
export function toolResult(structured: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured,
  }
}

/**
 * Failure the model can act on: an in-band `isError` result (NOT a JSON-RPC error),
 * carrying exactly the sentence the admin UI would have shown.
 */
export function toolError(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message },
    isError: true,
  }
}

/**
 * Whether a caught value is one of OUR refusals rather than a bug.
 *
 * Every PR A core mutation signals a refusal by throwing a plain `new Error(msg)`
 * carrying the same copy the UI shows. Driver and runtime failures throw Error
 * SUBCLASSES (`NeonDbError`, `TypeError`, `ZodError`), which set their own `name`.
 * That distinction is the whole rule — it keeps internal failures out of the
 * model's context while letting "Cannot demote the last admin" straight through.
 */
export function isExpectedToolError(err: unknown): err is Error {
  return err instanceof Error && err.name === "Error"
}

function mapThrown(tool: string, err: unknown): CallToolResult {
  if (isExpectedToolError(err)) return toolError(err.message)
  const ref = crypto.randomUUID()
  Sentry.captureException(err, { tags: { mcp_ref: ref, mcp_tool: tool } })
  return toolError(`Unexpected error (ref ${ref})`)
}

/**
 * Wrapper for every read tool: write the `mcp.read` audit row, run the read, shape
 * the result, map failures.
 *
 * The audit write is awaited but never fatal — auditing must not be able to take
 * the endpoint down (the same rule PR A applies inside `withAudit`).
 */
export async function readTool(
  ctx: McpToolContext,
  tool: string,
  args: Record<string, unknown>,
  run: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    await recordMcpRead(ctx.actor, tool, args).catch((err: unknown) => {
      Sentry.captureException(err, { tags: { mcp_tool: tool, mcp_stage: "read_audit" } })
    })
    return toolResult(await run())
  } catch (err) {
    return mapThrown(tool, err)
  }
}

/**
 * Wrapper for every write tool: per-token rate limit, run, shape, map failures.
 *
 * No `recordMcpRead` here — the PR A core function the write delegates to already
 * writes its own audit row through `withAudit` and hands back the id.
 *
 * The limiter is per-instance and in-memory (DEBT-028), so this throttles a hot
 * loop hitting one warm Vercel instance. It is a mitigation, not a guarantee.
 */
export async function writeTool(
  ctx: McpToolContext,
  tool: string,
  args: Record<string, unknown>,
  run: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  const limit = checkRateLimit(
    `mcp-write:${ctx.mcp.tokenId}`,
    WRITE_LIMIT_PER_MINUTE,
    WRITE_WINDOW_MS,
  )
  if (!limit.allowed) {
    const seconds = Math.ceil((limit.retryAfterMs ?? WRITE_WINDOW_MS) / 1000)
    return toolError(
      `Too many write operations on this connection (limit ${WRITE_LIMIT_PER_MINUTE} per minute). Retry in ${seconds}s.`,
    )
  }
  try {
    return toolResult(await run())
  } catch (err) {
    return mapThrown(tool, err)
  }
}

export const READ_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

/** Non-destructive write: changes state, but nothing is lost or irreversible. */
export const WRITE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}

/** Destructive write. Pair with REQUIRES_USER_INTERACTION and a confirmation token. */
export const DESTRUCTIVE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
}

/**
 * Tool `_meta` that makes Claude.ai prompt per call and Claude Code prompt even in
 * auto-accept modes. Verified to reach the wire: McpServer's tools/list handler
 * copies `_meta` straight onto the advertised tool.
 */
export const REQUIRES_USER_INTERACTION = { "anthropic/requiresUserInteraction": true } as const

/** The `target` for a write whose row is gone afterwards. */
export function deletedTarget(type: string, id: string): Record<string, unknown> {
  return { type, id, deleted: true }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```
npx vitest run src/__tests__/mcp/shared.test.ts
```

Expected: PASS (all cases).

- [ ] **Step 7: Type-check**

```
npx tsc --noEmit
```

Expected: no errors. (Do not run `next build` — a dev server may hold the `.next` lock on Windows.)

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/mcp/tools/_shared.ts src/__tests__/mcp/shared.test.ts
git commit -F- <<'MSG'
feat(mcp): MCP SDK v2 dependencies and shared tool toolkit

Adds @modelcontextprotocol/server + /core (runtime) and /client (dev), plus the
pagination, money, result-shaping, error-mapping and rate-limit helpers every
MCP tool module builds on.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 2: Stateless destructive-action confirmation tokens

Claude.ai web does not support elicitation, so the confirm step is a tool-level protocol instead: call the destructive tool once with no token to get a human preview plus a token, then call it again with the token to execute. The token is an HMAC over the exact arguments, so a token minted for "reject listing L1" cannot execute "reject listing L2", cannot be replayed by another admin, and expires after 10 minutes. Nothing is stored — there is no table and no cache to keep coherent across Vercel instances.

**Files:**
- Create: `src/lib/mcp/confirm.ts`
- Test: `src/__tests__/mcp/confirm.test.ts`

**Interfaces:**
- Consumes: `env.MCP_CONFIRM_SECRET` (`@/lib/env`, added in PR B, `z.string().min(32)`); `createHmac`, `timingSafeEqual` from `node:crypto`.
- Produces:
  - `const CONFIRMATION_TTL_SECONDS = 600`
  - `function canonicalJson(value: unknown): string`
  - `function createConfirmationToken(input: { tool: string; args: unknown; userId: string }): string`
  - `function verifyConfirmationToken(token: string, expected: { tool: string; args: unknown; userId: string }): { ok: true } | { ok: false; reason: "expired" | "mismatch" | "malformed" }`
  - `interface ConfirmationPrompt { preview: string; confirmation_token: string; expires_in: number }`
  - `function requireConfirmation(userId: string, tool: string, args: Record<string, unknown>, token: string | undefined, preview: string): ConfirmationPrompt | null`

  `requireConfirmation` is the only function the tool modules call. It returns a `ConfirmationPrompt` (which the tool returns verbatim, making no changes) when `token` is absent, `null` when the token is valid (so the tool proceeds), and **throws a plain `Error`** when the token is present but bad — which `writeTool` turns into an `isError` result carrying the message.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/mcp/confirm.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("server-only", () => ({}))

import {
  CONFIRMATION_TTL_SECONDS,
  canonicalJson,
  createConfirmationToken,
  verifyConfirmationToken,
  requireConfirmation,
} from "@/lib/mcp/confirm"

// env is a live process.env proxy under SKIP_ENV_VALIDATION (see src/lib/env.ts),
// so stubbing the raw variable is enough and needs no module reset.
beforeEach(() => {
  vi.stubEnv("MCP_CONFIRM_SECRET", "test-secret-at-least-32-characters-long")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe("canonicalJson", () => {
  it("orders object keys so argument order cannot change the signature", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it("orders keys recursively, including inside arrays", () => {
    expect(canonicalJson({ x: [{ z: 1, y: 2 }] })).toBe('{"x":[{"y":2,"z":1}]}')
  })

  it("preserves array ORDER — order is meaningful in a patch", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })

  it("drops undefined values so an explicitly-undefined key matches an absent one", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it("serialises null, numbers, booleans and strings as JSON does", () => {
    expect(canonicalJson({ a: null, b: 1.5, c: true, d: "x" })).toBe(
      '{"a":null,"b":1.5,"c":true,"d":"x"}',
    )
  })
})

describe("confirmation tokens", () => {
  const input = { tool: "reject_listing", args: { listing_id: "l1", reason: "Duplicate" }, userId: "u-1" }

  it("round-trips: a freshly minted token verifies", () => {
    const token = createConfirmationToken(input)
    expect(verifyConfirmationToken(token, input)).toEqual({ ok: true })
  })

  it("is shaped base64url-payload.hex-signature", () => {
    const [body, sig] = createConfirmationToken(input).split(".")
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })

  it("rejects a token minted for different arguments", () => {
    const token = createConfirmationToken(input)
    expect(
      verifyConfirmationToken(token, { ...input, args: { listing_id: "l2", reason: "Duplicate" } }),
    ).toEqual({ ok: false, reason: "mismatch" })
  })

  it("accepts the same arguments written in a different key order", () => {
    const token = createConfirmationToken(input)
    expect(
      verifyConfirmationToken(token, {
        ...input,
        args: { reason: "Duplicate", listing_id: "l1" },
      }),
    ).toEqual({ ok: true })
  })

  it("rejects a token minted for a different tool", () => {
    const token = createConfirmationToken(input)
    expect(verifyConfirmationToken(token, { ...input, tool: "mark_listing_sold" })).toEqual({
      ok: false,
      reason: "mismatch",
    })
  })

  it("rejects another admin replaying the token", () => {
    const token = createConfirmationToken(input)
    expect(verifyConfirmationToken(token, { ...input, userId: "u-2" })).toEqual({
      ok: false,
      reason: "mismatch",
    })
  })

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = createConfirmationToken(input)
    const [body, sig] = token.split(".")
    const forged = Buffer.from(
      JSON.stringify({ tool: "reject_listing", args: { listing_id: "l2" }, userId: "u-1", exp: 9e9 }),
    ).toString("base64url")
    expect(verifyConfirmationToken(`${forged}.${sig}`, input)).toEqual({
      ok: false,
      reason: "mismatch",
    })
    expect(body).not.toBe(forged)
  })

  it("rejects a token signed with a different secret", () => {
    const token = createConfirmationToken(input)
    vi.stubEnv("MCP_CONFIRM_SECRET", "a-completely-different-secret-32-chars")
    expect(verifyConfirmationToken(token, input)).toEqual({ ok: false, reason: "mismatch" })
  })

  it("expires exactly 600 seconds after minting", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"))
    const token = createConfirmationToken(input)

    vi.setSystemTime(new Date("2026-09-14T12:09:59.000Z"))
    expect(verifyConfirmationToken(token, input)).toEqual({ ok: true })

    vi.setSystemTime(new Date("2026-09-14T12:10:01.000Z"))
    expect(verifyConfirmationToken(token, input)).toEqual({ ok: false, reason: "expired" })
    expect(CONFIRMATION_TTL_SECONDS).toBe(600)
  })

  it("reports a structurally broken token as malformed, not as a crash", () => {
    for (const bad of ["", "nodot", "a.b.c", "!!!.aaaa"]) {
      expect(() => verifyConfirmationToken(bad, input)).not.toThrow()
      expect(verifyConfirmationToken(bad, input).ok).toBe(false)
    }
    expect(verifyConfirmationToken("nodot", input)).toEqual({ ok: false, reason: "malformed" })
  })

  it("reports a correctly-signed but non-JSON payload as malformed", () => {
    // Sign arbitrary bytes with the real secret so the signature check passes.
    const { createHmac } = require("node:crypto") as typeof import("node:crypto")
    const body = Buffer.from("not json at all").toString("base64url")
    const sig = createHmac("sha256", "test-secret-at-least-32-characters-long").update(body).digest("hex")
    expect(verifyConfirmationToken(`${body}.${sig}`, input)).toEqual({
      ok: false,
      reason: "malformed",
    })
  })
})

describe("requireConfirmation", () => {
  const args = { listing_id: "l1", reason: "Duplicate" }

  it("returns a preview and a usable token when none was supplied", () => {
    const prompt = requireConfirmation("u-1", "reject_listing", args, undefined, 'Reject listing "Aspen".')
    expect(prompt).not.toBeNull()
    expect(prompt!.preview).toBe('Reject listing "Aspen".')
    expect(prompt!.expires_in).toBe(600)
    expect(
      verifyConfirmationToken(prompt!.confirmation_token, {
        tool: "reject_listing",
        args,
        userId: "u-1",
      }),
    ).toEqual({ ok: true })
  })

  it("returns null — proceed — for a matching token", () => {
    const prompt = requireConfirmation("u-1", "reject_listing", args, undefined, "preview")!
    expect(
      requireConfirmation("u-1", "reject_listing", args, prompt.confirmation_token, "preview"),
    ).toBeNull()
  })

  it("throws an actionable message when the arguments changed", () => {
    const prompt = requireConfirmation("u-1", "reject_listing", args, undefined, "preview")!
    expect(() =>
      requireConfirmation(
        "u-1",
        "reject_listing",
        { ...args, reason: "Something else" },
        prompt.confirmation_token,
        "preview",
      ),
    ).toThrow(
      "Confirmation token does not match these arguments. Call reject_listing again without confirmation_token to get a fresh preview.",
    )
  })

  it("throws a plain Error so writeTool surfaces the message verbatim", () => {
    try {
      requireConfirmation("u-1", "reject_listing", args, "garbage", "preview")
      throw new Error("should have thrown")
    } catch (err) {
      expect((err as Error).name).toBe("Error")
      expect((err as Error).message).toMatch(/^Confirmation token is malformed\./)
    }
  })

  it("throws an expiry-specific message once the token is stale", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"))
    const prompt = requireConfirmation("u-1", "reject_listing", args, undefined, "preview")!
    vi.setSystemTime(new Date("2026-09-14T12:20:00.000Z"))
    expect(() =>
      requireConfirmation("u-1", "reject_listing", args, prompt.confirmation_token, "preview"),
    ).toThrow(/^Confirmation token expired\./)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```
npx vitest run src/__tests__/mcp/confirm.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/mcp/confirm"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/mcp/confirm.ts`:

```ts
// Two-step confirmation for destructive MCP tools.
//
// NOT a use server module.
//
// Why a token and not elicitation: Claude.ai web does not support elicitation, so
// the confirm step has to live in the tool contract itself. A destructive tool
// called WITHOUT `confirmation_token` runs its pre-checks, changes nothing, and
// returns a human preview plus a token. The same tool called WITH that token
// executes — but only if the tool name, the arguments and the acting admin are
// byte-identical to what was previewed, and only within CONFIRMATION_TTL_SECONDS.
//
// Stateless on purpose: there is no table and no cache, so this works unchanged
// across Vercel instances and cold starts. The integrity guarantee is the HMAC.
import { createHmac, timingSafeEqual } from "node:crypto"
import { env } from "@/lib/env"

/** How long a preview stays executable. Mirrored in the tool's `expires_in`. */
export const CONFIRMATION_TTL_SECONDS = 600

/**
 * Deterministic JSON: object keys sorted recursively, array ORDER preserved,
 * `undefined` dropped.
 *
 * This is what makes the signature argument-order-independent. `{reason, id}` and
 * `{id, reason}` are the same call, and a client that re-serialises the arguments
 * between the preview and the execute call must still be able to use its token.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue
      out[key] = canonicalize(source[key])
    }
    return out
  }
  return value
}

interface ConfirmationPayload {
  tool: string
  args: unknown
  userId: string
  /** Unix seconds. */
  exp: number
}

function sign(body: string): string {
  return createHmac("sha256", env.MCP_CONFIRM_SECRET).update(body).digest("hex")
}

/** `base64url(canonicalJson(payload))` + "." + `hex(HMAC-SHA256(body))`. */
export function createConfirmationToken(input: {
  tool: string
  args: unknown
  userId: string
}): string {
  const payload: ConfirmationPayload = {
    tool: input.tool,
    args: input.args,
    userId: input.userId,
    exp: Math.floor(Date.now() / 1000) + CONFIRMATION_TTL_SECONDS,
  }
  const body = Buffer.from(canonicalJson(payload), "utf8").toString("base64url")
  return `${body}.${sign(body)}`
}

export function verifyConfirmationToken(
  token: string,
  expected: { tool: string; args: unknown; userId: string },
): { ok: true } | { ok: false; reason: "expired" | "mismatch" | "malformed" } {
  const parts = token.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" }
  const [body, providedSig] = parts

  // Signature first: never parse attacker-controlled bytes we have not authenticated.
  const expectedSig = sign(body)
  // timingSafeEqual throws on unequal lengths, so length is checked up front — a
  // length difference is not secret (the digest length is fixed and public).
  if (providedSig.length !== expectedSig.length) return { ok: false, reason: "mismatch" }
  if (!timingSafeEqual(Buffer.from(providedSig, "utf8"), Buffer.from(expectedSig, "utf8"))) {
    return { ok: false, reason: "mismatch" }
  }

  let payload: ConfirmationPayload
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as ConfirmationPayload).tool !== "string" ||
      typeof (parsed as ConfirmationPayload).userId !== "string" ||
      typeof (parsed as ConfirmationPayload).exp !== "number"
    ) {
      return { ok: false, reason: "malformed" }
    }
    payload = parsed as ConfirmationPayload
  } catch {
    return { ok: false, reason: "malformed" }
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" }

  // Compare the whole authorised triple in one canonical string — cheaper to read
  // than three comparisons and impossible to forget a field when one is added.
  const signed = canonicalJson({ tool: payload.tool, args: payload.args, userId: payload.userId })
  const asked = canonicalJson({ tool: expected.tool, args: expected.args, userId: expected.userId })
  if (signed !== asked) return { ok: false, reason: "mismatch" }

  return { ok: true }
}

/** What a destructive tool returns when it has changed nothing and wants a confirm. */
export interface ConfirmationPrompt {
  preview: string
  confirmation_token: string
  expires_in: number
}

const RETRY = (tool: string) =>
  `Call ${tool} again without confirmation_token to get a fresh preview.`

/**
 * The single entry point every destructive tool uses.
 *
 * - No token  -> returns a ConfirmationPrompt. The tool returns it verbatim and
 *                makes NO changes.
 * - Good token -> returns null. The tool proceeds.
 * - Bad token  -> throws a plain Error, which `writeTool` surfaces as an
 *                `isError` result carrying the message verbatim.
 *
 * `args` MUST already have `confirmation_token` stripped — it is not part of what
 * is signed, or the token could never match the call that carries it.
 */
export function requireConfirmation(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  token: string | undefined,
  preview: string,
): ConfirmationPrompt | null {
  if (!token) {
    return {
      preview,
      confirmation_token: createConfirmationToken({ tool, args, userId }),
      expires_in: CONFIRMATION_TTL_SECONDS,
    }
  }

  const verdict = verifyConfirmationToken(token, { tool, args, userId })
  if (verdict.ok) return null

  switch (verdict.reason) {
    case "expired":
      throw new Error(`Confirmation token expired. ${RETRY(tool)}`)
    case "malformed":
      throw new Error(`Confirmation token is malformed. ${RETRY(tool)}`)
    default:
      throw new Error(`Confirmation token does not match these arguments. ${RETRY(tool)}`)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```
npx vitest run src/__tests__/mcp/confirm.test.ts
```

Expected: PASS (all cases).

- [ ] **Step 5: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/confirm.ts src/__tests__/mcp/confirm.test.ts
git commit -F- <<'MSG'
feat(mcp): stateless HMAC confirmation tokens for destructive tools

Preview-then-execute for destructive MCP tools without elicitation, which
Claude.ai web does not support. A token binds the tool name, the canonicalised
arguments and the acting admin for 10 minutes; changing any of them, or another
admin replaying it, invalidates it. No table, no cache.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 3: Overview and audit-log queries

Two read modules the MCP needs that no existing module provides: the marketplace headline counts (spec §7.3's `get_marketplace_overview`) and a filterable, keyset-paged view of `admin_audit_log` (spec §7.3's `list_audit_log`). Both are plain DB modules with no MCP types in them, so they are unit-testable against a mocked Drizzle without booting a server.

**Files:**
- Create: `src/lib/mcp/queries/overview.ts`
- Create: `src/lib/mcp/queries/audit.ts`
- Test: `src/__tests__/mcp/queries-overview.test.ts`
- Test: `src/__tests__/mcp/queries-audit.test.ts`

**Interfaces:**
- Consumes: `db` (`@/db`); `listings` (`@/db/schema/listings`); `users`, `allowlist` (`@/db/schema/auth`); `brandRequests` (`@/db/schema/brandRequests`); `contacts` (`@/db/schema/contacts`); `loginEvents` (`@/db/schema/loginEvents`); `adminAuditLog` (`@/db/schema/adminAuditLog`, PR A); `getAnalyticsSummary` (`@/lib/admin/core/analytics`, PR A); `encodeCursor` / `decodeCursor` (`@/lib/mcp/tools/_shared`).
- Produces:
  - `interface MarketplaceOverview { listings: { total: number; by_status: Record<string, number> }; pending_queue: number; brand_requests: { open: number; by_status: Record<string, number> }; users: { total: number; admins: number; seller_access: number; allowlist_entries: number }; engagement: { inquiries_7d: number; inquiries_30d: number; logins_7d: number; logins_30d: number; active_users_7d: number } }`
  - `function marketplaceOverview(): Promise<MarketplaceOverview>`
  - `interface AuditLogEntry { id: string; at: string; action: string; source: string; actor: { id: string | null; name: string | null; email: string | null }; client_id: string | null; target: { type: string | null; id: string | null }; outcome: string; error: string | null; duration_ms: number | null; args: unknown }`
  - `interface AuditLogFilters { actorUserId?: string; action?: string; targetType?: string; targetId?: string; source?: "ui" | "mcp"; since?: Date; includeReads?: boolean; limit: number; cursor?: string }`
  - `function listAuditLog(filters: AuditLogFilters): Promise<{ items: AuditLogEntry[]; next_cursor: string | null }>`

- [ ] **Step 1: Write the failing overview test**

Create `src/__tests__/mcp/queries-overview.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

const { select, getAnalyticsSummary } = vi.hoisted(() => ({
  select: vi.fn(),
  getAnalyticsSummary: vi.fn(),
}))

vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }))
vi.mock("@/lib/admin/core/analytics", () => ({ getAnalyticsSummary }))

import { marketplaceOverview } from "@/lib/mcp/queries/overview"

describe("marketplaceOverview", () => {
  beforeEach(() => {
    select.mockReset()
    getAnalyticsSummary.mockReset().mockResolvedValue({
      totalUsers: 42,
      activeThisWeek: 7,
      logins30d: 120,
      inquiries30d: 9,
    })
    // Call order must match the Promise.all array in the implementation:
    // 1 listings-by-status, 2 brand-requests-by-status, 3 admins, 4 seller access,
    // 5 allowlist, 6 inquiries 7d, 7 logins 7d.
    select
      .mockReturnValueOnce(
        builder([
          { status: "active", n: 12 },
          { status: "pending", n: 3 },
          { status: "draft", n: 5 },
        ]),
      )
      .mockReturnValueOnce(
        builder([
          { status: "submitted", n: 2 },
          { status: "rejected", n: 4 },
          { status: "live", n: 1 },
        ]),
      )
      .mockReturnValueOnce(builder([{ n: 2 }]))
      .mockReturnValueOnce(builder([{ n: 6 }]))
      .mockReturnValueOnce(builder([{ n: 11 }]))
      .mockReturnValueOnce(builder([{ n: 4 }]))
      .mockReturnValueOnce(builder([{ n: 31 }]))
  })

  it("totals listings and keeps the per-status breakdown", async () => {
    const o = await marketplaceOverview()
    expect(o.listings.total).toBe(20)
    expect(o.listings.by_status).toEqual({ active: 12, pending: 3, draft: 5 })
  })

  it("surfaces the pending approval queue as its own number", async () => {
    expect((await marketplaceOverview()).pending_queue).toBe(3)
  })

  it("counts only undecided brand requests as open", async () => {
    // rejected and live are decided; submitted is not.
    const o = await marketplaceOverview()
    expect(o.brand_requests.open).toBe(2)
    expect(o.brand_requests.by_status).toEqual({ submitted: 2, rejected: 4, live: 1 })
  })

  it("reuses getAnalyticsSummary rather than recounting users and 30d activity", async () => {
    const o = await marketplaceOverview()
    expect(getAnalyticsSummary).toHaveBeenCalledTimes(1)
    expect(o.users.total).toBe(42)
    expect(o.engagement.active_users_7d).toBe(7)
    expect(o.engagement.logins_30d).toBe(120)
    expect(o.engagement.inquiries_30d).toBe(9)
  })

  it("adds the counts the analytics summary does not carry", async () => {
    const o = await marketplaceOverview()
    expect(o.users).toMatchObject({ admins: 2, seller_access: 6, allowlist_entries: 11 })
    expect(o.engagement).toMatchObject({ inquiries_7d: 4, logins_7d: 31 })
  })

  it("reports zeroes rather than throwing when a count comes back empty", async () => {
    select.mockReset()
    select
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
    const o = await marketplaceOverview()
    expect(o.listings).toEqual({ total: 0, by_status: {} })
    expect(o.brand_requests).toEqual({ open: 0, by_status: {} })
    expect(o.users.admins).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```
npx vitest run src/__tests__/mcp/queries-overview.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/mcp/queries/overview"`.

- [ ] **Step 3: Write the overview implementation**

Create `src/lib/mcp/queries/overview.ts`:

```ts
// Headline marketplace counts for the MCP `get_marketplace_overview` tool.
//
// NOT a use server module.
//
// Deliberately additive to PR A's getAnalyticsSummary rather than a replacement:
// that function is the admin analytics page's own source of truth for user and
// 30-day activity numbers, and the MCP must not be able to report a different
// figure than the page does. Only the numbers it does NOT carry are counted here.
import { count, eq, gte } from "drizzle-orm"
import { db } from "@/db"
import { listings } from "@/db/schema/listings"
import { users, allowlist } from "@/db/schema/auth"
import { brandRequests } from "@/db/schema/brandRequests"
import { contacts } from "@/db/schema/contacts"
import { loginEvents } from "@/db/schema/loginEvents"
import { getAnalyticsSummary } from "@/lib/admin/core/analytics"

/** Brand-request statuses that represent a decision already taken. */
const DECIDED_BRAND_REQUEST_STATUSES = ["approved", "building", "live", "rejected"] as const

export interface MarketplaceOverview {
  listings: { total: number; by_status: Record<string, number> }
  pending_queue: number
  brand_requests: { open: number; by_status: Record<string, number> }
  users: { total: number; admins: number; seller_access: number; allowlist_entries: number }
  engagement: {
    inquiries_7d: number
    inquiries_30d: number
    logins_7d: number
    logins_30d: number
    active_users_7d: number
  }
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

function tally(rows: { status: string | null; n: number }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    if (row.status) out[row.status] = row.n
  }
  return out
}

function scalar(rows: { n: number }[]): number {
  return rows[0]?.n ?? 0
}

export async function marketplaceOverview(): Promise<MarketplaceOverview> {
  const week = daysAgo(7)

  // The Promise.all order is load-bearing for the unit test's sequential mock:
  // keep new counts at the END of the array.
  const [
    summary,
    listingRows,
    brandRequestRows,
    adminRows,
    sellerRows,
    allowlistRows,
    inquiries7dRows,
    logins7dRows,
  ] = await Promise.all([
    getAnalyticsSummary(),
    db
      .select({ status: listings.status, n: count() })
      .from(listings)
      .groupBy(listings.status),
    db
      .select({ status: brandRequests.status, n: count() })
      .from(brandRequests)
      .groupBy(brandRequests.status),
    db.select({ n: count() }).from(users).where(eq(users.role, "admin")),
    db.select({ n: count() }).from(users).where(eq(users.sellerAccess, true)),
    db.select({ n: count() }).from(allowlist),
    db.select({ n: count() }).from(contacts).where(gte(contacts.createdAt, week)),
    db.select({ n: count() }).from(loginEvents).where(gte(loginEvents.createdAt, week)),
  ])

  const byStatus = tally(listingRows as { status: string | null; n: number }[])
  const brandByStatus = tally(brandRequestRows as { status: string | null; n: number }[])

  const open = Object.entries(brandByStatus)
    .filter(([status]) => !DECIDED_BRAND_REQUEST_STATUSES.includes(status as never))
    .reduce((sum, [, n]) => sum + n, 0)

  return {
    listings: {
      total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      by_status: byStatus,
    },
    pending_queue: byStatus.pending ?? 0,
    brand_requests: { open, by_status: brandByStatus },
    users: {
      total: summary.totalUsers,
      admins: scalar(adminRows as { n: number }[]),
      seller_access: scalar(sellerRows as { n: number }[]),
      allowlist_entries: scalar(allowlistRows as { n: number }[]),
    },
    engagement: {
      inquiries_7d: scalar(inquiries7dRows as { n: number }[]),
      inquiries_30d: summary.inquiries30d,
      logins_7d: scalar(logins7dRows as { n: number }[]),
      logins_30d: summary.logins30d,
      active_users_7d: summary.activeThisWeek,
    },
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

```
npx vitest run src/__tests__/mcp/queries-overview.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing audit-log test**

Create `src/__tests__/mcp/queries-audit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

const { select } = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }))

import { listAuditLog } from "@/lib/mcp/queries/audit"
import { decodeCursor } from "@/lib/mcp/tools/_shared"

function row(id: string, at: string) {
  return {
    id,
    createdAt: new Date(at),
    action: "listing.approve",
    source: "mcp",
    mcpClientId: "claude-code",
    actorUserId: "u-1",
    actorName: "Parker",
    actorEmail: "parker@hellosugar.salon",
    targetType: "listing",
    targetId: "l-1",
    outcome: "ok",
    error: null,
    durationMs: 84,
    args: { listing_id: "l-1" },
  }
}

describe("listAuditLog", () => {
  let b: ChainedBuilder

  beforeEach(() => {
    select.mockReset()
    b = builder([row("a1", "2026-09-14T12:00:00.000Z"), row("a2", "2026-09-14T11:00:00.000Z")])
    select.mockReturnValue(b)
  })

  it("serialises a row into the wire shape", async () => {
    const page = await listAuditLog({ limit: 25 })
    expect(page.items[0]).toEqual({
      id: "a1",
      at: "2026-09-14T12:00:00.000Z",
      action: "listing.approve",
      source: "mcp",
      actor: { id: "u-1", name: "Parker", email: "parker@hellosugar.salon" },
      client_id: "claude-code",
      target: { type: "listing", id: "l-1" },
      outcome: "ok",
      error: null,
      duration_ms: 84,
      args: { listing_id: "l-1" },
    })
  })

  it("asks for one more row than the limit so it knows whether a page follows", async () => {
    await listAuditLog({ limit: 25 })
    expect(b.calls.limit[0][0]).toBe(26)
  })

  it("returns a null cursor when the fetched rows fit in the page", async () => {
    expect((await listAuditLog({ limit: 25 })).next_cursor).toBeNull()
  })

  it("trims the sentinel row and emits a keyset cursor when more remain", async () => {
    select.mockReturnValue(
      builder([
        row("a1", "2026-09-14T12:00:00.000Z"),
        row("a2", "2026-09-14T11:00:00.000Z"),
        row("a3", "2026-09-14T10:00:00.000Z"),
      ]),
    )
    const page = await listAuditLog({ limit: 2 })
    expect(page.items.map((i) => i.id)).toEqual(["a1", "a2"])
    expect(decodeCursor(page.next_cursor!)).toEqual({ at: "2026-09-14T11:00:00.000Z", id: "a2" })
  })

  it("excludes mcp.read rows by default and includes them on request", async () => {
    await listAuditLog({ limit: 25 })
    const defaultWhere = JSON.stringify(b.calls.where[0][0] ?? null)
    b = builder([])
    select.mockReturnValue(b)
    await listAuditLog({ limit: 25, includeReads: true })
    const inclusiveWhere = JSON.stringify(b.calls.where[0][0] ?? null)
    // Not asserting SQL internals — only that the two calls build different predicates,
    // which is the observable contract of the flag.
    expect(defaultWhere).not.toBe(inclusiveWhere)
  })

  it("orders newest first so the cursor walks backwards in time", async () => {
    await listAuditLog({ limit: 25 })
    expect(b.calls.orderBy[0]).toHaveLength(2)
  })

  it("applies a garbage cursor as no cursor rather than throwing", async () => {
    await expect(listAuditLog({ limit: 25, cursor: "###" })).resolves.toBeDefined()
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

```
npx vitest run src/__tests__/mcp/queries-audit.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/mcp/queries/audit"`.

- [ ] **Step 7: Write the audit-log implementation**

Create `src/lib/mcp/queries/audit.ts`:

```ts
// Filterable, keyset-paged read of admin_audit_log for the MCP `list_audit_log` tool.
//
// NOT a use server module.
//
// Keyset, not offset: the table only ever grows at the head, so an offset page 2
// would silently skip rows written between the two calls. The cursor is
// (created_at, id) — id breaks ties within the same millisecond.
import { and, desc, eq, gte, lt, ne, or, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { adminAuditLog } from "@/db/schema/adminAuditLog"
import { users } from "@/db/schema/auth"
import { encodeCursor, decodeCursor } from "@/lib/mcp/tools/_shared"

export interface AuditLogEntry {
  id: string
  /** ISO 8601. */
  at: string
  action: string
  source: string
  actor: { id: string | null; name: string | null; email: string | null }
  client_id: string | null
  target: { type: string | null; id: string | null }
  outcome: string
  error: string | null
  duration_ms: number | null
  args: unknown
}

export interface AuditLogFilters {
  actorUserId?: string
  action?: string
  targetType?: string
  targetId?: string
  source?: "ui" | "mcp"
  since?: Date
  /**
   * `mcp.read` rows are excluded by default: an MCP session writes one per read,
   * so leaving them in would bury the mutations an admin is actually looking for.
   */
  includeReads?: boolean
  limit: number
  cursor?: string
}

export async function listAuditLog(
  filters: AuditLogFilters,
): Promise<{ items: AuditLogEntry[]; next_cursor: string | null }> {
  const conditions: SQL[] = []

  if (!filters.includeReads) conditions.push(ne(adminAuditLog.action, "mcp.read"))
  if (filters.actorUserId) conditions.push(eq(adminAuditLog.actorUserId, filters.actorUserId))
  if (filters.action) conditions.push(eq(adminAuditLog.action, filters.action))
  if (filters.targetType) conditions.push(eq(adminAuditLog.targetType, filters.targetType))
  if (filters.targetId) conditions.push(eq(adminAuditLog.targetId, filters.targetId))
  if (filters.source) conditions.push(eq(adminAuditLog.source, filters.source))
  if (filters.since) conditions.push(gte(adminAuditLog.createdAt, filters.since))

  const cursor = decodeCursor(filters.cursor)
  if (cursor && typeof cursor.at === "string" && typeof cursor.id === "string") {
    const at = new Date(cursor.at)
    if (!Number.isNaN(at.getTime())) {
      const keyset = or(
        lt(adminAuditLog.createdAt, at),
        and(eq(adminAuditLog.createdAt, at), lt(adminAuditLog.id, cursor.id)),
      )
      if (keyset) conditions.push(keyset)
    }
  }

  // Fetch one extra row: its presence is how we know another page exists without
  // paying for a second COUNT query.
  const rows = await db
    .select({
      id: adminAuditLog.id,
      createdAt: adminAuditLog.createdAt,
      action: adminAuditLog.action,
      source: adminAuditLog.source,
      mcpClientId: adminAuditLog.mcpClientId,
      actorUserId: adminAuditLog.actorUserId,
      actorName: users.name,
      actorEmail: users.email,
      targetType: adminAuditLog.targetType,
      targetId: adminAuditLog.targetId,
      outcome: adminAuditLog.outcome,
      error: adminAuditLog.error,
      durationMs: adminAuditLog.durationMs,
      args: adminAuditLog.args,
    })
    .from(adminAuditLog)
    .leftJoin(users, eq(users.id, adminAuditLog.actorUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
    .limit(filters.limit + 1)

  const hasMore = rows.length > filters.limit
  const page = hasMore ? rows.slice(0, filters.limit) : rows
  const last = page[page.length - 1]

  return {
    items: page.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      action: r.action,
      source: r.source,
      actor: { id: r.actorUserId, name: r.actorName, email: r.actorEmail },
      client_id: r.mcpClientId,
      target: { type: r.targetType, id: r.targetId },
      outcome: r.outcome,
      error: r.error,
      duration_ms: r.durationMs,
      args: r.args,
    })),
    next_cursor:
      hasMore && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null,
  }
}
```

- [ ] **Step 8: Run both query tests to verify they pass**

```
npx vitest run src/__tests__/mcp/queries-overview.test.ts src/__tests__/mcp/queries-audit.test.ts
```

Expected: PASS.

- [ ] **Step 9: Type-check and lint**

```
npx tsc --noEmit
npx eslint src/lib/mcp
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/mcp/queries src/__tests__/mcp/queries-overview.test.ts src/__tests__/mcp/queries-audit.test.ts
git commit -F- <<'MSG'
feat(mcp): marketplace overview and audit-log read queries

marketplaceOverview() adds the counts getAnalyticsSummary does not carry rather
than recounting them, so the MCP and the analytics page can never disagree.
listAuditLog() pages admin_audit_log by keyset and hides mcp.read rows by default.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 4: Server assembly, the loopback test harness, and the overview tools

The first end-to-end slice. `buildMcpServer(actor)` constructs a fresh `McpServer` and calls each domain's `register…Tools(server, ctx)`; `createMcpRequestHandler(actor)` wraps it in the SDK's web-standard handler with the exact options production uses. The test harness drives that same handler in-process through a real `Client`, so every later tool task gets `tools/list` and `tools/call` coverage for free.

**Files:**
- Create: `src/lib/mcp/server.ts`
- Create: `src/lib/mcp/tools/overview.ts`
- Create: `test/helpers/mcp-harness.ts`
- Test: `src/__tests__/mcp/server.test.ts`
- Test: `src/__tests__/mcp/tools-overview.test.ts`

**Interfaces:**
- Consumes: `McpServer`, `createMcpHandler`, `type McpHttpHandler` (`@modelcontextprotocol/server`); `Client`, `StreamableHTTPClientTransport` (`@modelcontextprotocol/client`); `McpActor` (`@/lib/mcp/auth/verify-token`); everything from `_shared.ts`; `getRecentActivity`, `ActivityKind` (`@/lib/admin/activity`); `marketplaceOverview` (`@/lib/mcp/queries/overview`); `listAuditLog` (`@/lib/mcp/queries/audit`).
- Produces:
  - `const MCP_SERVER_NAME = "hs-marketplace-mcp-server"`, `const MCP_SERVER_TITLE`, `const MCP_SERVER_VERSION = "1.0.0"`
  - `const WRITE_TOOL_NAMES: ReadonlySet<string>` — every name in spec §7.4
  - `function buildMcpServer(actor: McpActor): McpServer`
  - `function createMcpRequestHandler(actor: McpActor): McpHttpHandler`
  - `function registerOverviewTools(server: McpServer, ctx: McpToolContext): void`
  - `function mcpTestClient(actor?: Partial<McpActor>): Promise<{ client: Client; close: () => Promise<void> }>` (test helper)

- [ ] **Step 1: Write the failing server test**

Create `src/__tests__/mcp/server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const { recordMcpRead, marketplaceOverview, getRecentActivity, listAuditLog } = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  marketplaceOverview: vi.fn(),
  getRecentActivity: vi.fn(),
  listAuditLog: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead }))
vi.mock("@/lib/mcp/queries/overview", () => ({ marketplaceOverview }))
vi.mock("@/lib/mcp/queries/audit", () => ({ listAuditLog }))
vi.mock("@/lib/admin/activity", () => ({ getRecentActivity }))

import { mcpTestClient } from "../../../test/helpers/mcp-harness"
import {
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  WRITE_TOOL_NAMES,
  buildMcpServer,
} from "@/lib/mcp/server"

beforeEach(() => {
  recordMcpRead.mockReset().mockResolvedValue("audit-1")
  marketplaceOverview.mockReset().mockResolvedValue({ listings: { total: 0, by_status: {} } })
  getRecentActivity.mockReset().mockResolvedValue({ items: [], nextCursor: null })
  listAuditLog.mockReset().mockResolvedValue({ items: [], next_cursor: null })
})

describe("buildMcpServer", () => {
  it("returns a fresh instance per call — never a shared one", () => {
    const actor = {
      userId: "u-1",
      email: null,
      scopes: ["marketplace:read"],
      clientId: "claude-code",
      tokenId: "t1",
    }
    expect(buildMcpServer(actor)).not.toBe(buildMcpServer(actor))
  })
})

describe("server identity", () => {
  it("announces itself with the house naming convention", async () => {
    expect(MCP_SERVER_NAME).toBe("hs-marketplace-mcp-server")
    expect(MCP_SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe("tools/list scope filtering", () => {
  it("advertises the read tools to a read-only token", async () => {
    const { client, close } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain("get_marketplace_overview")
    expect(names).toContain("list_recent_activity")
    expect(names).toContain("list_audit_log")
    await close()
  })

  it("advertises no tool that is in the write set to a read-only token", async () => {
    const { client, close } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name)
    for (const write of WRITE_TOOL_NAMES) expect(names).not.toContain(write)
    await close()
  })

  it("marks every advertised tool closed-world", async () => {
    const { client, close } = await mcpTestClient()
    for (const tool of (await client.listTools()).tools) {
      expect(tool.annotations?.openWorldHint).toBe(false)
    }
    await close()
  })

  it("gives every advertised tool a title, a description and an input schema", async () => {
    const { client, close } = await mcpTestClient()
    for (const tool of (await client.listTools()).tools) {
      expect(tool.title, tool.name).toBeTruthy()
      expect(tool.description, tool.name).toBeTruthy()
      expect(tool.inputSchema, tool.name).toBeTruthy()
    }
    await close()
  })
})

describe("tools/call transport round trip", () => {
  it("returns structuredContent through a real client", async () => {
    marketplaceOverview.mockResolvedValue({ listings: { total: 3, by_status: { active: 3 } } })
    const { client, close } = await mcpTestClient()
    const result = await client.callTool({ name: "get_marketplace_overview", arguments: {} })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({ listings: { total: 3, by_status: { active: 3 } } })
    await close()
  })

  it("rejects an out-of-range limit before the handler runs", async () => {
    const { client, close } = await mcpTestClient()
    const result = await client.callTool({
      name: "list_audit_log",
      arguments: { limit: 5000 },
    })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/validation/i)
    expect(listAuditLog).not.toHaveBeenCalled()
    await close()
  })

  it("reports an unknown tool as an error rather than crashing the connection", async () => {
    const { client, close } = await mcpTestClient()
    const result = await client.callTool({ name: "delete_everything", arguments: {} })
    expect(result.isError).toBe(true)
    await close()
  })
})
```

- [ ] **Step 2: Write the failing overview-tools test**

Create `src/__tests__/mcp/tools-overview.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const { recordMcpRead, marketplaceOverview, getRecentActivity, listAuditLog } = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  marketplaceOverview: vi.fn(),
  getRecentActivity: vi.fn(),
  listAuditLog: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead }))
vi.mock("@/lib/mcp/queries/overview", () => ({ marketplaceOverview }))
vi.mock("@/lib/mcp/queries/audit", () => ({ listAuditLog }))
vi.mock("@/lib/admin/activity", () => ({ getRecentActivity }))

import { mcpTestClient } from "../../../test/helpers/mcp-harness"

beforeEach(() => {
  recordMcpRead.mockReset().mockResolvedValue("audit-1")
  marketplaceOverview.mockReset().mockResolvedValue({ listings: { total: 0, by_status: {} } })
  listAuditLog.mockReset().mockResolvedValue({ items: [], next_cursor: null })
  getRecentActivity.mockReset().mockResolvedValue({ items: [], nextCursor: null })
})

describe("get_marketplace_overview", () => {
  it("writes an mcp.read audit row naming the tool", async () => {
    const { client, close } = await mcpTestClient()
    await client.callTool({ name: "get_marketplace_overview", arguments: {} })
    expect(recordMcpRead).toHaveBeenCalledWith(
      { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" },
      "get_marketplace_overview",
      {},
    )
    await close()
  })

  it("surfaces a plain Error from the query as the tool's message", async () => {
    marketplaceOverview.mockRejectedValue(new Error("Analytics unavailable"))
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "get_marketplace_overview", arguments: {} })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Analytics unavailable")
    await close()
  })
})

describe("list_recent_activity", () => {
  it("passes filters through and renames nextCursor to next_cursor", async () => {
    getRecentActivity.mockResolvedValue({
      items: [
        {
          at: new Date("2026-09-14T12:00:00.000Z"),
          kind: "admin_action",
          id: "a1",
          actor: { id: "u-1", name: "Parker", email: "p@hellosugar.salon" },
          target: { type: "listing", id: "l-1", label: "Aspen" },
          summary: "Approved listing Aspen",
          source: "mcp",
        },
      ],
      nextCursor: "CURSOR",
    })
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "list_recent_activity",
      arguments: { kinds: ["admin_action"], since: "2026-09-01T00:00:00.000Z", limit: 10 },
    })
    expect(getRecentActivity).toHaveBeenCalledWith({
      kinds: ["admin_action"],
      actorUserId: undefined,
      since: new Date("2026-09-01T00:00:00.000Z"),
      cursor: undefined,
      limit: 10,
    })
    expect(r.structuredContent).toEqual({
      items: [
        {
          at: "2026-09-14T12:00:00.000Z",
          kind: "admin_action",
          id: "a1",
          actor: { id: "u-1", name: "Parker", email: "p@hellosugar.salon" },
          target: { type: "listing", id: "l-1", label: "Aspen" },
          summary: "Approved listing Aspen",
          source: "mcp",
        },
      ],
      next_cursor: "CURSOR",
    })
    await close()
  })

  it("defaults the limit to 25 when the caller omits it", async () => {
    const { client, close } = await mcpTestClient()
    await client.callTool({ name: "list_recent_activity", arguments: {} })
    expect(getRecentActivity.mock.calls[0][0].limit).toBe(25)
    await close()
  })

  it("rejects an unknown activity kind at the schema, not in the handler", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_recent_activity", arguments: { kinds: ["nope"] } })
    expect(r.isError).toBe(true)
    expect(getRecentActivity).not.toHaveBeenCalled()
    await close()
  })
})

describe("list_audit_log", () => {
  it("maps snake_case tool arguments onto the query's camelCase filters", async () => {
    const { client, close } = await mcpTestClient()
    await client.callTool({
      name: "list_audit_log",
      arguments: {
        actor_user_id: "u-9",
        action: "listing.approve",
        target_type: "listing",
        target_id: "l-1",
        source: "mcp",
        since: "2026-09-01T00:00:00.000Z",
        include_reads: true,
        limit: 50,
        cursor: "C",
      },
    })
    expect(listAuditLog).toHaveBeenCalledWith({
      actorUserId: "u-9",
      action: "listing.approve",
      targetType: "listing",
      targetId: "l-1",
      source: "mcp",
      since: new Date("2026-09-01T00:00:00.000Z"),
      includeReads: true,
      limit: 50,
      cursor: "C",
    })
    await close()
  })

  it("returns the query's page shape unchanged", async () => {
    listAuditLog.mockResolvedValue({ items: [{ id: "a1" }], next_cursor: "NEXT" })
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_audit_log", arguments: {} })
    expect(r.structuredContent).toEqual({ items: [{ id: "a1" }], next_cursor: "NEXT" })
    await close()
  })
})
```

- [ ] **Step 3: Run both to verify they fail**

```
npx vitest run src/__tests__/mcp/server.test.ts src/__tests__/mcp/tools-overview.test.ts
```

Expected: FAIL — cannot resolve `test/helpers/mcp-harness`, `@/lib/mcp/server`.

- [ ] **Step 4: Write the server module**

Create `src/lib/mcp/server.ts`:

```ts
// Per-request MCP server assembly.
//
// NOT a use server module.
//
// The v2 SDK serves HTTP through a FACTORY, not a long-lived server: createMcpHandler
// calls the factory once per request and the instance is discarded afterwards. That is
// exactly what lets the tool set vary by caller — a read-only token simply never has
// the write tools registered, so tools/list filters itself with no extra machinery.
// Never hoist an McpServer to module scope.
import { McpServer, createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server"
import * as Sentry from "@sentry/nextjs"
import type { McpActor } from "@/lib/mcp/auth/verify-token"
import { toolContext } from "@/lib/mcp/tools/_shared"
import { registerOverviewTools } from "@/lib/mcp/tools/overview"

export const MCP_SERVER_NAME = "hs-marketplace-mcp-server"
export const MCP_SERVER_TITLE = "Hello Sugar Marketplace Admin"
export const MCP_SERVER_VERSION = "1.0.0"

/**
 * Every tool that mutates. Two jobs:
 *  - the route rejects a `tools/call` naming one of these with HTTP 403
 *    `insufficient_scope` when the token is read-only, instead of the bare
 *    "unknown tool" the omitted registration would otherwise produce;
 *  - the server test diffs a write-scoped tools/list against a read-scoped one and
 *    asserts the difference is exactly this set, so the list cannot drift.
 * Mirrors spec §7.4 exactly.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "approve_listing",
  "reject_listing",
  "update_listing",
  "mark_listing_sold",
  "set_user_role",
  "set_seller_access",
  "add_to_allowlist",
  "remove_from_allowlist",
  "remove_user",
  "approve_brand_request",
  "reject_brand_request",
  "retry_brand_request_dispatch",
  "add_owner_link",
  "revoke_owner_link",
  "clear_owner_link",
  "set_location_data_mapping",
  "refresh_owner_directory",
  "revoke_mcp_connection",
])

const INSTRUCTIONS = [
  "Administrative access to the Hello Sugar marketplace. Read tools describe live",
  "production data; write tools perform the same actions an admin can perform in the",
  "web UI at /admin, and every one of them is recorded in the admin audit log.",
  "Tools marked destructive return a preview and a confirmation_token on the first",
  "call and change nothing; call them again with that token, and identical arguments,",
  "to execute. Money is always reported in integer cents alongside a formatted string.",
].join(" ")

/**
 * Build the MCP server for ONE request, bound to one verified token.
 *
 * Each domain module decides internally whether to register its write tools, using
 * `ctx.canWrite`. Adding a domain is one import and one call here.
 */
export function buildMcpServer(actor: McpActor): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, title: MCP_SERVER_TITLE, version: MCP_SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  )
  const ctx = toolContext(actor)

  registerOverviewTools(server, ctx)

  return server
}

/**
 * The production handler options, in one place so the test harness drives exactly
 * what Vercel does.
 *
 * `responseMode: "json"` — this endpoint has no long-running tools and publishes no
 * mid-call progress, so a single JSON body is the right answer and avoids holding an
 * SSE stream open on a serverless function.
 * `legacy: "stateless"` (the SDK default, stated explicitly) — Claude clients may still
 * open with the 2025-era handshake, and each such request is served by its own instance.
 */
export function createMcpRequestHandler(actor: McpActor): McpHttpHandler {
  return createMcpHandler(() => buildMcpServer(actor), {
    responseMode: "json",
    legacy: "stateless",
    onerror: (error) => {
      Sentry.captureException(error, { tags: { mcp_stage: "handler" } })
    },
  })
}
```

- [ ] **Step 5: Write the overview tool module**

Create `src/lib/mcp/tools/overview.ts`:

```ts
// Cross-cutting read tools: the marketplace headline, the activity feed, the audit log.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import { getRecentActivity, type ActivityKind } from "@/lib/admin/activity"
import { marketplaceOverview } from "@/lib/mcp/queries/overview"
import { listAuditLog } from "@/lib/mcp/queries/audit"
import {
  DEFAULT_LIMIT,
  READ_ANNOTATIONS,
  cursorField,
  limitField,
  readTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

const ACTIVITY_KINDS = [
  "admin_action",
  "listing_created",
  "listing_listed",
  "listing_updated",
  "inquiry",
  "favorite",
  "login",
  "brand_request_submitted",
  "brand_request_decided",
  "owner_link_changed",
] as const satisfies readonly ActivityKind[]

const sinceField = z.iso
  .datetime()
  .optional()
  .describe("ISO 8601 timestamp; only events at or after this moment are returned.")

export function registerOverviewTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "get_marketplace_overview",
    {
      title: "Marketplace overview",
      description:
        "Current state of the whole marketplace in one call: listing counts by status, " +
        "the size of the pending approval queue, open competitor-brand requests, user and " +
        "admin counts, and inquiry/login activity over the last 7 and 30 days. Start here " +
        "when asked how the marketplace is doing. Takes no arguments.",
      inputSchema: z.object({}),
      annotations: READ_ANNOTATIONS,
    },
    async (_args, _ctx) =>
      readTool(ctx, "get_marketplace_overview", {}, async () => {
        return { ...(await marketplaceOverview()) }
      }),
  )

  server.registerTool(
    "list_recent_activity",
    {
      title: "List recent activity",
      description:
        "Chronological feed of everything that has happened on the marketplace: admin " +
        "actions, listing creations and status changes, buyer inquiries, favorites, logins, " +
        "brand requests and owner-link changes. Newest first. Use `kinds` to narrow to one " +
        "or more event types and `actor_user_id` to follow one person. Returns " +
        "{ items, next_cursor }; pass next_cursor back as `cursor` for the following page.",
      inputSchema: z.object({
        kinds: z
          .array(z.enum(ACTIVITY_KINDS))
          .max(ACTIVITY_KINDS.length)
          .optional()
          .describe("Restrict the feed to these event kinds. Omit for all kinds."),
        actor_user_id: z
          .string()
          .max(64)
          .optional()
          .describe("Only events performed by this user id."),
        since: sinceField,
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_recent_activity", args, async () => {
        const page = await getRecentActivity({
          kinds: args.kinds as ActivityKind[] | undefined,
          actorUserId: args.actor_user_id,
          since: args.since ? new Date(args.since) : undefined,
          cursor: args.cursor,
          limit: args.limit ?? DEFAULT_LIMIT,
        })
        return {
          items: page.items.map((item) => ({ ...item, at: item.at.toISOString() })),
          next_cursor: page.nextCursor,
        }
      }),
  )

  server.registerTool(
    "list_audit_log",
    {
      title: "List admin audit log",
      description:
        "Raw admin audit log: one row per admin mutation from either the web UI or this " +
        "MCP connection, with the actor, the arguments, the outcome and the duration. " +
        "`mcp.read` rows (one per MCP read) are hidden unless include_reads is true. " +
        "Use this to answer 'who changed X and when'. Newest first; " +
        "returns { items, next_cursor }.",
      inputSchema: z.object({
        actor_user_id: z.string().max(64).optional().describe("Only rows for this actor's user id."),
        action: z
          .string()
          .max(64)
          .optional()
          .describe('Exact dotted action, e.g. "listing.approve" or "user.set_role".'),
        target_type: z
          .enum([
            "listing",
            "user",
            "allowlist",
            "brand_request",
            "owner_link",
            "listing_location",
            "owner_directory",
            "mcp_token",
          ])
          .optional()
          .describe("Only rows whose target is of this type."),
        target_id: z.string().max(64).optional().describe("Only rows touching this target id."),
        source: z
          .enum(["ui", "mcp"])
          .optional()
          .describe("Where the action came from: the admin web UI, or an MCP connection."),
        since: sinceField,
        include_reads: z
          .boolean()
          .optional()
          .describe("Include the high-volume mcp.read rows. Default false."),
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_audit_log", args, async () =>
        listAuditLog({
          actorUserId: args.actor_user_id,
          action: args.action,
          targetType: args.target_type,
          targetId: args.target_id,
          source: args.source,
          since: args.since ? new Date(args.since) : undefined,
          includeReads: args.include_reads,
          limit: args.limit ?? DEFAULT_LIMIT,
          cursor: args.cursor,
        }),
      ),
  )
}
```

- [ ] **Step 6: Write the test harness**

Create `test/helpers/mcp-harness.ts`:

```ts
/**
 * Loopback MCP client for tool tests.
 *
 * Drives the REAL `createMcpRequestHandler` in-process: the client transport's
 * `fetch` is the handler's own `fetch`, so nothing is listening on a socket but the
 * full Streamable HTTP path — protocol negotiation, schema validation, result
 * projection — runs exactly as it does on Vercel.
 *
 * Deliberately NOT `InMemoryTransport.createLinkedPair()`: in SDK v2 that pair
 * connects 2025-era instances only, so it would not exercise the protocol revision
 * this endpoint actually serves.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { createMcpRequestHandler } from "@/lib/mcp/server"
import type { McpActor } from "@/lib/mcp/auth/verify-token"

/** The actor every tool test gets unless it overrides a field (e.g. `scopes`). */
export const TEST_ACTOR: McpActor = {
  userId: "u-1",
  email: "admin@hellosugar.salon",
  scopes: ["marketplace:read", "marketplace:write"],
  clientId: "claude-code",
  tokenId: "tok-1",
}

export async function mcpTestClient(
  overrides: Partial<McpActor> = {},
): Promise<{ client: Client; close: () => Promise<void> }> {
  const actor: McpActor = { ...TEST_ACTOR, ...overrides }
  const handler = createMcpRequestHandler(actor)

  // The URL is never dialled — `fetch` short-circuits into the handler.
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.test/api/mcp"), {
    fetch: (url: URL | string, init?: RequestInit) => handler.fetch(new Request(url, init)),
  })

  const client = new Client(
    { name: "hs-marketplace-test-harness", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  )
  await client.connect(transport)

  return {
    client,
    close: async () => {
      await client.close()
      await handler.close()
    },
  }
}
```

- [ ] **Step 7: Run both tests to verify they pass**

```
npx vitest run src/__tests__/mcp/server.test.ts src/__tests__/mcp/tools-overview.test.ts
```

Expected: PASS. If the connect step hangs, the harness `fetch` is not being reached — check that `handler.fetch` is passed as an arrow (not detached in a way that loses `this`) and that `responseMode: "json"` is set.

- [ ] **Step 8: Type-check and lint**

```
npx tsc --noEmit
npx eslint src/lib/mcp test/helpers/mcp-harness.ts
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/mcp/server.ts src/lib/mcp/tools/overview.ts test/helpers/mcp-harness.ts src/__tests__/mcp/server.test.ts src/__tests__/mcp/tools-overview.test.ts
git commit -F- <<'MSG'
feat(mcp): per-request server assembly, loopback harness, overview tools

buildMcpServer constructs one McpServer per HTTP request so the tool set can vary
by token scope; createMcpRequestHandler pins the production handler options in one
place and the test harness drives that same handler in-process through a real
client. Adds get_marketplace_overview, list_recent_activity and list_audit_log.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 5: Listing tools — reads, writes, and the first destructive confirmations

Spec §7.3's `list_listings` / `get_listing` and all four of §7.4's listing writes. Three of the four are destructive, so this task also proves the preview-then-execute contract end to end.

Two existing modules need a session-free seam first: `loadAdminListing` takes an Auth.js `Session` and calls `redirect()` / `notFound()`, which are Next navigation throws that have no meaning inside an MCP tool. The query underneath it is extracted and exported so both callers share one definition.

**Files:**
- Modify: `src/lib/listings/load-listing.ts` (export the query; `loadAdminListing` delegates)
- Create: `src/lib/mcp/queries/listings.ts`
- Create: `src/lib/mcp/tools/listings.ts`
- Modify: `src/lib/mcp/server.ts` (register the domain)
- Test: `src/__tests__/mcp/tools-listings.test.ts`

**Interfaces:**
- Consumes: `getAllListings`, `approveListing`, `rejectListing`, `adminUpdateListing`, `adminMarkSold` (`@/lib/admin/core/listings`); `canTransition` (`@/lib/listings/status-machine`); `parseListingPatch` (`@/lib/listings/schemas`); `unresolvedSalonLocations` (`@/lib/data/mapping`); `requireConfirmation` (`@/lib/mcp/confirm`); `_shared.ts`.
- Produces:
  - `function queryAdminListing(id: string): Promise<ListingWithRelationsAndSeller | undefined>` (in `load-listing.ts`)
  - `interface ListingExtras { recent_inquiries: {...}[]; views: { counter: number; distinct_viewers: number }; audit_history: AuditLogEntry[] }`
  - `function listingExtras(listingId: string): Promise<ListingExtras>`
  - `function registerListingTools(server: McpServer, ctx: McpToolContext): void`
  - `function listingSummary(row): Record<string, unknown>` (module-private projection, re-derived per module — not exported)

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/mcp/tools-listings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const core = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  getAllListings: vi.fn(),
  approveListing: vi.fn(),
  rejectListing: vi.fn(),
  adminUpdateListing: vi.fn(),
  adminMarkSold: vi.fn(),
  queryAdminListing: vi.fn(),
  listingExtras: vi.fn(),
  marketplaceOverview: vi.fn(),
  getRecentActivity: vi.fn(),
  listAuditLog: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead: core.recordMcpRead }))
vi.mock("@/lib/admin/core/listings", () => ({
  getAllListings: core.getAllListings,
  approveListing: core.approveListing,
  rejectListing: core.rejectListing,
  adminUpdateListing: core.adminUpdateListing,
  adminMarkSold: core.adminMarkSold,
}))
vi.mock("@/lib/listings/load-listing", () => ({ queryAdminListing: core.queryAdminListing }))
vi.mock("@/lib/mcp/queries/listings", () => ({ listingExtras: core.listingExtras }))
vi.mock("@/lib/mcp/queries/overview", () => ({ marketplaceOverview: core.marketplaceOverview }))
vi.mock("@/lib/mcp/queries/audit", () => ({ listAuditLog: core.listAuditLog }))
vi.mock("@/lib/admin/activity", () => ({ getRecentActivity: core.getRecentActivity }))

import { mcpTestClient } from "../../../test/helpers/mcp-harness"
import { __resetRateLimits } from "@/lib/rate-limit"

const ACTOR = { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" }

function listingRow(over: Record<string, unknown> = {}) {
  return {
    id: "l-1",
    sellerId: "s-1",
    type: "suite",
    status: "pending",
    title: "Aspen Highlands",
    askingPrice: 12345600,
    ttmProfit: 4500000,
    inventoryIncluded: true,
    laserIncluded: false,
    inventoryCostEstimate: 250000,
    otherAssets: null,
    reasonForSelling: "Relocating",
    notes: null,
    rejectionReason: null,
    viewCount: 12,
    inquiryCount: 2,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    listedAt: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    locations: [
      {
        id: "loc-1",
        name: "Aspen Highlands",
        locationType: "salon",
        city: "Aspen",
        state: "CO",
        dataMappingStatus: "confirmed",
        displayOrder: 0,
      },
    ],
    photos: [{ id: "p-1", url: "https://blob/p1.jpg", displayOrder: 0 }],
    seller: { id: "s-1", name: "Dana", email: "dana@example.com" },
    ...over,
  }
}

beforeEach(() => {
  __resetRateLimits()
  for (const fn of Object.values(core)) fn.mockReset()
  core.recordMcpRead.mockResolvedValue("audit-read")
  core.getAllListings.mockResolvedValue([listingRow()])
  core.queryAdminListing.mockResolvedValue(listingRow())
  core.listingExtras.mockResolvedValue({
    recent_inquiries: [],
    views: { counter: 12, distinct_viewers: 9 },
    audit_history: [],
  })
  core.approveListing.mockResolvedValue({ success: true, auditId: "aud-approve" })
  core.rejectListing.mockResolvedValue({ success: true, auditId: "aud-reject" })
  core.adminUpdateListing.mockResolvedValue({ success: true, auditId: "aud-update" })
  core.adminMarkSold.mockResolvedValue({ success: true, auditId: "aud-sold" })
})

describe("list_listings", () => {
  it("projects money as cents plus a formatted string", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_listings", arguments: {} })
    const items = (r.structuredContent as { items: Record<string, unknown>[] }).items
    expect(items[0].asking_price).toEqual({ cents: 12345600, formatted: "$123,456" })
    expect(items[0].ttm_profit).toEqual({ cents: 4500000, formatted: "$45,000" })
    await close()
  })

  it("passes a status filter straight to the core read", async () => {
    const { client, close } = await mcpTestClient()
    await client.callTool({ name: "list_listings", arguments: { status: "pending" } })
    expect(core.getAllListings).toHaveBeenCalledWith("pending")
    await close()
  })

  it("filters in memory by type, state, seller and search", async () => {
    core.getAllListings.mockResolvedValue([
      listingRow({ id: "a", title: "Aspen", type: "suite" }),
      listingRow({ id: "b", title: "Boulder", type: "territory" }),
    ])
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "list_listings",
      arguments: { type: "territory", search: "bould" },
    })
    const items = (r.structuredContent as { items: { id: string }[] }).items
    expect(items.map((i) => i.id)).toEqual(["b"])
    await close()
  })

  it("paginates with an opaque cursor", async () => {
    core.getAllListings.mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => listingRow({ id: `l${i}` })),
    )
    const { client, close } = await mcpTestClient()
    const first = await client.callTool({ name: "list_listings", arguments: { limit: 2 } })
    const page1 = first.structuredContent as { items: { id: string }[]; next_cursor: string }
    expect(page1.items.map((i) => i.id)).toEqual(["l0", "l1"])
    const second = await client.callTool({
      name: "list_listings",
      arguments: { limit: 2, cursor: page1.next_cursor },
    })
    const page2 = second.structuredContent as { items: { id: string }[]; next_cursor: null }
    expect(page2.items.map((i) => i.id)).toEqual(["l2", "l3"])
    expect(page2.next_cursor).toBeNull()
    await close()
  })

  it("rejects a search string over 200 characters at the schema", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "list_listings",
      arguments: { search: "x".repeat(201) },
    })
    expect(r.isError).toBe(true)
    expect(core.getAllListings).not.toHaveBeenCalled()
    await close()
  })
})

describe("get_listing", () => {
  it("returns the listing with locations, photos, seller and the extras", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "get_listing", arguments: { listing_id: "l-1" } })
    const body = r.structuredContent as Record<string, any>
    expect(body.listing.id).toBe("l-1")
    expect(body.listing.locations[0].name).toBe("Aspen Highlands")
    expect(body.listing.photos).toHaveLength(1)
    expect(body.listing.seller).toEqual({ id: "s-1", name: "Dana", email: "dana@example.com" })
    expect(body.views).toEqual({ counter: 12, distinct_viewers: 9 })
    expect(body.recent_inquiries).toEqual([])
    expect(body.audit_history).toEqual([])
    await close()
  })

  it("returns the UI's own message when the listing does not exist", async () => {
    core.queryAdminListing.mockResolvedValue(undefined)
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "get_listing", arguments: { listing_id: "nope" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Listing not found")
    await close()
  })
})

describe("approve_listing (non-destructive)", () => {
  it("executes on the first call with no confirmation token", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "approve_listing", arguments: { listing_id: "l-1" } })
    expect(core.approveListing).toHaveBeenCalledWith(ACTOR, "l-1")
    const body = r.structuredContent as Record<string, any>
    expect(body.audit_id).toBe("aud-approve")
    expect(body.target.id).toBe("l-1")
    await close()
  })

  it("has no confirmation_token in its schema", async () => {
    const { client, close } = await mcpTestClient()
    const tool = (await client.listTools()).tools.find((t) => t.name === "approve_listing")!
    expect(JSON.stringify(tool.inputSchema)).not.toContain("confirmation_token")
    expect(tool.annotations?.destructiveHint).toBe(false)
    await close()
  })

  it("surfaces the core's unresolved-mapping refusal verbatim", async () => {
    core.approveListing.mockRejectedValue(new Error("Confirm data mapping for: Aspen Highlands"))
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "approve_listing", arguments: { listing_id: "l-1" } })
    expect((r.content[0] as { text: string }).text).toBe(
      "Confirm data mapping for: Aspen Highlands",
    )
    await close()
  })
})

describe("reject_listing (destructive)", () => {
  it("previews and changes nothing without a token", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "reject_listing",
      arguments: { listing_id: "l-1", reason: "Duplicate of L-7" },
    })
    const body = r.structuredContent as Record<string, any>
    expect(body.preview).toContain("Aspen Highlands")
    expect(body.preview).toContain("Duplicate of L-7")
    expect(body.expires_in).toBe(600)
    expect(typeof body.confirmation_token).toBe("string")
    expect(core.rejectListing).not.toHaveBeenCalled()
    await close()
  })

  it("executes when the token is passed back with identical arguments", async () => {
    const { client, close } = await mcpTestClient()
    const args = { listing_id: "l-1", reason: "Duplicate of L-7" }
    const preview = await client.callTool({ name: "reject_listing", arguments: args })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const done = await client.callTool({
      name: "reject_listing",
      arguments: { ...args, confirmation_token: token },
    })
    expect(core.rejectListing).toHaveBeenCalledWith(ACTOR, "l-1", "Duplicate of L-7", undefined)
    expect((done.structuredContent as { audit_id: string }).audit_id).toBe("aud-reject")
    await close()
  })

  it("refuses a token minted for a different reason", async () => {
    const { client, close } = await mcpTestClient()
    const preview = await client.callTool({
      name: "reject_listing",
      arguments: { listing_id: "l-1", reason: "Duplicate of L-7" },
    })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const r = await client.callTool({
      name: "reject_listing",
      arguments: { listing_id: "l-1", reason: "Actually, spam", confirmation_token: token },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toMatch(/does not match these arguments/)
    expect(core.rejectListing).not.toHaveBeenCalled()
    await close()
  })

  it("runs the state-machine pre-check BEFORE issuing a token", async () => {
    core.queryAdminListing.mockResolvedValue(listingRow({ status: "sold" }))
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "reject_listing",
      arguments: { listing_id: "l-1", reason: "Duplicate" },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Cannot reject listing with status sold")
    expect(r.structuredContent).not.toHaveProperty("confirmation_token")
    await close()
  })

  it("advertises itself as destructive and requiring user interaction", async () => {
    const { client, close } = await mcpTestClient()
    const tool = (await client.listTools()).tools.find((t) => t.name === "reject_listing")!
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    })
    expect(tool._meta).toMatchObject({ "anthropic/requiresUserInteraction": true })
    await close()
  })

  it("rejects an empty reason at the schema", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "reject_listing",
      arguments: { listing_id: "l-1", reason: "   " },
    })
    expect(r.isError).toBe(true)
    expect(core.queryAdminListing).not.toHaveBeenCalled()
    await close()
  })
})

describe("update_listing (destructive)", () => {
  it("validates the patch with parseListingPatch before issuing a token", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "update_listing",
      arguments: { listing_id: "l-1", patch: { notes: "x".repeat(2001) } },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toMatch(/^Invalid listing data — /)
    expect(core.adminUpdateListing).not.toHaveBeenCalled()
    await close()
  })

  it("hands the RAW patch to the core so it applies its own dollars-to-cents rule", async () => {
    const { client, close } = await mcpTestClient()
    const args = { listing_id: "l-1", patch: { askingPrice: 150000, notes: "Price drop" } }
    const preview = await client.callTool({ name: "update_listing", arguments: args })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    await client.callTool({
      name: "update_listing",
      arguments: { ...args, confirmation_token: token },
    })
    expect(core.adminUpdateListing).toHaveBeenCalledWith(ACTOR, "l-1", {
      askingPrice: 150000,
      notes: "Price drop",
    })
    await close()
  })

  it("names the changed fields in the preview", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "update_listing",
      arguments: { listing_id: "l-1", patch: { askingPrice: 150000, notes: "Price drop" } },
    })
    expect((r.structuredContent as { preview: string }).preview).toContain("askingPrice, notes")
    await close()
  })
})

describe("mark_listing_sold (destructive)", () => {
  it("blocks at the pre-check when the listing is not active", async () => {
    core.queryAdminListing.mockResolvedValue(listingRow({ status: "pending" }))
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "mark_listing_sold", arguments: { listing_id: "l-1" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe(
      "Cannot mark listing as sold from status pending",
    )
    await close()
  })

  it("previews then executes for an active listing", async () => {
    core.queryAdminListing.mockResolvedValue(listingRow({ status: "active" }))
    const { client, close } = await mcpTestClient()
    const preview = await client.callTool({
      name: "mark_listing_sold",
      arguments: { listing_id: "l-1" },
    })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const done = await client.callTool({
      name: "mark_listing_sold",
      arguments: { listing_id: "l-1", confirmation_token: token },
    })
    expect(core.adminMarkSold).toHaveBeenCalledWith(ACTOR, "l-1")
    expect((done.structuredContent as { audit_id: string }).audit_id).toBe("aud-sold")
    await close()
  })
})

describe("scope gating", () => {
  it("hides every listing write tool from a read-only token", async () => {
    const { client, close } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain("list_listings")
    expect(names).toContain("get_listing")
    for (const w of ["approve_listing", "reject_listing", "update_listing", "mark_listing_sold"]) {
      expect(names).not.toContain(w)
    }
    await close()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```
npx vitest run src/__tests__/mcp/tools-listings.test.ts
```

Expected: FAIL — `queryAdminListing` is not exported from `@/lib/listings/load-listing`, and `@/lib/mcp/queries/listings` does not resolve.

- [ ] **Step 3: Extract the session-free listing query**

In `src/lib/listings/load-listing.ts`, replace the private `queryListingWithSeller` (lines 37–48) with an exported version and point `loadAdminListing` at it. Delete the old private function; leave `queryListingBase` and `loadSellerListing` untouched.

```ts
/**
 * Fetch a listing with its ordered locations, photos, and the seller user row.
 *
 * Exported and session-free on purpose: `loadAdminListing` below layers the page
 * behaviour (session check, `redirect()`, `notFound()`) on top, but the MCP endpoint
 * carries a bearer token rather than a cookie and must never call a Next navigation
 * throw. Both callers share this one query so the shape can never diverge.
 */
export async function queryAdminListing(
  id: string,
): Promise<ListingWithRelationsAndSeller | undefined> {
  return db.query.listings.findFirst({
    where: eq(listings.id, id),
    with: {
      locations: { orderBy: [listingLocations.displayOrder] },
      photos: { orderBy: [listingPhotos.displayOrder] },
      seller: true,
    },
  })
}
```

Then in `loadAdminListing`'s body, change:

```ts
  const listing = opts?.withSeller
    ? await queryListingWithSeller(id)
    : await queryListingBase(id)
```

to:

```ts
  const listing = opts?.withSeller ? await queryAdminListing(id) : await queryListingBase(id)
```

- [ ] **Step 4: Write the listing extras query**

Create `src/lib/mcp/queries/listings.ts`:

```ts
// Per-listing context the admin detail page shows around the listing itself.
//
// NOT a use server module.
import { count, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { contacts } from "@/db/schema/contacts"
import { listings } from "@/db/schema/listings"
import { listingViews } from "@/db/schema/listingViews"
import { listAuditLog, type AuditLogEntry } from "@/lib/mcp/queries/audit"

const RECENT_INQUIRY_LIMIT = 10
const AUDIT_HISTORY_LIMIT = 20

export interface ListingExtras {
  recent_inquiries: {
    id: string
    at: string
    buyer_name: string | null
    buyer_email: string | null
    buyer_phone: string | null
    message: string | null
  }[]
  views: {
    /** The denormalised counter on the listing row (what the UI shows). */
    counter: number
    /** Distinct signed-in viewers recorded in listing_views. */
    distinct_viewers: number
  }
  audit_history: AuditLogEntry[]
}

export async function listingExtras(listingId: string): Promise<ListingExtras> {
  const [inquiryRows, viewRows, counterRows, audit] = await Promise.all([
    db
      .select({
        id: contacts.id,
        createdAt: contacts.createdAt,
        buyerName: contacts.buyerName,
        buyerEmail: contacts.buyerEmail,
        buyerPhone: contacts.buyerPhone,
        message: contacts.message,
      })
      .from(contacts)
      .where(eq(contacts.listingId, listingId))
      .orderBy(desc(contacts.createdAt))
      .limit(RECENT_INQUIRY_LIMIT),
    db.select({ n: count() }).from(listingViews).where(eq(listingViews.listingId, listingId)),
    db.select({ n: listings.viewCount }).from(listings).where(eq(listings.id, listingId)).limit(1),
    // Includes mcp.read rows deliberately: on one listing the volume is small and
    // "which MCP session looked at this" is exactly what an investigation wants.
    listAuditLog({ targetType: "listing", targetId: listingId, includeReads: true, limit: AUDIT_HISTORY_LIMIT }),
  ])

  return {
    recent_inquiries: inquiryRows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      buyer_name: r.buyerName,
      buyer_email: r.buyerEmail,
      buyer_phone: r.buyerPhone,
      message: r.message,
    })),
    views: {
      counter: counterRows[0]?.n ?? 0,
      distinct_viewers: viewRows[0]?.n ?? 0,
    },
    audit_history: audit.items,
  }
}
```

- [ ] **Step 5: Write the listing tools**

Create `src/lib/mcp/tools/listings.ts`:

```ts
// Listing reads and the four admin listing writes.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import {
  getAllListings,
  approveListing,
  rejectListing,
  adminUpdateListing,
  adminMarkSold,
} from "@/lib/admin/core/listings"
import { queryAdminListing } from "@/lib/listings/load-listing"
import { parseListingPatch } from "@/lib/listings/schemas"
import { canTransition } from "@/lib/listings/status-machine"
import type { ListingStatus } from "@/lib/listings/types"
import { listingExtras } from "@/lib/mcp/queries/listings"
import { requireConfirmation } from "@/lib/mcp/confirm"
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ANNOTATIONS,
  REQUIRES_USER_INTERACTION,
  WRITE_ANNOTATIONS,
  confirmationField,
  cursorField,
  limitField,
  money,
  notesField,
  paginateArray,
  readTool,
  reasonField,
  searchField,
  writeTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

const LISTING_STATUSES = ["draft", "pending", "active", "rejected", "sold", "delisted"] as const
const LISTING_TYPES = ["suite", "flagship", "territory", "bundle"] as const

const listingIdField = z.string().min(1).max(64).describe("The listing's id.")

type LocationRow = {
  id: string
  name: string
  locationType: string
  city: string | null
  state: string | null
  dataMappingStatus: string
  displayOrder: number
}

type ListingRow = {
  id: string
  sellerId: string
  type: string
  status: string
  title: string | null
  askingPrice: number
  ttmProfit: number | null
  inventoryIncluded: boolean
  laserIncluded: boolean
  inventoryCostEstimate: number | null
  otherAssets: string | null
  reasonForSelling: string | null
  notes: string | null
  rejectionReason: string | null
  viewCount: number
  inquiryCount: number
  createdAt: Date
  listedAt: Date | null
  updatedAt: Date
  locations?: LocationRow[]
  photos?: { id: string; url: string; displayOrder: number }[]
  seller?: { id: string; name: string | null; email: string | null } | null
}

/** One projection for both the list and the detail tool, so they never disagree. */
function listingSummary(row: ListingRow): Record<string, unknown> {
  const primary = row.locations?.find((l) => l.displayOrder === 0) ?? row.locations?.[0]
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    type: row.type,
    asking_price: money(row.askingPrice),
    ttm_profit: money(row.ttmProfit),
    inventory_included: row.inventoryIncluded,
    laser_included: row.laserIncluded,
    inventory_cost_estimate: money(row.inventoryCostEstimate),
    other_assets: row.otherAssets,
    reason_for_selling: row.reasonForSelling,
    notes: row.notes,
    rejection_reason: row.rejectionReason,
    view_count: row.viewCount,
    inquiry_count: row.inquiryCount,
    created_at: row.createdAt.toISOString(),
    listed_at: row.listedAt ? row.listedAt.toISOString() : null,
    updated_at: row.updatedAt.toISOString(),
    primary_location: primary
      ? { name: primary.name, city: primary.city, state: primary.state }
      : null,
    seller: row.seller
      ? { id: row.seller.id, name: row.seller.name, email: row.seller.email }
      : { id: row.sellerId, name: null, email: null },
  }
}

function listingDetail(row: ListingRow): Record<string, unknown> {
  return {
    ...listingSummary(row),
    locations: (row.locations ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      location_type: l.locationType,
      city: l.city,
      state: l.state,
      data_mapping_status: l.dataMappingStatus,
      display_order: l.displayOrder,
    })),
    photos: (row.photos ?? []).map((p) => ({ id: p.id, url: p.url, display_order: p.displayOrder })),
  }
}

/** Load a listing or refuse with the exact sentence the core functions use. */
async function loadOrThrow(listingId: string): Promise<ListingRow> {
  const row = (await queryAdminListing(listingId)) as ListingRow | undefined
  if (!row) throw new Error("Listing not found")
  return row
}

export function registerListingTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_listings",
    {
      title: "List listings",
      description:
        "Every listing an admin can see, newest first, with money as { cents, formatted }. " +
        "Filter by status (draft/pending/active/rejected/sold/delisted), type, two-letter " +
        "state, seller id, or a case-insensitive `search` matched against the title and the " +
        "location names. Returns { items, next_cursor }. Use get_listing for the full record.",
      inputSchema: z.object({
        status: z.enum(LISTING_STATUSES).optional().describe("Only listings in this status."),
        type: z.enum(LISTING_TYPES).optional().describe("Only listings of this type."),
        state: z
          .string()
          .length(2)
          .optional()
          .describe("Two-letter US state code of any of the listing's locations, e.g. CO."),
        seller_id: z.string().max(64).optional().describe("Only listings owned by this seller id."),
        search: searchField,
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_listings", args, async () => {
        const rows = (await getAllListings(args.status as ListingStatus | undefined)) as ListingRow[]
        const needle = args.search?.trim().toLowerCase()
        const filtered = rows.filter((row) => {
          if (args.type && row.type !== args.type) return false
          if (args.seller_id && row.sellerId !== args.seller_id) return false
          if (args.state && !(row.locations ?? []).some((l) => l.state === args.state)) return false
          if (needle) {
            const haystack = [row.title ?? "", ...(row.locations ?? []).map((l) => l.name)]
              .join(" ")
              .toLowerCase()
            if (!haystack.includes(needle)) return false
          }
          return true
        })
        const page = paginateArray(filtered, args.limit, args.cursor)
        return { items: page.items.map(listingSummary), next_cursor: page.next_cursor }
      }),
  )

  server.registerTool(
    "get_listing",
    {
      title: "Get listing",
      description:
        "One listing in full: every scalar field, its ordered locations (with data-mapping " +
        "status) and photos, the seller, the most recent buyer inquiries, view counts, and " +
        "the audit history for that listing. Use this before any write so you can quote the " +
        "listing's current state back to the admin.",
      inputSchema: z.object({ listing_id: listingIdField }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "get_listing", args, async () => {
        const row = await loadOrThrow(args.listing_id)
        const extras = await listingExtras(args.listing_id)
        return { listing: listingDetail(row), ...extras }
      }),
  )

  if (!ctx.canWrite) return

  server.registerTool(
    "approve_listing",
    {
      title: "Approve listing",
      description:
        "Move a pending listing to active. Sends the seller the approval email and runs " +
        "buyer alert matching, exactly as the /admin/queue button does. Refuses if the " +
        "listing is not pending or if any salon location's data-source mapping is still " +
        "unconfirmed — resolve those with set_location_data_mapping first. Not destructive, " +
        "so it executes immediately.",
      inputSchema: z.object({ listing_id: listingIdField }),
      annotations: WRITE_ANNOTATIONS,
    },
    async (args) =>
      writeTool(ctx, "approve_listing", args, async () => {
        const result = await approveListing(ctx.actor, args.listing_id)
        return { audit_id: result.auditId, target: listingSummary(await loadOrThrow(args.listing_id)) }
      }),
  )

  server.registerTool(
    "reject_listing",
    {
      title: "Reject listing",
      description:
        "Reject a pending listing with a reason. The reason is emailed to the seller and " +
        "stored on the listing, so write it for the seller to read. DESTRUCTIVE: call once " +
        "without confirmation_token to get a preview and a token, then call again with the " +
        "token and identical arguments to execute.",
      inputSchema: z.object({
        listing_id: listingIdField,
        reason: reasonField,
        notes: notesField,
        confirmation_token: confirmationField,
      }),
      annotations: DESTRUCTIVE_ANNOTATIONS,
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "reject_listing", args, async () => {
        const { confirmation_token, ...rest } = args
        const row = await loadOrThrow(rest.listing_id)
        // Same pre-check the core runs, so a doomed call never mints a token.
        if (!canTransition(row.status as ListingStatus, "rejected", "admin")) {
          throw new Error(`Cannot reject listing with status ${row.status}`)
        }
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "reject_listing",
          rest,
          confirmation_token,
          `Reject listing "${row.title ?? row.id}" (${row.id}, currently ${row.status}) with reason "${rest.reason}". This emails the seller and cannot be undone from this connection.`,
        )
        if (prompt) return { ...prompt }
        const result = await rejectListing(ctx.actor, rest.listing_id, rest.reason, rest.notes)
        return { audit_id: result.auditId, target: listingSummary(await loadOrThrow(rest.listing_id)) }
      }),
  )

  server.registerTool(
    "update_listing",
    {
      title: "Update listing",
      description:
        "Edit a listing's fields, exactly as the /admin/listings edit form does. `patch` is " +
        "a partial listing object; only the keys you send are changed. Accepted keys: type, " +
        "askingPrice, ttmProfit, reasonForSelling (max 500), notes (max 2000), " +
        "inventoryIncluded, laserIncluded, inventoryCostEstimate, otherAssets (max 500). " +
        "MONEY IN THIS PATCH IS IN WHOLE DOLLARS, not cents — the same unit the admin form " +
        "uses; the server converts to cents on write. (Read tools report cents.) " +
        "DESTRUCTIVE: preview first, then re-send with confirmation_token.",
      inputSchema: z.object({
        listing_id: listingIdField,
        patch: z
          .record(z.string(), z.unknown())
          .describe(
            "Partial listing object. Validated server-side by the same schema the admin form " +
              "uses; unknown keys are stripped and an invalid value is refused with its path.",
          ),
        confirmation_token: confirmationField,
      }),
      annotations: { ...DESTRUCTIVE_ANNOTATIONS, idempotentHint: true },
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "update_listing", args, async () => {
        const { confirmation_token, ...rest } = args
        const row = await loadOrThrow(rest.listing_id)
        // Validate before minting a token: parseListingPatch throws with the offending
        // paths, which is far more useful than a token the second call would reject.
        const parsed = parseListingPatch(rest.patch)
        const fields = Object.keys(parsed).sort().join(", ")
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "update_listing",
          rest,
          confirmation_token,
          `Update listing "${row.title ?? row.id}" (${row.id}): change ${fields}.`,
        )
        if (prompt) return { ...prompt }
        // Pass the RAW patch, not `parsed`: adminUpdateListing parses it itself and owns
        // the dollars-to-cents conversion. Handing it pre-parsed output would double-apply
        // nothing today but would silently diverge the moment the core adds a step.
        const result = await adminUpdateListing(ctx.actor, rest.listing_id, rest.patch)
        return { audit_id: result.auditId, target: listingSummary(await loadOrThrow(rest.listing_id)) }
      }),
  )

  server.registerTool(
    "mark_listing_sold",
    {
      title: "Mark listing sold",
      description:
        "Move an active listing to sold. Removes it from browse. Only an active listing can " +
        "be marked sold. DESTRUCTIVE: preview first, then re-send with confirmation_token.",
      inputSchema: z.object({
        listing_id: listingIdField,
        confirmation_token: confirmationField,
      }),
      annotations: DESTRUCTIVE_ANNOTATIONS,
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "mark_listing_sold", args, async () => {
        const { confirmation_token, ...rest } = args
        const row = await loadOrThrow(rest.listing_id)
        if (!canTransition(row.status as ListingStatus, "sold", "admin")) {
          throw new Error(`Cannot mark listing as sold from status ${row.status}`)
        }
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "mark_listing_sold",
          rest,
          confirmation_token,
          `Mark listing "${row.title ?? row.id}" (${row.id}) as sold. It stops appearing in browse.`,
        )
        if (prompt) return { ...prompt }
        const result = await adminMarkSold(ctx.actor, rest.listing_id)
        return { audit_id: result.auditId, target: listingSummary(await loadOrThrow(rest.listing_id)) }
      }),
  )
}
```

- [ ] **Step 6: Register the domain**

In `src/lib/mcp/server.ts`, add the import and the call:

```ts
import { registerListingTools } from "@/lib/mcp/tools/listings"
```

and inside `buildMcpServer`, after `registerOverviewTools(server, ctx)`:

```ts
  registerListingTools(server, ctx)
```

- [ ] **Step 7: Run the tests to verify they pass**

```
npx vitest run src/__tests__/mcp/tools-listings.test.ts src/__tests__/mcp/server.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run the existing listing suites to prove the extraction changed nothing**

```
npx vitest run src/__tests__
```

Expected: PASS, including every pre-existing listing, admin and analytics test. `loadAdminListing`'s behaviour is unchanged — only the query moved.

- [ ] **Step 9: Type-check and lint**

```
npx tsc --noEmit
npx eslint src/lib/mcp src/lib/listings/load-listing.ts
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/listings/load-listing.ts src/lib/mcp src/__tests__/mcp/tools-listings.test.ts
git commit -F- <<'MSG'
feat(mcp): listing read and write tools with destructive confirmation

list_listings, get_listing, approve_listing, reject_listing, update_listing and
mark_listing_sold. The three destructive tools run the core's own pre-checks
before minting a confirmation token, so a call that could never succeed fails
immediately instead of after a round trip.

Extracts a session-free queryAdminListing from load-listing.ts: the page loader
layers redirect()/notFound() on top, which an MCP request must never hit.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 6: User and allowlist tools

Spec §7.3's `list_users` / `get_user` / `list_allowlist` and §7.4's five user/allowlist writes. Three of the five are destructive. `set_user_role` and `remove_user` carry the last-admin rules, which run inside the PR A core — the tools re-run the cheap parts as pre-checks so a doomed call never mints a token.

**Files:**
- Create: `src/lib/mcp/queries/users.ts`
- Create: `src/lib/mcp/tools/users.ts`
- Modify: `src/lib/mcp/server.ts` (register the domain)
- Test: `src/__tests__/mcp/tools-users.test.ts`

**Interfaces:**
- Consumes: `getUsers`, `setUserRole`, `setSellerAccess`, `removeUser` (`@/lib/admin/core/users`); `getAllowlist`, `addToAllowlist`, `removeFromAllowlist` (`@/lib/admin/core/allowlist`); `getUserAnalytics` (`@/lib/admin/core/analytics`); `requireConfirmation`; `_shared.ts`.
- Produces:
  - `interface UserDetail { owner_links: { owner_identifier: string; source: string; updated_at: string }[]; listings: { id: string; title: string | null; status: string }[]; alerts: { id: string; name: string | null; notify_enabled: boolean; created_at: string }[]; favorites: { listing_id: string; created_at: string }[] }`
  - `function userDetail(userId: string): Promise<UserDetail>`
  - `function registerUserTools(server: McpServer, ctx: McpToolContext): void`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/mcp/tools-users.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const core = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  getUsers: vi.fn(),
  setUserRole: vi.fn(),
  setSellerAccess: vi.fn(),
  removeUser: vi.fn(),
  getAllowlist: vi.fn(),
  addToAllowlist: vi.fn(),
  removeFromAllowlist: vi.fn(),
  getUserAnalytics: vi.fn(),
  getAnalyticsSummary: vi.fn(),
  getLoginTrend: vi.fn(),
  userDetail: vi.fn(),
  getAllListings: vi.fn(),
  queryAdminListing: vi.fn(),
  listingExtras: vi.fn(),
  marketplaceOverview: vi.fn(),
  getRecentActivity: vi.fn(),
  listAuditLog: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead: core.recordMcpRead }))
vi.mock("@/lib/admin/core/users", () => ({
  getUsers: core.getUsers,
  setUserRole: core.setUserRole,
  setSellerAccess: core.setSellerAccess,
  removeUser: core.removeUser,
}))
vi.mock("@/lib/admin/core/allowlist", () => ({
  getAllowlist: core.getAllowlist,
  addToAllowlist: core.addToAllowlist,
  removeFromAllowlist: core.removeFromAllowlist,
}))
vi.mock("@/lib/admin/core/analytics", () => ({
  getUserAnalytics: core.getUserAnalytics,
  getAnalyticsSummary: core.getAnalyticsSummary,
  getLoginTrend: core.getLoginTrend,
}))
vi.mock("@/lib/mcp/queries/users", () => ({ userDetail: core.userDetail }))
vi.mock("@/lib/admin/core/listings", () => ({
  getAllListings: core.getAllListings,
  approveListing: vi.fn(),
  rejectListing: vi.fn(),
  adminUpdateListing: vi.fn(),
  adminMarkSold: vi.fn(),
}))
vi.mock("@/lib/listings/load-listing", () => ({ queryAdminListing: core.queryAdminListing }))
vi.mock("@/lib/mcp/queries/listings", () => ({ listingExtras: core.listingExtras }))
vi.mock("@/lib/mcp/queries/overview", () => ({ marketplaceOverview: core.marketplaceOverview }))
vi.mock("@/lib/mcp/queries/audit", () => ({ listAuditLog: core.listAuditLog }))
vi.mock("@/lib/admin/activity", () => ({ getRecentActivity: core.getRecentActivity }))

import { mcpTestClient } from "../../../test/helpers/mcp-harness"
import { __resetRateLimits } from "@/lib/rate-limit"

const ACTOR = { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" }

function userRow(over: Record<string, unknown> = {}) {
  return {
    id: "u-2",
    name: "Dana",
    email: "dana@example.com",
    role: "user",
    sellerAccess: false,
    loginCount: 4,
    lastLoginAt: new Date("2026-09-10T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...over,
  }
}

beforeEach(() => {
  __resetRateLimits()
  for (const fn of Object.values(core)) fn.mockReset()
  core.recordMcpRead.mockResolvedValue("audit-read")
  core.getUsers.mockResolvedValue([userRow(), userRow({ id: "u-1", role: "admin", name: "Parker" })])
  core.getAllowlist.mockResolvedValue([
    { id: "al-1", email: "@partnerbrand.com", addedBy: "u-1", addedAt: new Date("2026-05-01T00:00:00.000Z") },
  ])
  core.getUserAnalytics.mockResolvedValue([
    {
      id: "u-2",
      name: "Dana",
      email: "dana@example.com",
      role: "user",
      loginCount: 4,
      lastLoginAt: new Date("2026-09-10T00:00:00.000Z"),
      listingsPosted: 1,
      reachOutsSent: 2,
      inquiriesReceived: 0,
      savesMade: 3,
      spark: [0, 1],
    },
  ])
  core.userDetail.mockResolvedValue({
    owner_links: [],
    listings: [],
    alerts: [],
    favorites: [],
  })
  core.setUserRole.mockResolvedValue({ auditId: "aud-role" })
  core.setSellerAccess.mockResolvedValue({ auditId: "aud-seller" })
  core.removeUser.mockResolvedValue({ auditId: "aud-remove" })
  core.addToAllowlist.mockResolvedValue({ ok: true, auditId: "aud-allow" })
  core.removeFromAllowlist.mockResolvedValue({ auditId: "aud-unallow" })
})

describe("list_users", () => {
  it("projects the roster and never leaks a password-ish field", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_users", arguments: {} })
    const items = (r.structuredContent as { items: Record<string, unknown>[] }).items
    expect(items[0]).toEqual({
      id: "u-2",
      name: "Dana",
      email: "dana@example.com",
      role: "user",
      seller_access: false,
      login_count: 4,
      last_login_at: "2026-09-10T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
    })
    await close()
  })

  it("filters by role and by search across name and email", async () => {
    const { client, close } = await mcpTestClient()
    const byRole = await client.callTool({ name: "list_users", arguments: { role: "admin" } })
    expect((byRole.structuredContent as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["u-1"])
    const bySearch = await client.callTool({ name: "list_users", arguments: { search: "dana@" } })
    expect((bySearch.structuredContent as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["u-2"])
    await close()
  })
})

describe("get_user", () => {
  it("merges the analytics row with the relationship detail", async () => {
    core.userDetail.mockResolvedValue({
      owner_links: [{ owner_identifier: "Austin LLC", source: "manual", updated_at: "2026-07-01T00:00:00.000Z" }],
      listings: [{ id: "l-1", title: "Aspen", status: "active" }],
      alerts: [{ id: "a-1", name: "CO suites", notify_enabled: true, created_at: "2026-06-01T00:00:00.000Z" }],
      favorites: [{ listing_id: "l-9", created_at: "2026-06-02T00:00:00.000Z" }],
    })
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "get_user", arguments: { user_id: "u-2" } })
    const body = r.structuredContent as Record<string, any>
    expect(body.user).toMatchObject({ id: "u-2", role: "user", seller_access: false })
    expect(body.activity).toMatchObject({ listings_posted: 1, reach_outs_sent: 2, saves_made: 3 })
    expect(body.owner_links[0].owner_identifier).toBe("Austin LLC")
    expect(body.listings[0].id).toBe("l-1")
    expect(body.alerts[0].id).toBe("a-1")
    expect(body.favorites[0].listing_id).toBe("l-9")
    await close()
  })

  it("refuses an unknown user id with a clear message", async () => {
    core.getUsers.mockResolvedValue([])
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "get_user", arguments: { user_id: "ghost" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("User not found")
    await close()
  })
})

describe("list_allowlist", () => {
  it("labels a domain entry so the model can tell it from an address", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_allowlist", arguments: {} })
    expect((r.structuredContent as { items: Record<string, unknown>[] }).items[0]).toEqual({
      id: "al-1",
      email: "@partnerbrand.com",
      kind: "domain",
      added_by: "u-1",
      added_at: "2026-05-01T00:00:00.000Z",
    })
    await close()
  })
})

describe("set_seller_access (non-destructive)", () => {
  it("executes immediately and returns the post-write user", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "set_seller_access",
      arguments: { user_id: "u-2", seller_access: true },
    })
    expect(core.setSellerAccess).toHaveBeenCalledWith(ACTOR, "u-2", true)
    expect((r.structuredContent as { audit_id: string }).audit_id).toBe("aud-seller")
    await close()
  })
})

describe("add_to_allowlist (non-destructive, ok/error contract)", () => {
  it("turns { ok: false } into an isError result", async () => {
    core.addToAllowlist.mockResolvedValue({ ok: false, error: "Domain already in allowlist" })
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "add_to_allowlist", arguments: { entry: "@brand.com" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Domain already in allowlist")
    await close()
  })

  it("returns the audit id on success", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "add_to_allowlist", arguments: { entry: "jane@brand.com" } })
    expect(core.addToAllowlist).toHaveBeenCalledWith(ACTOR, "jane@brand.com")
    expect((r.structuredContent as { audit_id: string }).audit_id).toBe("aud-allow")
    await close()
  })
})

describe("set_user_role (destructive)", () => {
  it("previews before demoting", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "set_user_role",
      arguments: { user_id: "u-2", role: "admin" },
    })
    expect((r.structuredContent as { preview: string }).preview).toContain("Dana")
    expect((r.structuredContent as { preview: string }).preview).toContain("admin")
    expect(core.setUserRole).not.toHaveBeenCalled()
    await close()
  })

  it("executes with a matching token", async () => {
    const { client, close } = await mcpTestClient()
    const args = { user_id: "u-2", role: "admin" as const }
    const preview = await client.callTool({ name: "set_user_role", arguments: args })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    await client.callTool({ name: "set_user_role", arguments: { ...args, confirmation_token: token } })
    expect(core.setUserRole).toHaveBeenCalledWith(ACTOR, "u-2", "admin")
    await close()
  })

  it("surfaces the last-admin refusal from the core verbatim", async () => {
    core.setUserRole.mockRejectedValue(new Error("Cannot demote the last admin"))
    const { client, close } = await mcpTestClient()
    const args = { user_id: "u-1", role: "user" as const }
    const preview = await client.callTool({ name: "set_user_role", arguments: args })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const r = await client.callTool({
      name: "set_user_role",
      arguments: { ...args, confirmation_token: token },
    })
    expect((r.content[0] as { text: string }).text).toBe("Cannot demote the last admin")
    await close()
  })
})

describe("remove_user (destructive)", () => {
  it("refuses self-removal at the pre-check, before any token is minted", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "remove_user", arguments: { user_id: "u-1" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Cannot remove yourself")
    expect(r.structuredContent).not.toHaveProperty("confirmation_token")
    await close()
  })

  it("warns in the preview that the user's listings cascade away", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "remove_user", arguments: { user_id: "u-2" } })
    const preview = (r.structuredContent as { preview: string }).preview
    expect(preview).toContain("dana@example.com")
    expect(preview).toMatch(/listings|cascade|permanently/i)
    await close()
  })

  it("returns a deleted target after executing", async () => {
    const { client, close } = await mcpTestClient()
    const preview = await client.callTool({ name: "remove_user", arguments: { user_id: "u-2" } })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const r = await client.callTool({
      name: "remove_user",
      arguments: { user_id: "u-2", confirmation_token: token },
    })
    expect(core.removeUser).toHaveBeenCalledWith(ACTOR, "u-2")
    expect(r.structuredContent).toEqual({
      audit_id: "aud-remove",
      target: { type: "user", id: "u-2", deleted: true },
    })
    await close()
  })
})

describe("remove_from_allowlist (destructive)", () => {
  it("previews, then executes and reports a deleted target", async () => {
    const { client, close } = await mcpTestClient()
    const preview = await client.callTool({
      name: "remove_from_allowlist",
      arguments: { email: "@partnerbrand.com" },
    })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const r = await client.callTool({
      name: "remove_from_allowlist",
      arguments: { email: "@partnerbrand.com", confirmation_token: token },
    })
    expect(core.removeFromAllowlist).toHaveBeenCalledWith(ACTOR, "@partnerbrand.com")
    expect(r.structuredContent).toEqual({
      audit_id: "aud-unallow",
      target: { type: "allowlist", id: "@partnerbrand.com", deleted: true },
    })
    await close()
  })
})

describe("scope gating", () => {
  it("hides every user write tool from a read-only token", async () => {
    const { client, close } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(["list_users", "get_user", "list_allowlist"]))
    for (const w of [
      "set_user_role",
      "set_seller_access",
      "add_to_allowlist",
      "remove_from_allowlist",
      "remove_user",
    ]) {
      expect(names).not.toContain(w)
    }
    await close()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```
npx vitest run src/__tests__/mcp/tools-users.test.ts
```

Expected: FAIL — `@/lib/mcp/queries/users` and `@/lib/mcp/tools/users` do not resolve.

- [ ] **Step 3: Write the user-detail query**

Create `src/lib/mcp/queries/users.ts`:

```ts
// Everything hanging off one user, for the MCP `get_user` tool.
//
// NOT a use server module.
import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { listings } from "@/db/schema/listings"
import { alerts } from "@/db/schema/alerts"
import { favorites } from "@/db/schema/favorites"
import { userOwnerLinks } from "@/db/schema/userOwnerLinks"

const RELATION_LIMIT = 50

export interface UserDetail {
  owner_links: { owner_identifier: string; source: string; updated_at: string }[]
  listings: { id: string; title: string | null; status: string }[]
  alerts: { id: string; name: string | null; notify_enabled: boolean; created_at: string }[]
  favorites: { listing_id: string; created_at: string }[]
}

export async function userDetail(userId: string): Promise<UserDetail> {
  const [linkRows, listingRows, alertRows, favoriteRows] = await Promise.all([
    db
      .select({
        ownerIdentifier: userOwnerLinks.ownerIdentifier,
        source: userOwnerLinks.source,
        updatedAt: userOwnerLinks.updatedAt,
      })
      .from(userOwnerLinks)
      .where(eq(userOwnerLinks.userId, userId)),
    db
      .select({ id: listings.id, title: listings.title, status: listings.status })
      .from(listings)
      .where(eq(listings.sellerId, userId))
      .orderBy(desc(listings.createdAt))
      .limit(RELATION_LIMIT),
    db
      .select({
        id: alerts.id,
        name: alerts.name,
        notifyEnabled: alerts.notifyEnabled,
        createdAt: alerts.createdAt,
      })
      .from(alerts)
      .where(eq(alerts.userId, userId))
      .orderBy(desc(alerts.createdAt))
      .limit(RELATION_LIMIT),
    db
      .select({ listingId: favorites.listingId, createdAt: favorites.createdAt })
      .from(favorites)
      .where(eq(favorites.userId, userId))
      .orderBy(desc(favorites.createdAt))
      .limit(RELATION_LIMIT),
  ])

  return {
    owner_links: linkRows.map((r) => ({
      owner_identifier: r.ownerIdentifier,
      // "revoked" is a real source value, not an absence — surface it as-is so a
      // suppression is never invisible, exactly as the admin panel does.
      source: r.source,
      updated_at: r.updatedAt.toISOString(),
    })),
    listings: listingRows,
    alerts: alertRows.map((r) => ({
      id: r.id,
      name: r.name,
      notify_enabled: r.notifyEnabled,
      created_at: r.createdAt.toISOString(),
    })),
    favorites: favoriteRows.map((r) => ({
      listing_id: r.listingId,
      created_at: r.createdAt.toISOString(),
    })),
  }
}
```

- [ ] **Step 4: Write the user tools**

Create `src/lib/mcp/tools/users.ts`:

```ts
// User roster, allowlist, and the five account writes.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import { getUsers, setUserRole, setSellerAccess, removeUser } from "@/lib/admin/core/users"
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
          if (args.seller_access !== undefined && row.sellerAccess !== args.seller_access) return false
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
        const [analytics, detail] = await Promise.all([
          getUserAnalytics(),
          userDetail(args.user_id),
        ])
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
        // Cheap pre-check the core also enforces: refuse before minting a token.
        if (rest.user_id === ctx.actor.userId) throw new Error("Cannot remove yourself")
        const row = await loadUserOrThrow(rest.user_id)
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
```

- [ ] **Step 5: Register the domain**

In `src/lib/mcp/server.ts`, add the import:

```ts
import { registerUserTools } from "@/lib/mcp/tools/users"
```

and, inside `buildMcpServer` after `registerListingTools(server, ctx)`:

```ts
  registerUserTools(server, ctx)
```

- [ ] **Step 6: Run the tests to verify they pass**

```
npx vitest run src/__tests__/mcp
```

Expected: PASS.

- [ ] **Step 7: Type-check and lint**

```
npx tsc --noEmit
npx eslint src/lib/mcp
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp src/__tests__/mcp/tools-users.test.ts
git commit -F- <<'MSG'
feat(mcp): user roster, allowlist, and account write tools

list_users, get_user, list_allowlist plus set_user_role, set_seller_access,
add_to_allowlist, remove_from_allowlist and remove_user. add_to_allowlist keeps
the core's { ok: false } contract and converts it to a tool error; remove_user
refuses self-removal before a confirmation token is ever minted.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 7: Brand-request and inquiry tools

Spec §7.3's `list_brand_requests` / `get_brand_request` / `list_inquiries` and §7.4's three brand-request writes. `brand_requests` is co-written by the external competitor-monitor repo, so these reads go straight to the DB with **no caching of any kind**.

**Files:**
- Create: `src/lib/mcp/queries/brand-requests.ts`
- Create: `src/lib/mcp/tools/brand-requests.ts`
- Create: `src/lib/mcp/tools/inquiries.ts`
- Modify: `src/lib/mcp/server.ts` (register both domains)
- Test: `src/__tests__/mcp/tools-brand-requests.test.ts`

**Interfaces:**
- Consumes: `approveBrandRequest`, `rejectBrandRequest`, `retryMonitorDispatch` (`@/lib/admin/core/brand-requests`); `getInquiries` (`@/lib/admin/core/inquiries`); `brandRequests` (`@/db/schema/brandRequests`); `users` (`@/db/schema/auth`); `requireConfirmation`; `_shared.ts`.
- Produces:
  - `interface BrandRequestRow { id: string; brand_name: string; website_url: string; normalized_domain: string; status: string; note: string | null; known_city_state: string | null; submitted_by: { id: string | null; name: string | null; email: string | null }; decided_by: string | null; decided_at: string | null; reject_reason: string | null; brand_id: string | null; pr_url: string | null; issue_url: string | null; locations_found: number | null; error: string | null; created_at: string; updated_at: string }`
  - `function listBrandRequests(filters: { status?: string; search?: string; limit: number; cursor?: string }): Promise<{ items: BrandRequestRow[]; next_cursor: string | null }>`
  - `function getBrandRequestDetail(id: string): Promise<(BrandRequestRow & { recon: unknown }) | null>`
  - `function registerBrandRequestTools(server: McpServer, ctx: McpToolContext): void`
  - `function registerInquiryTools(server: McpServer, ctx: McpToolContext): void`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/mcp/tools-brand-requests.test.ts`. Reuse the same mock block shape as `tools-users.test.ts` (every module `buildMcpServer` pulls in must be mocked, or the real `@/db` is imported), then:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const core = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  listBrandRequests: vi.fn(),
  getBrandRequestDetail: vi.fn(),
  approveBrandRequest: vi.fn(),
  rejectBrandRequest: vi.fn(),
  retryMonitorDispatch: vi.fn(),
  getInquiries: vi.fn(),
  // Everything else buildMcpServer touches, stubbed so no real DB module loads.
  getUsers: vi.fn(), setUserRole: vi.fn(), setSellerAccess: vi.fn(), removeUser: vi.fn(),
  getAllowlist: vi.fn(), addToAllowlist: vi.fn(), removeFromAllowlist: vi.fn(),
  getUserAnalytics: vi.fn(), getAnalyticsSummary: vi.fn(), getLoginTrend: vi.fn(),
  userDetail: vi.fn(), getAllListings: vi.fn(), queryAdminListing: vi.fn(),
  listingExtras: vi.fn(), marketplaceOverview: vi.fn(), getRecentActivity: vi.fn(),
  listAuditLog: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead: core.recordMcpRead }))
vi.mock("@/lib/mcp/queries/brand-requests", () => ({
  listBrandRequests: core.listBrandRequests,
  getBrandRequestDetail: core.getBrandRequestDetail,
}))
vi.mock("@/lib/admin/core/brand-requests", () => ({
  approveBrandRequest: core.approveBrandRequest,
  rejectBrandRequest: core.rejectBrandRequest,
  retryMonitorDispatch: core.retryMonitorDispatch,
}))
vi.mock("@/lib/admin/core/inquiries", () => ({ getInquiries: core.getInquiries }))
vi.mock("@/lib/admin/core/users", () => ({
  getUsers: core.getUsers, setUserRole: core.setUserRole,
  setSellerAccess: core.setSellerAccess, removeUser: core.removeUser,
}))
vi.mock("@/lib/admin/core/allowlist", () => ({
  getAllowlist: core.getAllowlist, addToAllowlist: core.addToAllowlist,
  removeFromAllowlist: core.removeFromAllowlist,
}))
vi.mock("@/lib/admin/core/analytics", () => ({
  getUserAnalytics: core.getUserAnalytics, getAnalyticsSummary: core.getAnalyticsSummary,
  getLoginTrend: core.getLoginTrend,
}))
vi.mock("@/lib/mcp/queries/users", () => ({ userDetail: core.userDetail }))
vi.mock("@/lib/admin/core/listings", () => ({
  getAllListings: core.getAllListings, approveListing: vi.fn(), rejectListing: vi.fn(),
  adminUpdateListing: vi.fn(), adminMarkSold: vi.fn(),
}))
vi.mock("@/lib/listings/load-listing", () => ({ queryAdminListing: core.queryAdminListing }))
vi.mock("@/lib/mcp/queries/listings", () => ({ listingExtras: core.listingExtras }))
vi.mock("@/lib/mcp/queries/overview", () => ({ marketplaceOverview: core.marketplaceOverview }))
vi.mock("@/lib/mcp/queries/audit", () => ({ listAuditLog: core.listAuditLog }))
vi.mock("@/lib/admin/activity", () => ({ getRecentActivity: core.getRecentActivity }))

import { mcpTestClient } from "../../../test/helpers/mcp-harness"
import { __resetRateLimits } from "@/lib/rate-limit"

const ACTOR = { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" }

const REQUEST = {
  id: "br-1",
  brand_name: "Waxing Co",
  website_url: "https://waxing.co",
  normalized_domain: "waxing.co",
  status: "recon_complete",
  note: null,
  known_city_state: "Denver, CO",
  submitted_by: { id: "u-2", name: "Dana", email: "dana@example.com" },
  decided_by: null,
  decided_at: null,
  reject_reason: null,
  brand_id: null,
  pr_url: null,
  issue_url: null,
  locations_found: 41,
  error: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-02T00:00:00.000Z",
}

beforeEach(() => {
  __resetRateLimits()
  for (const fn of Object.values(core)) fn.mockReset()
  core.recordMcpRead.mockResolvedValue("audit-read")
  core.listBrandRequests.mockResolvedValue({ items: [REQUEST], next_cursor: null })
  core.getBrandRequestDetail.mockResolvedValue({ ...REQUEST, recon: { estimatedCost: 12 } })
  core.approveBrandRequest.mockResolvedValue({ success: true, dispatched: true, auditId: "aud-approve" })
  core.rejectBrandRequest.mockResolvedValue({ success: true, auditId: "aud-reject" })
  core.retryMonitorDispatch.mockResolvedValue({ success: true, auditId: "aud-retry" })
  core.getInquiries.mockResolvedValue([
    {
      id: "c-1",
      message: "Interested",
      buyerName: "Sam",
      buyerEmail: "sam@example.com",
      buyerPhone: null,
      createdAt: new Date("2026-09-10T00:00:00.000Z"),
      listingId: "l-1",
      listingTitle: "Aspen",
      listingLocationName: "Aspen Highlands",
      listingCity: "Aspen",
      listingState: "CO",
      sellerName: "Dana",
      sellerEmail: "dana@example.com",
    },
  ])
})

describe("list_brand_requests", () => {
  it("passes the status and search filters through", async () => {
    const { client, close } = await mcpTestClient()
    await client.callTool({
      name: "list_brand_requests",
      arguments: { status: "recon_complete", search: "wax", limit: 10 },
    })
    expect(core.listBrandRequests).toHaveBeenCalledWith({
      status: "recon_complete",
      search: "wax",
      limit: 10,
      cursor: undefined,
    })
    await close()
  })

  it("returns the query page unchanged", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_brand_requests", arguments: {} })
    expect(r.structuredContent).toEqual({ items: [REQUEST], next_cursor: null })
    await close()
  })
})

describe("get_brand_request", () => {
  it("includes the recon payload", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "get_brand_request", arguments: { request_id: "br-1" } })
    expect((r.structuredContent as { recon: unknown }).recon).toEqual({ estimatedCost: 12 })
    await close()
  })

  it("refuses an unknown id", async () => {
    core.getBrandRequestDetail.mockResolvedValue(null)
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "get_brand_request", arguments: { request_id: "x" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Request not found")
    await close()
  })
})

describe("approve_brand_request (non-destructive)", () => {
  it("executes immediately and reports whether the monitor handoff fired", async () => {
    core.approveBrandRequest.mockResolvedValue({ success: true, dispatched: false, auditId: "aud-approve" })
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "approve_brand_request",
      arguments: { request_id: "br-1" },
    })
    expect(core.approveBrandRequest).toHaveBeenCalledWith(ACTOR, "br-1", { withoutRecon: undefined })
    const body = r.structuredContent as Record<string, any>
    expect(body.audit_id).toBe("aud-approve")
    expect(body.dispatched).toBe(false)
    expect(body.next_step).toMatch(/retry_brand_request_dispatch/)
    await close()
  })

  it("forwards the without_recon override", async () => {
    const { client, close } = await mcpTestClient()
    await client.callTool({
      name: "approve_brand_request",
      arguments: { request_id: "br-1", without_recon: true },
    })
    expect(core.approveBrandRequest).toHaveBeenCalledWith(ACTOR, "br-1", { withoutRecon: true })
    await close()
  })

  it("surfaces the core's recon-not-complete refusal", async () => {
    core.approveBrandRequest.mockRejectedValue(
      new Error("Recon has not completed yet. Wait for the cost estimate or approve without recon."),
    )
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "approve_brand_request", arguments: { request_id: "br-1" } })
    expect((r.content[0] as { text: string }).text).toMatch(/^Recon has not completed yet\./)
    await close()
  })
})

describe("reject_brand_request (destructive)", () => {
  it("previews with the brand name and the reason, then executes", async () => {
    const { client, close } = await mcpTestClient()
    const args = { request_id: "br-1", reason: "Already covered by an existing brand" }
    const preview = await client.callTool({ name: "reject_brand_request", arguments: args })
    const body = preview.structuredContent as Record<string, any>
    expect(body.preview).toContain("Waxing Co")
    expect(body.preview).toContain("Already covered")
    expect(core.rejectBrandRequest).not.toHaveBeenCalled()

    const done = await client.callTool({
      name: "reject_brand_request",
      arguments: { ...args, confirmation_token: body.confirmation_token },
    })
    expect(core.rejectBrandRequest).toHaveBeenCalledWith(ACTOR, "br-1", args.reason)
    expect((done.structuredContent as { audit_id: string }).audit_id).toBe("aud-reject")
    await close()
  })

  it("refuses a reason over 500 characters, matching the core's own cap", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "reject_brand_request",
      arguments: { request_id: "br-1", reason: "x".repeat(501) },
    })
    expect(r.isError).toBe(true)
    expect(core.getBrandRequestDetail).not.toHaveBeenCalled()
    await close()
  })
})

describe("retry_brand_request_dispatch (non-destructive)", () => {
  it("forwards the kind and returns the audit id", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "retry_brand_request_dispatch",
      arguments: { request_id: "br-1", kind: "build" },
    })
    expect(core.retryMonitorDispatch).toHaveBeenCalledWith(ACTOR, "br-1", "build")
    expect((r.structuredContent as { audit_id: string }).audit_id).toBe("aud-retry")
    await close()
  })

  it("rejects a kind outside recon/build at the schema", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "retry_brand_request_dispatch",
      arguments: { request_id: "br-1", kind: "deploy" },
    })
    expect(r.isError).toBe(true)
    expect(core.retryMonitorDispatch).not.toHaveBeenCalled()
    await close()
  })
})

describe("list_inquiries", () => {
  it("projects an inquiry with its listing and seller context", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_inquiries", arguments: {} })
    expect((r.structuredContent as { items: Record<string, unknown>[] }).items[0]).toEqual({
      id: "c-1",
      at: "2026-09-10T00:00:00.000Z",
      message: "Interested",
      buyer: { name: "Sam", email: "sam@example.com", phone: null },
      listing: { id: "l-1", title: "Aspen", location: "Aspen Highlands", city: "Aspen", state: "CO" },
      seller: { name: "Dana", email: "dana@example.com" },
    })
    await close()
  })

  it("filters by listing id and by since", async () => {
    core.getInquiries.mockResolvedValue([
      { id: "old", createdAt: new Date("2026-01-01T00:00:00.000Z"), listingId: "l-1", message: null, buyerName: null, buyerEmail: null, buyerPhone: null, listingTitle: null, listingLocationName: null, listingCity: null, listingState: null, sellerName: null, sellerEmail: null },
      { id: "new", createdAt: new Date("2026-09-10T00:00:00.000Z"), listingId: "l-2", message: null, buyerName: null, buyerEmail: null, buyerPhone: null, listingTitle: null, listingLocationName: null, listingCity: null, listingState: null, sellerName: null, sellerEmail: null },
    ])
    const { client, close } = await mcpTestClient()
    const byListing = await client.callTool({ name: "list_inquiries", arguments: { listing_id: "l-2" } })
    expect((byListing.structuredContent as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["new"])
    const bySince = await client.callTool({
      name: "list_inquiries",
      arguments: { since: "2026-06-01T00:00:00.000Z" },
    })
    expect((bySince.structuredContent as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["new"])
    await close()
  })
})

describe("scope gating", () => {
  it("hides the brand-request writes from a read-only token", async () => {
    const { client, close } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining(["list_brand_requests", "get_brand_request", "list_inquiries"]),
    )
    for (const w of ["approve_brand_request", "reject_brand_request", "retry_brand_request_dispatch"]) {
      expect(names).not.toContain(w)
    }
    await close()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```
npx vitest run src/__tests__/mcp/tools-brand-requests.test.ts
```

Expected: FAIL — the brand-request query and tool modules do not resolve.

- [ ] **Step 3: Write the brand-request query**

Create `src/lib/mcp/queries/brand-requests.ts`:

```ts
// Direct reads of brand_requests for the MCP.
//
// NOT a use server module.
//
// NEVER CACHE THESE. The external Hello-Brands/competitor-monitor repo writes this
// table directly (status, recon, brand_id, pr_url, locations_found, error) with no
// callback into this app, so any cached copy would show an admin a stale pipeline
// state and invite a duplicate approval. Plain queries, every call.
import { and, desc, eq, ilike, lt, or, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { brandRequests } from "@/db/schema/brandRequests"
import { users } from "@/db/schema/auth"
import { encodeCursor, decodeCursor } from "@/lib/mcp/tools/_shared"

export interface BrandRequestRow {
  id: string
  brand_name: string
  website_url: string
  normalized_domain: string
  status: string
  note: string | null
  known_city_state: string | null
  submitted_by: { id: string | null; name: string | null; email: string | null }
  decided_by: string | null
  decided_at: string | null
  reject_reason: string | null
  brand_id: string | null
  pr_url: string | null
  issue_url: string | null
  locations_found: number | null
  error: string | null
  created_at: string
  updated_at: string
}

const columns = {
  id: brandRequests.id,
  brandName: brandRequests.brandName,
  websiteUrl: brandRequests.websiteUrl,
  normalizedDomain: brandRequests.normalizedDomain,
  status: brandRequests.status,
  note: brandRequests.note,
  knownCityState: brandRequests.knownCityState,
  submittedBy: brandRequests.submittedBy,
  submitterName: users.name,
  submitterEmail: users.email,
  decidedBy: brandRequests.decidedBy,
  decidedAt: brandRequests.decidedAt,
  rejectReason: brandRequests.rejectReason,
  brandId: brandRequests.brandId,
  prUrl: brandRequests.prUrl,
  issueUrl: brandRequests.issueUrl,
  locationsFound: brandRequests.locationsFound,
  error: brandRequests.error,
  recon: brandRequests.recon,
  createdAt: brandRequests.createdAt,
  updatedAt: brandRequests.updatedAt,
}

function project(r: Record<string, any>): BrandRequestRow {
  return {
    id: r.id,
    brand_name: r.brandName,
    website_url: r.websiteUrl,
    normalized_domain: r.normalizedDomain,
    status: r.status,
    note: r.note,
    known_city_state: r.knownCityState,
    submitted_by: { id: r.submittedBy, name: r.submitterName, email: r.submitterEmail },
    decided_by: r.decidedBy,
    decided_at: r.decidedAt ? (r.decidedAt as Date).toISOString() : null,
    reject_reason: r.rejectReason,
    brand_id: r.brandId,
    pr_url: r.prUrl,
    issue_url: r.issueUrl,
    locations_found: r.locationsFound,
    error: r.error,
    created_at: (r.createdAt as Date).toISOString(),
    updated_at: (r.updatedAt as Date).toISOString(),
  }
}

export async function listBrandRequests(filters: {
  status?: string
  search?: string
  limit: number
  cursor?: string
}): Promise<{ items: BrandRequestRow[]; next_cursor: string | null }> {
  const conditions: SQL[] = []
  if (filters.status) conditions.push(eq(brandRequests.status, filters.status as never))
  if (filters.search) {
    const term = `%${filters.search.trim()}%`
    const matches = or(
      ilike(brandRequests.brandName, term),
      ilike(brandRequests.normalizedDomain, term),
    )
    if (matches) conditions.push(matches)
  }

  const cursor = decodeCursor(filters.cursor)
  if (cursor && typeof cursor.at === "string" && typeof cursor.id === "string") {
    const at = new Date(cursor.at)
    if (!Number.isNaN(at.getTime())) {
      const keyset = or(
        lt(brandRequests.createdAt, at),
        and(eq(brandRequests.createdAt, at), lt(brandRequests.id, cursor.id)),
      )
      if (keyset) conditions.push(keyset)
    }
  }

  const rows = (await db
    .select(columns)
    .from(brandRequests)
    .leftJoin(users, eq(users.id, brandRequests.submittedBy))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(brandRequests.createdAt), desc(brandRequests.id))
    .limit(filters.limit + 1)) as unknown as Record<string, any>[]

  const hasMore = rows.length > filters.limit
  const page = hasMore ? rows.slice(0, filters.limit) : rows
  const last = page[page.length - 1]

  return {
    items: page.map(project),
    next_cursor:
      hasMore && last
        ? encodeCursor({ at: (last.createdAt as Date).toISOString(), id: last.id })
        : null,
  }
}

export async function getBrandRequestDetail(
  id: string,
): Promise<(BrandRequestRow & { recon: unknown }) | null> {
  const rows = (await db
    .select(columns)
    .from(brandRequests)
    .leftJoin(users, eq(users.id, brandRequests.submittedBy))
    .where(eq(brandRequests.id, id))
    .limit(1)) as unknown as Record<string, any>[]

  const row = rows[0]
  if (!row) return null
  return { ...project(row), recon: row.recon ?? null }
}
```

- [ ] **Step 4: Write the brand-request tools**

Create `src/lib/mcp/tools/brand-requests.ts`:

```ts
// Competitor-brand request pipeline: reads plus the three admin decisions.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import {
  approveBrandRequest,
  rejectBrandRequest,
  retryMonitorDispatch,
} from "@/lib/admin/core/brand-requests"
import { listBrandRequests, getBrandRequestDetail } from "@/lib/mcp/queries/brand-requests"
import { requireConfirmation } from "@/lib/mcp/confirm"
import {
  DEFAULT_LIMIT,
  DESTRUCTIVE_ANNOTATIONS,
  READ_ANNOTATIONS,
  REQUIRES_USER_INTERACTION,
  WRITE_ANNOTATIONS,
  confirmationField,
  cursorField,
  limitField,
  readTool,
  searchField,
  writeTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

const BRAND_REQUEST_STATUSES = [
  "submitted",
  "recon_running",
  "recon_complete",
  "needs_human",
  "approved",
  "building",
  "live",
  "rejected",
] as const

const requestIdField = z.string().min(1).max(64).describe("The brand request's id.")

async function loadRequestOrThrow(id: string) {
  const row = await getBrandRequestDetail(id)
  if (!row) throw new Error("Request not found")
  return row
}

export function registerBrandRequestTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_brand_requests",
    {
      title: "List competitor brand requests",
      description:
        "Franchisee requests to start monitoring a competitor brand, newest first. The " +
        "pipeline runs submitted -> recon_running -> recon_complete -> approved -> building " +
        "-> live, with needs_human and rejected as side exits. Statuses after 'approved' are " +
        "written by the external competitor-monitor repo, so this always reads live data. " +
        "Returns { items, next_cursor }.",
      inputSchema: z.object({
        status: z.enum(BRAND_REQUEST_STATUSES).optional().describe("Only requests in this status."),
        search: searchField,
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_brand_requests", args, async () =>
        listBrandRequests({
          status: args.status,
          search: args.search,
          limit: args.limit ?? DEFAULT_LIMIT,
          cursor: args.cursor,
        }),
      ),
  )

  server.registerTool(
    "get_brand_request",
    {
      title: "Get competitor brand request",
      description:
        "One brand request in full, including the `recon` payload the monitor repo wrote " +
        "(location count, cost estimate), the PR and issue links once a build starts, and " +
        "the last dispatch error if a handoff failed.",
      inputSchema: z.object({ request_id: requestIdField }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "get_brand_request", args, async () => ({
        ...(await loadRequestOrThrow(args.request_id)),
      })),
  )

  if (!ctx.canWrite) return

  server.registerTool(
    "approve_brand_request",
    {
      title: "Approve competitor brand request",
      description:
        "Approve a request whose recon has completed and hand it to the competitor-monitor " +
        "repo to build. Set without_recon only when the brand is already known to be wanted " +
        "or recon is stuck. The approval is committed even if the handoff fails; the result's " +
        "`dispatched` says whether it fired, and retry_brand_request_dispatch re-fires it.",
      inputSchema: z.object({
        request_id: requestIdField,
        without_recon: z
          .boolean()
          .optional()
          .describe("Approve from submitted/recon_running/needs_human without waiting for recon."),
      }),
      annotations: WRITE_ANNOTATIONS,
    },
    async (args) =>
      writeTool(ctx, "approve_brand_request", args, async () => {
        const result = await approveBrandRequest(ctx.actor, args.request_id, {
          withoutRecon: args.without_recon,
        })
        return {
          audit_id: result.auditId,
          dispatched: result.dispatched,
          next_step: result.dispatched
            ? "The monitor repo has the build request."
            : 'Handoff failed. Call retry_brand_request_dispatch with kind "build".',
          target: await loadRequestOrThrow(args.request_id),
        }
      }),
  )

  server.registerTool(
    "reject_brand_request",
    {
      title: "Reject competitor brand request",
      description:
        "Reject a request with a reason the franchisee will read (max 500 characters). A " +
        "request that has already been approved or built can no longer be rejected. " +
        "DESTRUCTIVE: preview first, then re-send with confirmation_token.",
      inputSchema: z.object({
        request_id: requestIdField,
        // 500, not the shared 2000: rejectBrandRequest's own cap is 500 and a longer
        // string would be refused after the round trip instead of before it.
        reason: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .describe("Reason shown to the franchisee (max 500 characters)."),
        confirmation_token: confirmationField,
      }),
      annotations: DESTRUCTIVE_ANNOTATIONS,
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "reject_brand_request", args, async () => {
        const { confirmation_token, ...rest } = args
        const row = await loadRequestOrThrow(rest.request_id)
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "reject_brand_request",
          rest,
          confirmation_token,
          `Reject the request to monitor "${row.brand_name}" (${row.website_url}, currently ${row.status}) with reason "${rest.reason}". The franchisee sees the reason and can resubmit.`,
        )
        if (prompt) return { ...prompt }
        const result = await rejectBrandRequest(ctx.actor, rest.request_id, rest.reason)
        return { audit_id: result.auditId, target: await loadRequestOrThrow(rest.request_id) }
      }),
  )

  server.registerTool(
    "retry_brand_request_dispatch",
    {
      title: "Retry monitor dispatch",
      description:
        'Re-fire a GitHub handoff to the competitor-monitor repo. Use kind "recon" for a ' +
        'request stuck in submitted or recon_running, and kind "build" for one stuck in ' +
        "approved or building. Refused from any other status so a retry cannot restart a " +
        "stage the pipeline already passed.",
      inputSchema: z.object({
        request_id: requestIdField,
        kind: z.enum(["recon", "build"]).describe("Which pipeline stage to re-dispatch."),
      }),
      annotations: WRITE_ANNOTATIONS,
    },
    async (args) =>
      writeTool(ctx, "retry_brand_request_dispatch", args, async () => {
        const result = await retryMonitorDispatch(ctx.actor, args.request_id, args.kind)
        return { audit_id: result.auditId, target: await loadRequestOrThrow(args.request_id) }
      }),
  )
}
```

- [ ] **Step 5: Write the inquiry tool**

Create `src/lib/mcp/tools/inquiries.ts`:

```ts
// Buyer inquiries (the `contacts` table) — read only; the MCP never writes one.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import { getInquiries } from "@/lib/admin/core/inquiries"
import {
  READ_ANNOTATIONS,
  cursorField,
  limitField,
  paginateArray,
  readTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

type InquiryRow = {
  id: string
  message: string | null
  buyerName: string | null
  buyerEmail: string | null
  buyerPhone: string | null
  createdAt: Date
  listingId: string
  listingTitle: string | null
  listingLocationName: string | null
  listingCity: string | null
  listingState: string | null
  sellerName: string | null
  sellerEmail: string | null
}

export function registerInquiryTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_inquiries",
    {
      title: "List buyer inquiries",
      description:
        "Buyer reach-outs on listings, newest first, with the buyer's contact details, the " +
        "listing they asked about and that listing's seller. Narrow to one listing with " +
        "listing_id, or to a time window with since. Returns { items, next_cursor }. " +
        "The underlying admin read returns the 100 most recent inquiries.",
      inputSchema: z.object({
        listing_id: z.string().max(64).optional().describe("Only inquiries on this listing."),
        since: z.iso
          .datetime()
          .optional()
          .describe("ISO 8601 timestamp; only inquiries at or after this moment."),
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_inquiries", args, async () => {
        const rows = (await getInquiries()) as InquiryRow[]
        const since = args.since ? new Date(args.since) : null
        const filtered = rows.filter((row) => {
          if (args.listing_id && row.listingId !== args.listing_id) return false
          if (since && row.createdAt < since) return false
          return true
        })
        const page = paginateArray(filtered, args.limit, args.cursor)
        return {
          items: page.items.map((r) => ({
            id: r.id,
            at: r.createdAt.toISOString(),
            message: r.message,
            buyer: { name: r.buyerName, email: r.buyerEmail, phone: r.buyerPhone },
            listing: {
              id: r.listingId,
              title: r.listingTitle,
              location: r.listingLocationName,
              city: r.listingCity,
              state: r.listingState,
            },
            seller: { name: r.sellerName, email: r.sellerEmail },
          })),
          next_cursor: page.next_cursor,
        }
      }),
  )
}
```

- [ ] **Step 6: Register both domains**

In `src/lib/mcp/server.ts`, add:

```ts
import { registerBrandRequestTools } from "@/lib/mcp/tools/brand-requests"
import { registerInquiryTools } from "@/lib/mcp/tools/inquiries"
```

and, inside `buildMcpServer` after `registerUserTools(server, ctx)`:

```ts
  registerBrandRequestTools(server, ctx)
  registerInquiryTools(server, ctx)
```

- [ ] **Step 7: Run the tests to verify they pass**

```
npx vitest run src/__tests__/mcp
```

Expected: PASS.

- [ ] **Step 8: Type-check and lint**

```
npx tsc --noEmit
npx eslint src/lib/mcp
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/mcp src/__tests__/mcp/tools-brand-requests.test.ts
git commit -F- <<'MSG'
feat(mcp): brand-request pipeline and buyer-inquiry tools

list_brand_requests, get_brand_request, list_inquiries plus approve, reject and
retry-dispatch. Brand-request reads go straight to the DB with no caching: the
external competitor-monitor repo writes that table and never calls back.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 8: Owner-directory and data-mapping tools

Spec §7.3's `list_owner_directory`, `list_owner_links` and `list_unresolved_data_mappings`, plus §7.4's `add_owner_link`, `revoke_owner_link`, `clear_owner_link`, `refresh_owner_directory` and `set_location_data_mapping`.

Like `loadAdminListing`, `getOwnerDirectory` and `listUsersWithLinks` guard themselves with a cookie-backed `auth()` call, which an MCP request can never satisfy. The queries underneath are extracted and exported; the guarded exports keep their names, their signatures and their guard, and simply delegate.

**Files:**
- Modify: `src/lib/owner-directory/data.ts` (add `queryOwnerDirectory`, `queryUsersWithLinks`; existing exports delegate)
- Create: `src/lib/mcp/queries/data-mappings.ts`
- Create: `src/lib/mcp/tools/owner.ts`
- Create: `src/lib/mcp/tools/data.ts`
- Modify: `src/lib/mcp/server.ts` (register both domains)
- Test: `src/__tests__/mcp/tools-owner.test.ts`
- Test: `src/__tests__/mcp/tools-data.test.ts`

**Interfaces:**
- Consumes: `addOwnerLink`, `revokeOwnerLink`, `clearOwnerLink` (`@/lib/admin/core/owner-links`); `refreshOwnerDirectory` (`@/lib/admin/core/owner-directory`); `setLocationMapping` (`@/lib/admin/core/data-mappings`); `unresolvedSalonLocations` (`@/lib/data/mapping`); `suggestLocationMatch` (`@/lib/data/match`); `listLocationNames` (`@/lib/bigquery/queries`); `requireConfirmation`; `_shared.ts`.
- Produces:
  - `function queryOwnerDirectory(search?: string): Promise<OwnerLocation[]>` (in `owner-directory/data.ts`)
  - `function queryUsersWithLinks(): Promise<AdminUserRow[]>` (same file)
  - `interface UnresolvedMapping { location_id: string; location_name: string; listing: { id: string; title: string | null; status: string } | null; status: string; current_bq_location_name: string | null; suggestion: { bq_location_name: string; confidence: number } | null }`
  - `function unresolvedMappings(): Promise<{ items: UnresolvedMapping[]; bq_configured: boolean }>`
  - `function registerOwnerTools(server: McpServer, ctx: McpToolContext): void`
  - `function registerDataTools(server: McpServer, ctx: McpToolContext): void`

- [ ] **Step 1: Extract the session-free owner-directory queries**

In `src/lib/owner-directory/data.ts`, add the two exported queries and make the guarded functions delegate. `requireAdminSession` and `getMyOwnerLocations` are untouched.

Replace the body of `getOwnerDirectory` and `listUsersWithLinks` with:

```ts
/**
 * The full owner directory, optionally filtered — WITHOUT a session check.
 *
 * Exported so the MCP endpoint can read it: that request carries a bearer token,
 * not an Auth.js cookie, so `requireAdminSession()` would always throw there. The
 * MCP's own admin check happens in `verifyMcpToken`, which re-reads the user row and
 * refuses anyone who is not `role === "admin"` on every single call.
 *
 * Every caller of this function MUST have established admin authority first.
 */
export async function queryOwnerDirectory(search?: string): Promise<OwnerLocation[]> {
  const term = search?.trim()
  const where: SQL | undefined = term
    ? or(
        ilike(ownerLocations.ownerIdentifier, `%${term}%`),
        ilike(ownerLocations.ownerName, `%${term}%`),
        ilike(ownerLocations.ownerContactEmail, `%${term}%`),
        ilike(ownerLocations.blvdLocationName, `%${term}%`)
      )
    : undefined

  return db
    .select()
    .from(ownerLocations)
    .where(where)
    .orderBy(asc(ownerLocations.ownerIdentifier), asc(ownerLocations.blvdLocationName))
}

/** Admin-only: the full directory, optionally filtered by a search term. */
export async function getOwnerDirectory(search?: string): Promise<OwnerLocation[]> {
  await requireAdminSession()
  return queryOwnerDirectory(search)
}

/**
 * Every user with all their owner links (including revoked ones) — WITHOUT a session
 * check. Same rule as queryOwnerDirectory: the caller establishes admin authority.
 */
export async function queryUsersWithLinks(): Promise<AdminUserRow[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      ownerIdentifier: userOwnerLinks.ownerIdentifier,
      source: userOwnerLinks.source,
    })
    .from(users)
    .leftJoin(userOwnerLinks, eq(userOwnerLinks.userId, users.id))
    .orderBy(asc(users.email), asc(userOwnerLinks.ownerIdentifier))
  return groupUserLinkRows(rows)
}

/**
 * Admin-only: every user with all their owner links (including revoked ones,
 * which the panel shows so a suppression is never invisible).
 *
 * Deliberately does NOT join owner_locations for the display name: that table
 * has many rows per identifier, so the join would need a distinct/aggregate.
 * The admin component already receives the owner list from listLinkableOwners
 * and resolves names — and "not in the list" is exactly the orphaned-link case
 * it needs to surface.
 */
export async function listUsersWithLinks(): Promise<AdminUserRow[]> {
  await requireAdminSession()
  return queryUsersWithLinks()
}
```

Leave the `import "server-only"` line at the top of that file in place — it is a Next-only marker that vitest and the MCP route both resolve fine, and removing it would weaken the existing module.

- [ ] **Step 2: Run the existing owner-directory suite to prove the extraction is behaviour-neutral**

```
npx vitest run src/__tests__/owner-directory
```

Expected: PASS unchanged — the guarded exports still call `requireAdminSession()` first and return the same rows.

- [ ] **Step 3: Write the failing owner-tools test**

Create `src/__tests__/mcp/tools-owner.test.ts`. Use the same full mock block as `tools-brand-requests.test.ts` (every module `buildMcpServer` imports must be mocked) plus:

```ts
vi.mock("@/lib/owner-directory/data", () => ({
  queryOwnerDirectory: core.queryOwnerDirectory,
  queryUsersWithLinks: core.queryUsersWithLinks,
}))
vi.mock("@/lib/admin/core/owner-links", () => ({
  addOwnerLink: core.addOwnerLink,
  revokeOwnerLink: core.revokeOwnerLink,
  clearOwnerLink: core.clearOwnerLink,
}))
vi.mock("@/lib/admin/core/owner-directory", () => ({
  refreshOwnerDirectory: core.refreshOwnerDirectory,
}))
```

and these cases:

```ts
const ACTOR = { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" }

beforeEach(() => {
  core.queryOwnerDirectory.mockResolvedValue([
    {
      id: "ol-1",
      ownerIdentifier: "Austin LLC",
      ownerName: "Austin Holdings",
      ownerContactEmail: "austin@example.com",
      blvdLocationName: "Hello Sugar Austin South",
      blvdLocationNumber: "284",
      locationAddress: "1 Main St, Austin TX",
      resolvedBqLocationName: "Austin South",
      blvdMatchMethod: "exact",
      blvdMatchConfidence: "high",
      syncedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  ])
  core.queryUsersWithLinks.mockResolvedValue([
    {
      id: "u-2",
      name: "Dana",
      email: "dana@example.com",
      links: [{ ownerIdentifier: "Austin LLC", source: "manual" }],
    },
  ])
  core.addOwnerLink.mockResolvedValue({ ok: true, auditId: "aud-add" })
  core.revokeOwnerLink.mockResolvedValue({ ok: true, auditId: "aud-revoke" })
  core.clearOwnerLink.mockResolvedValue({ ok: true, auditId: "aud-clear" })
  core.refreshOwnerDirectory.mockResolvedValue({
    ok: true,
    result: { inserted: 3, updated: 2, deleted: 0 },
    auditId: "aud-refresh",
  })
})

describe("list_owner_directory", () => {
  it("passes the search term through and projects the row", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_owner_directory", arguments: { search: "austin" } })
    expect(core.queryOwnerDirectory).toHaveBeenCalledWith("austin")
    expect((r.structuredContent as { items: Record<string, unknown>[] }).items[0]).toEqual({
      id: "ol-1",
      owner_identifier: "Austin LLC",
      owner_name: "Austin Holdings",
      owner_contact_email: "austin@example.com",
      location_name: "Hello Sugar Austin South",
      location_number: "284",
      location_address: "1 Main St, Austin TX",
      resolved_bq_location_name: "Austin South",
      match_method: "exact",
      match_confidence: "high",
      synced_at: "2026-09-01T00:00:00.000Z",
    })
    await close()
  })
})

describe("list_owner_links", () => {
  it("returns each user with every link, revoked ones included", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_owner_links", arguments: {} })
    expect((r.structuredContent as { items: Record<string, any>[] }).items[0]).toEqual({
      id: "u-2",
      name: "Dana",
      email: "dana@example.com",
      links: [{ owner_identifier: "Austin LLC", source: "manual" }],
    })
    await close()
  })

  it("filters to one user id", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_owner_links", arguments: { user_id: "nobody" } })
    expect((r.structuredContent as { items: unknown[] }).items).toEqual([])
    await close()
  })
})

describe("add_owner_link (non-destructive)", () => {
  it("executes immediately", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "add_owner_link",
      arguments: { user_id: "u-2", owner_identifier: "Austin LLC" },
    })
    expect(core.addOwnerLink).toHaveBeenCalledWith(ACTOR, "u-2", "Austin LLC")
    expect((r.structuredContent as { audit_id: string }).audit_id).toBe("aud-add")
    await close()
  })

  it("turns the core's { ok: false } into a tool error", async () => {
    core.addOwnerLink.mockResolvedValue({ ok: false, error: "Unknown owner_identifier: Nope" })
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "add_owner_link",
      arguments: { user_id: "u-2", owner_identifier: "Nope" },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Unknown owner_identifier: Nope")
    await close()
  })
})

describe("revoke_owner_link / clear_owner_link (destructive)", () => {
  it("revoke previews, then executes", async () => {
    const { client, close } = await mcpTestClient()
    const args = { user_id: "u-2", owner_identifier: "Austin LLC" }
    const preview = await client.callTool({ name: "revoke_owner_link", arguments: args })
    const body = preview.structuredContent as Record<string, any>
    expect(body.preview).toContain("Austin LLC")
    expect(core.revokeOwnerLink).not.toHaveBeenCalled()
    await client.callTool({
      name: "revoke_owner_link",
      arguments: { ...args, confirmation_token: body.confirmation_token },
    })
    expect(core.revokeOwnerLink).toHaveBeenCalledWith(ACTOR, "u-2", "Austin LLC")
    await close()
  })

  it("clear explains that automatic re-linking becomes possible again", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "clear_owner_link",
      arguments: { user_id: "u-2", owner_identifier: "Austin LLC" },
    })
    expect((r.structuredContent as { preview: string }).preview).toMatch(/re-?link|next login/i)
    await close()
  })

  it("a revoke token cannot execute a clear", async () => {
    const { client, close } = await mcpTestClient()
    const args = { user_id: "u-2", owner_identifier: "Austin LLC" }
    const preview = await client.callTool({ name: "revoke_owner_link", arguments: args })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const r = await client.callTool({
      name: "clear_owner_link",
      arguments: { ...args, confirmation_token: token },
    })
    expect(r.isError).toBe(true)
    expect(core.clearOwnerLink).not.toHaveBeenCalled()
    await close()
  })
})

describe("refresh_owner_directory (non-destructive)", () => {
  it("returns the sync result and the audit id", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "refresh_owner_directory", arguments: {} })
    expect(core.refreshOwnerDirectory).toHaveBeenCalledWith(ACTOR)
    expect(r.structuredContent).toEqual({
      audit_id: "aud-refresh",
      target: { type: "owner_directory", id: null, result: { inserted: 3, updated: 2, deleted: 0 } },
    })
    await close()
  })

  it("turns a failed sync into a tool error", async () => {
    core.refreshOwnerDirectory.mockResolvedValue({ ok: false, error: "sync failed" })
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "refresh_owner_directory", arguments: {} })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("sync failed")
    await close()
  })
})
```

- [ ] **Step 4: Write the failing data-mapping test**

Create `src/__tests__/mcp/tools-data.test.ts` with the same mock block plus:

```ts
vi.mock("@/lib/mcp/queries/data-mappings", () => ({ unresolvedMappings: core.unresolvedMappings }))
vi.mock("@/lib/admin/core/data-mappings", () => ({ setLocationMapping: core.setLocationMapping }))
```

and:

```ts
beforeEach(() => {
  core.unresolvedMappings.mockResolvedValue({
    items: [
      {
        location_id: "loc-1",
        location_name: "Hello Sugar Austin South",
        listing: { id: "l-1", title: "Austin South", status: "pending" },
        status: "unconfirmed",
        current_bq_location_name: null,
        suggestion: { bq_location_name: "Austin South", confidence: 0.86 },
      },
    ],
    bq_configured: true,
  })
  core.setLocationMapping.mockResolvedValue({ ok: true, auditId: "aud-map" })
})

describe("list_unresolved_data_mappings", () => {
  it("returns the blocking locations with their suggested BigQuery names", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_unresolved_data_mappings", arguments: {} })
    const body = r.structuredContent as Record<string, any>
    expect(body.items[0].suggestion).toEqual({ bq_location_name: "Austin South", confidence: 0.86 })
    expect(body.bq_configured).toBe(true)
    await close()
  })

  it("still lists the locations when BigQuery is unavailable, with no suggestions", async () => {
    core.unresolvedMappings.mockResolvedValue({
      items: [
        {
          location_id: "loc-1",
          location_name: "Hello Sugar Austin South",
          listing: null,
          status: "unconfirmed",
          current_bq_location_name: null,
          suggestion: null,
        },
      ],
      bq_configured: false,
    })
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_unresolved_data_mappings", arguments: {} })
    const body = r.structuredContent as Record<string, any>
    expect(body.bq_configured).toBe(false)
    expect(body.items[0].suggestion).toBeNull()
    await close()
  })
})

describe("set_location_data_mapping (non-destructive)", () => {
  it("confirms a mapping to a BigQuery location name", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "set_location_data_mapping",
      arguments: { location_id: "loc-1", status: "confirmed", bq_location_name: "Austin South" },
    })
    expect(core.setLocationMapping).toHaveBeenCalledWith(ACTOR, "loc-1", {
      bqLocationName: "Austin South",
      status: "confirmed",
    })
    expect((r.structuredContent as { audit_id: string }).audit_id).toBe("aud-map")
    await close()
  })

  it("marks a location not_connected with a null name", async () => {
    const { client, close } = await mcpTestClient()
    await client.callTool({
      name: "set_location_data_mapping",
      arguments: { location_id: "loc-1", status: "not_connected" },
    })
    expect(core.setLocationMapping).toHaveBeenCalledWith(ACTOR, "loc-1", {
      bqLocationName: null,
      status: "not_connected",
    })
    await close()
  })

  it("surfaces the core's refusal when confirming without a name", async () => {
    core.setLocationMapping.mockResolvedValue({ ok: false, error: "A location is required to confirm." })
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "set_location_data_mapping",
      arguments: { location_id: "loc-1", status: "confirmed" },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("A location is required to confirm.")
    await close()
  })
})
```

- [ ] **Step 5: Run both to verify they fail**

```
npx vitest run src/__tests__/mcp/tools-owner.test.ts src/__tests__/mcp/tools-data.test.ts
```

Expected: FAIL — the owner/data tool modules and the data-mapping query do not resolve.

- [ ] **Step 6: Write the data-mapping query**

Create `src/lib/mcp/queries/data-mappings.ts`:

```ts
// Salon locations whose data-source mapping still blocks listing approval.
//
// NOT a use server module.
//
// Mirrors src/app/admin/data/page.tsx exactly, including its BigQuery degradation:
// listLocationNames() returns null when BigQuery is not configured or unreachable,
// and the page then renders the rows with no suggestions rather than failing. The
// tool reports that state as `bq_configured: false` so the model does not mistake
// "no suggestion" for "no match exists".
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { listLocationNames } from "@/lib/bigquery/queries"
import { suggestLocationMatch } from "@/lib/data/match"
import { unresolvedSalonLocations } from "@/lib/data/mapping"

export interface UnresolvedMapping {
  location_id: string
  location_name: string
  listing: { id: string; title: string | null; status: string } | null
  status: string
  current_bq_location_name: string | null
  suggestion: { bq_location_name: string; confidence: number } | null
}

export async function unresolvedMappings(): Promise<{
  items: UnresolvedMapping[]
  bq_configured: boolean
}> {
  const [locations, names] = await Promise.all([
    db.query.listingLocations.findMany({
      where: eq(listingLocations.locationType, "salon"),
      with: { listing: { columns: { id: true, title: true, status: true } } },
    }),
    listLocationNames(),
  ])

  const candidates = (names ?? []).map((n) => ({ id: n, name: n }))
  const blocking = unresolvedSalonLocations(
    locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      locationType: loc.locationType,
      dataMappingStatus: loc.dataMappingStatus,
    })),
  )
  const blockingIds = new Set(blocking.map((b) => b.id))

  return {
    items: locations
      .filter((loc) => blockingIds.has(loc.id))
      .map((loc) => {
        const suggestion = names ? suggestLocationMatch(loc.name, candidates) : null
        return {
          location_id: loc.id,
          location_name: loc.name,
          listing: loc.listing
            ? { id: loc.listing.id, title: loc.listing.title, status: loc.listing.status }
            : null,
          status: loc.dataMappingStatus,
          current_bq_location_name: loc.bqLocationName,
          suggestion: suggestion
            ? { bq_location_name: suggestion.name, confidence: suggestion.confidence }
            : null,
        }
      }),
    bq_configured: names !== null,
  }
}
```

- [ ] **Step 7: Write the owner tools**

Create `src/lib/mcp/tools/owner.ts`:

```ts
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
        "Every user with all of their owner-directory links. A link's `source` is \"auto\" " +
        "(matched from the sign-in email), \"manual\" (an admin override) or \"revoked\" (an " +
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
          target: { type: "owner_link", id: `${rest.user_id}:${rest.owner_identifier}`, deleted: true },
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
    async (_args) =>
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
```

- [ ] **Step 8: Write the data-mapping tools**

Create `src/lib/mcp/tools/data.ts`:

```ts
// Listing-location to BigQuery data-source mappings.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import { setLocationMapping } from "@/lib/admin/core/data-mappings"
import { unresolvedMappings } from "@/lib/mcp/queries/data-mappings"
import {
  READ_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  readTool,
  writeTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

export function registerDataTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_unresolved_data_mappings",
    {
      title: "List unresolved data mappings",
      description:
        "Salon locations whose BigQuery data-source mapping is still unconfirmed. A listing " +
        "cannot be approved while any of its salon locations is on this list, because an " +
        "unconfirmed mapping would surface the wrong location's financials. Each row carries " +
        "a suggested BigQuery location name when one scores highly enough. `bq_configured` " +
        "is false when BigQuery is unreachable — then every suggestion is null and absence " +
        "of a suggestion means nothing.",
      inputSchema: z.object({}),
      annotations: READ_ANNOTATIONS,
    },
    async (_args) =>
      readTool(ctx, "list_unresolved_data_mappings", {}, async () => ({
        ...(await unresolvedMappings()),
      })),
  )

  if (!ctx.canWrite) return

  server.registerTool(
    "set_location_data_mapping",
    {
      title: "Set location data mapping",
      description:
        'Resolve one salon location\'s data source. Use status "confirmed" with the exact ' +
        "BigQuery location name (from list_unresolved_data_mappings' suggestion, or " +
        'list_owner_directory\'s resolved_bq_location_name), or status "not_connected" to ' +
        "record that this location has no financial data source. Confirming also stamps the " +
        "location's coordinates from Monday when they are available. Reversible by calling " +
        "again, so it executes immediately.",
      inputSchema: z.object({
        location_id: z.string().min(1).max(64).describe("The listing location's id."),
        status: z
          .enum(["confirmed", "not_connected"])
          .describe('"confirmed" requires bq_location_name; "not_connected" ignores it.'),
        bq_location_name: z
          .string()
          .max(200)
          .optional()
          .describe("Exact BigQuery LOCATION_NAME string. Required when status is confirmed."),
      }),
      annotations: { ...WRITE_ANNOTATIONS, idempotentHint: true },
    },
    async (args) =>
      writeTool(ctx, "set_location_data_mapping", args, async () => {
        const result = await setLocationMapping(ctx.actor, args.location_id, {
          bqLocationName: args.status === "confirmed" ? (args.bq_location_name ?? null) : null,
          status: args.status,
        })
        if (!result.ok) throw new Error(result.error)
        return {
          audit_id: result.auditId,
          target: {
            type: "listing_location",
            id: args.location_id,
            data_mapping_status: args.status,
            bq_location_name: args.status === "confirmed" ? (args.bq_location_name ?? null) : null,
          },
        }
      }),
  )
}
```

- [ ] **Step 9: Register both domains**

In `src/lib/mcp/server.ts`, add the imports:

```ts
import { registerOwnerTools } from "@/lib/mcp/tools/owner"
import { registerDataTools } from "@/lib/mcp/tools/data"
```

and, inside `buildMcpServer` after `registerInquiryTools(server, ctx)`:

```ts
  registerOwnerTools(server, ctx)
  registerDataTools(server, ctx)
```

- [ ] **Step 10: Run the full MCP suite plus the owner-directory suite**

```
npx vitest run src/__tests__/mcp src/__tests__/owner-directory src/__tests__/data
```

Expected: PASS.

- [ ] **Step 11: Type-check and lint**

```
npx tsc --noEmit
npx eslint src/lib/mcp src/lib/owner-directory/data.ts
```

Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add src/lib/owner-directory/data.ts src/lib/mcp src/__tests__/mcp/tools-owner.test.ts src/__tests__/mcp/tools-data.test.ts
git commit -F- <<'MSG'
feat(mcp): owner-directory and data-mapping tools

list_owner_directory, list_owner_links and list_unresolved_data_mappings plus
add/revoke/clear owner link, refresh_owner_directory and
set_location_data_mapping.

Extracts session-free queryOwnerDirectory and queryUsersWithLinks from
owner-directory/data.ts: those exports guard themselves with a cookie-backed
auth() call that an MCP bearer request can never satisfy. The guarded exports
keep their names and their guard and delegate to the new queries.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 9: Market tools, MCP-connection tools, and the full-inventory guard

The last four tools — spec §7.3's `list_competitor_closures`, `list_alerts` and `list_mcp_connections`, and §7.4's `revoke_mcp_connection` — plus the assertion that the complete tool inventory matches the spec and that `WRITE_TOOL_NAMES` cannot drift from what is actually registered.

`revoke_mcp_connection` is the only write tool whose underlying function does **not** already audit itself: PR B's `revokeMcpToken` returns `{ ok }` and writes nothing to `admin_audit_log`. This tool therefore calls `withAudit` directly.

**Files:**
- Create: `src/lib/mcp/queries/alerts.ts`
- Create: `src/lib/mcp/tools/market.ts`
- Create: `src/lib/mcp/tools/connections.ts`
- Modify: `src/lib/mcp/server.ts` (register both domains)
- Modify: `src/__tests__/mcp/server.test.ts` (append the inventory + drift block)
- Test: `src/__tests__/mcp/tools-market.test.ts`
- Test: `src/__tests__/mcp/tools-connections.test.ts`

**Interfaces:**
- Consumes: `getCompetitorClosures`, `type CompetitorClosure` (`@/lib/competitor-query`); `alerts` (`@/db/schema/alerts`); `users` (`@/db/schema/auth`); `listMcpConnections`, `revokeMcpToken` (`@/lib/mcp/oauth/grants`); `withAudit` (`@/lib/admin/audit`); `requireConfirmation`; `_shared.ts`.
- Produces:
  - `interface AlertRow { id: string; name: string | null; origin: string; owner: { id: string; name: string | null; email: string | null }; states: string[] | null; listing_types: string[] | null; min_price: { cents: number; formatted: string } | null; max_price: { cents: number; formatted: string } | null; min_years_open: number | null; inventory_included: boolean; radius_miles: number | null; center_label: string | null; owner_identifier: string | null; notify_enabled: boolean; include_listings: boolean; include_competitors: boolean; created_at: string; updated_at: string }`
  - `function listAlerts(filters: { userId?: string; origin?: string; notifyEnabled?: boolean; limit: number; cursor?: string }): Promise<{ items: AlertRow[]; next_cursor: string | null }>`
  - `function registerMarketTools(server: McpServer, ctx: McpToolContext): void`
  - `function registerConnectionTools(server: McpServer, ctx: McpToolContext): void`

- [ ] **Step 1: Write the failing market test**

Create `src/__tests__/mcp/tools-market.test.ts` with the standard full mock block plus:

```ts
vi.mock("@/lib/competitor-query", () => ({ getCompetitorClosures: core.getCompetitorClosures }))
vi.mock("@/lib/mcp/queries/alerts", () => ({ listAlerts: core.listAlerts }))
```

```ts
const CLOSURE = {
  googlePlaceId: "gp-1",
  brandId: "waxing-co",
  brandName: "Waxing Co",
  address: "1 Main St",
  city: "Denver",
  state: "CO",
  latitude: 39.74,
  longitude: -104.99,
  businessStatus: "CLOSED_PERMANENTLY",
  closedAt: "2026-06-22T04:44:29.680Z",
  nearestHsName: "Hello Sugar Denver",
  nearestHsMiles: 1.8,
  isOpportunity: true,
  mapsUrl: "https://maps.example/gp-1",
}

beforeEach(() => {
  core.getCompetitorClosures.mockResolvedValue([CLOSURE])
  core.listAlerts.mockResolvedValue({ items: [], next_cursor: null })
})

describe("list_competitor_closures", () => {
  it("projects a closure and keeps closed_at labelled as a DETECTION time", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_competitor_closures", arguments: {} })
    expect((r.structuredContent as { items: Record<string, unknown>[] }).items[0]).toEqual({
      google_place_id: "gp-1",
      brand_id: "waxing-co",
      brand_name: "Waxing Co",
      address: "1 Main St",
      city: "Denver",
      state: "CO",
      latitude: 39.74,
      longitude: -104.99,
      business_status: "CLOSED_PERMANENTLY",
      closure_detected_at: "2026-06-22T04:44:29.680Z",
      nearest_hs_name: "Hello Sugar Denver",
      nearest_hs_miles: 1.8,
      is_opportunity: true,
      maps_url: "https://maps.example/gp-1",
    })
    await close()
  })

  it("builds a scope from center and radius when all three are given", async () => {
    const { client, close } = await mcpTestClient()
    await client.callTool({
      name: "list_competitor_closures",
      arguments: { center_lat: 39.74, center_lng: -104.99, radius_miles: 25, states: ["CO"] },
    })
    expect(core.getCompetitorClosures).toHaveBeenCalledWith({
      centerLat: 39.74,
      centerLng: -104.99,
      radiusMiles: 25,
      states: ["CO"],
    })
    await close()
  })

  it("passes undefined — not a partial scope — when no filters are given", async () => {
    const { client, close } = await mcpTestClient()
    await client.callTool({ name: "list_competitor_closures", arguments: {} })
    expect(core.getCompetitorClosures).toHaveBeenCalledWith(undefined)
    await close()
  })

  it("advertises no write tool for competitor data", async () => {
    const { client, close } = await mcpTestClient()
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names.filter((n) => n.includes("competitor"))).toEqual(["list_competitor_closures"])
    await close()
  })
})

describe("list_alerts", () => {
  it("forwards the filters to the query", async () => {
    const { client, close } = await mcpTestClient()
    await client.callTool({
      name: "list_alerts",
      arguments: { user_id: "u-2", origin: "owner-auto", notify_enabled: true, limit: 10 },
    })
    expect(core.listAlerts).toHaveBeenCalledWith({
      userId: "u-2",
      origin: "owner-auto",
      notifyEnabled: true,
      limit: 10,
      cursor: undefined,
    })
    await close()
  })

  it("returns the query page unchanged", async () => {
    core.listAlerts.mockResolvedValue({ items: [{ id: "a-1" }], next_cursor: "N" })
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_alerts", arguments: {} })
    expect(r.structuredContent).toEqual({ items: [{ id: "a-1" }], next_cursor: "N" })
    await close()
  })
})
```

- [ ] **Step 2: Write the failing connections test**

Create `src/__tests__/mcp/tools-connections.test.ts` with the standard full mock block plus:

```ts
vi.mock("@/lib/mcp/oauth/grants", () => ({
  listMcpConnections: core.listMcpConnections,
  revokeMcpToken: core.revokeMcpToken,
}))
```

and extend the `@/lib/admin/audit` mock to carry `withAudit`:

```ts
vi.mock("@/lib/admin/audit", () => ({
  recordMcpRead: core.recordMcpRead,
  withAudit: core.withAudit,
}))
```

```ts
const GRANT = {
  tokenId: "tok-9",
  clientId: "claude-hosted",
  label: "Parker's laptop",
  scope: "marketplace:read marketplace:write",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  lastUsedAt: new Date("2026-09-13T00:00:00.000Z"),
  expiresAt: new Date("2026-09-14T13:00:00.000Z"),
  revokedAt: null,
  userId: "u-1",
  userEmail: "admin@hellosugar.salon",
}

beforeEach(() => {
  core.listMcpConnections.mockResolvedValue([GRANT])
  core.revokeMcpToken.mockResolvedValue({ ok: true })
  // withAudit runs fn and returns { result, auditId }, exactly as PR A does.
  core.withAudit.mockImplementation(
    async (_actor: unknown, _action: string, _target: unknown, _args: unknown, fn: () => Promise<unknown>) => ({
      result: await fn(),
      auditId: "aud-revoke-mcp",
    }),
  )
})

describe("list_mcp_connections", () => {
  it("lists the caller's own grants by default", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_mcp_connections", arguments: {} })
    expect(core.listMcpConnections).toHaveBeenCalledWith({ userId: "u-1", all: undefined })
    const item = (r.structuredContent as { items: Record<string, unknown>[] }).items[0]
    expect(item).toMatchObject({
      token_id: "tok-9",
      client_id: "claude-hosted",
      label: "Parker's laptop",
      scopes: ["marketplace:read", "marketplace:write"],
      status: "active",
      is_current_connection: false,
    })
    await close()
  })

  it("marks the grant this request is authenticated with", async () => {
    core.listMcpConnections.mockResolvedValue([{ ...GRANT, tokenId: "tok-1" }])
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_mcp_connections", arguments: {} })
    expect((r.structuredContent as { items: { is_current_connection: boolean }[] }).items[0]
      .is_current_connection).toBe(true)
    await close()
  })

  it("reports a revoked grant and an expired one distinctly", async () => {
    core.listMcpConnections.mockResolvedValue([
      { ...GRANT, tokenId: "a", revokedAt: new Date("2026-09-02T00:00:00.000Z") },
      { ...GRANT, tokenId: "b", expiresAt: new Date("2020-01-01T00:00:00.000Z") },
    ])
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({ name: "list_mcp_connections", arguments: {} })
    const items = (r.structuredContent as { items: { status: string }[] }).items
    expect(items.map((i) => i.status)).toEqual(["revoked", "expired"])
    await close()
  })

  it("forwards all: true", async () => {
    const { client, close } = await mcpTestClient()
    await client.callTool({ name: "list_mcp_connections", arguments: { all: true } })
    expect(core.listMcpConnections).toHaveBeenCalledWith({ userId: "u-1", all: true })
    await close()
  })
})

describe("revoke_mcp_connection (destructive)", () => {
  it("previews, then revokes own-grants-only and writes its own audit row", async () => {
    const { client, close } = await mcpTestClient()
    const preview = await client.callTool({
      name: "revoke_mcp_connection",
      arguments: { token_id: "tok-9" },
    })
    const body = preview.structuredContent as Record<string, any>
    expect(body.preview).toContain("Parker's laptop")
    expect(core.revokeMcpToken).not.toHaveBeenCalled()

    const done = await client.callTool({
      name: "revoke_mcp_connection",
      arguments: { token_id: "tok-9", confirmation_token: body.confirmation_token },
    })
    expect(core.revokeMcpToken).toHaveBeenCalledWith({
      tokenId: "tok-9",
      requesterUserId: "u-1",
      ownOnly: true,
    })
    expect(core.withAudit).toHaveBeenCalledWith(
      { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" },
      "mcp_token.revoke",
      { type: "mcp_token", id: "tok-9" },
      { token_id: "tok-9" },
      expect.any(Function),
    )
    expect(done.structuredContent).toEqual({
      audit_id: "aud-revoke-mcp",
      target: { type: "mcp_token", id: "tok-9", revoked: true },
    })
    await close()
  })

  it("warns extra loudly when revoking the connection being used right now", async () => {
    core.listMcpConnections.mockResolvedValue([{ ...GRANT, tokenId: "tok-1" }])
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "revoke_mcp_connection",
      arguments: { token_id: "tok-1" },
    })
    expect((r.structuredContent as { preview: string }).preview).toMatch(
      /connection you are using right now/i,
    )
    await close()
  })

  it("refuses a token_id that is not one of the caller's grants", async () => {
    const { client, close } = await mcpTestClient()
    const r = await client.callTool({
      name: "revoke_mcp_connection",
      arguments: { token_id: "someone-elses" },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Connection not found")
    expect(core.revokeMcpToken).not.toHaveBeenCalled()
    await close()
  })

  it("surfaces a refusal from revokeMcpToken", async () => {
    core.revokeMcpToken.mockResolvedValue({ ok: false, error: "Token already revoked" })
    const { client, close } = await mcpTestClient()
    const preview = await client.callTool({
      name: "revoke_mcp_connection",
      arguments: { token_id: "tok-9" },
    })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const r = await client.callTool({
      name: "revoke_mcp_connection",
      arguments: { token_id: "tok-9", confirmation_token: token },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Token already revoked")
    await close()
  })
})
```

- [ ] **Step 3: Run both to verify they fail**

```
npx vitest run src/__tests__/mcp/tools-market.test.ts src/__tests__/mcp/tools-connections.test.ts
```

Expected: FAIL — the market/connection tool modules and the alerts query do not resolve.

- [ ] **Step 4: Write the alerts query**

Create `src/lib/mcp/queries/alerts.ts`:

```ts
// Saved buyer searches (`alerts`) joined to their owner, for the MCP `list_alerts` tool.
//
// NOT a use server module.
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { alerts } from "@/db/schema/alerts"
import { users } from "@/db/schema/auth"
import { encodeCursor, decodeCursor, money } from "@/lib/mcp/tools/_shared"

export interface AlertRow {
  id: string
  name: string | null
  origin: string
  owner: { id: string; name: string | null; email: string | null }
  states: string[] | null
  listing_types: string[] | null
  min_price: { cents: number; formatted: string } | null
  max_price: { cents: number; formatted: string } | null
  min_years_open: number | null
  inventory_included: boolean
  radius_miles: number | null
  center_label: string | null
  owner_identifier: string | null
  notify_enabled: boolean
  include_listings: boolean
  include_competitors: boolean
  created_at: string
  updated_at: string
}

export async function listAlerts(filters: {
  userId?: string
  origin?: string
  notifyEnabled?: boolean
  limit: number
  cursor?: string
}): Promise<{ items: AlertRow[]; next_cursor: string | null }> {
  const conditions: SQL[] = []
  if (filters.userId) conditions.push(eq(alerts.userId, filters.userId))
  if (filters.origin) conditions.push(eq(alerts.origin, filters.origin as never))
  if (filters.notifyEnabled !== undefined) {
    conditions.push(eq(alerts.notifyEnabled, filters.notifyEnabled))
  }

  const cursor = decodeCursor(filters.cursor)
  if (cursor && typeof cursor.at === "string" && typeof cursor.id === "string") {
    const at = new Date(cursor.at)
    if (!Number.isNaN(at.getTime())) {
      const keyset = or(
        lt(alerts.createdAt, at),
        and(eq(alerts.createdAt, at), lt(alerts.id, cursor.id)),
      )
      if (keyset) conditions.push(keyset)
    }
  }

  const rows = await db
    .select({
      id: alerts.id,
      name: alerts.name,
      origin: alerts.origin,
      userId: alerts.userId,
      userName: users.name,
      userEmail: users.email,
      states: alerts.states,
      listingTypes: alerts.listingTypes,
      minPrice: alerts.minPrice,
      maxPrice: alerts.maxPrice,
      minYearsOpen: alerts.minYearsOpen,
      inventoryIncluded: alerts.inventoryIncluded,
      radiusMiles: alerts.radiusMiles,
      centerLabel: alerts.centerLabel,
      ownerIdentifier: alerts.ownerIdentifier,
      notifyEnabled: alerts.notifyEnabled,
      includeListings: alerts.includeListings,
      includeCompetitors: alerts.includeCompetitors,
      createdAt: alerts.createdAt,
      updatedAt: alerts.updatedAt,
    })
    .from(alerts)
    .leftJoin(users, eq(users.id, alerts.userId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alerts.createdAt), desc(alerts.id))
    .limit(filters.limit + 1)

  const hasMore = rows.length > filters.limit
  const page = hasMore ? rows.slice(0, filters.limit) : rows
  const last = page[page.length - 1]

  return {
    items: page.map((r) => ({
      id: r.id,
      name: r.name,
      origin: r.origin,
      owner: { id: r.userId, name: r.userName, email: r.userEmail },
      states: r.states,
      listing_types: r.listingTypes,
      // min_price/max_price are stored in cents like every other money column.
      min_price: money(r.minPrice),
      max_price: money(r.maxPrice),
      min_years_open: r.minYearsOpen,
      inventory_included: r.inventoryIncluded,
      radius_miles: r.radiusMiles,
      center_label: r.centerLabel,
      owner_identifier: r.ownerIdentifier,
      notify_enabled: r.notifyEnabled,
      include_listings: r.includeListings,
      include_competitors: r.includeCompetitors,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    })),
    next_cursor:
      hasMore && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null,
  }
}
```

- [ ] **Step 5: Write the market tools**

Create `src/lib/mcp/tools/market.ts`:

```ts
// Read-only market context: scraper-owned competitor closures and buyer saved searches.
//
// NOT a use server module.
//
// `competitor_opportunities` is owned end to end by the external competitor-monitor
// scraper. Nothing here writes to it, and no write tool for it exists.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import { getCompetitorClosures } from "@/lib/competitor-query"
import { listAlerts } from "@/lib/mcp/queries/alerts"
import {
  DEFAULT_LIMIT,
  READ_ANNOTATIONS,
  cursorField,
  limitField,
  paginateArray,
  readTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

export function registerMarketTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_competitor_closures",
    {
      title: "List competitor closures",
      description:
        "Competitor salon locations the monitoring scraper has found closed, with the nearest " +
        "Hello Sugar location and whether the scraper flagged the site as an opportunity. " +
        "`closure_detected_at` is when the SCRAPER FIRST SAW the closure, not when the " +
        "business closed, and it is null on many rows — never present it as a closing date. " +
        "Supply center_lat, center_lng and radius_miles together to search a radius; " +
        "`states` narrows by two-letter state code. Read-only: this data belongs to the " +
        "external scraper. Returns { items, next_cursor }.",
      inputSchema: z.object({
        center_lat: z.number().min(-90).max(90).optional().describe("Search centre latitude."),
        center_lng: z.number().min(-180).max(180).optional().describe("Search centre longitude."),
        radius_miles: z
          .number()
          .positive()
          .max(5000)
          .optional()
          .describe("Search radius in miles. Needs center_lat and center_lng too."),
        states: z
          .array(z.string().length(2))
          .max(60)
          .optional()
          .describe("Two-letter US state codes to include."),
        opportunities_only: z
          .boolean()
          .optional()
          .describe("Only closures the scraper flagged as an opportunity."),
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_competitor_closures", args, async () => {
        const hasScope =
          args.center_lat !== undefined ||
          args.center_lng !== undefined ||
          args.radius_miles !== undefined ||
          args.states !== undefined
        const rows = await getCompetitorClosures(
          hasScope
            ? {
                centerLat: args.center_lat,
                centerLng: args.center_lng,
                radiusMiles: args.radius_miles,
                states: args.states,
              }
            : undefined,
        )
        const filtered = args.opportunities_only ? rows.filter((r) => r.isOpportunity) : rows
        const page = paginateArray(filtered, args.limit, args.cursor)
        return {
          items: page.items.map((r) => ({
            google_place_id: r.googlePlaceId,
            brand_id: r.brandId,
            brand_name: r.brandName,
            address: r.address,
            city: r.city,
            state: r.state,
            latitude: r.latitude,
            longitude: r.longitude,
            business_status: r.businessStatus,
            // Named for what it is: detection time, not closing time.
            closure_detected_at: r.closedAt,
            nearest_hs_name: r.nearestHsName,
            nearest_hs_miles: r.nearestHsMiles,
            is_opportunity: r.isOpportunity,
            maps_url: r.mapsUrl,
          })),
          next_cursor: page.next_cursor,
        }
      }),
  )

  server.registerTool(
    "list_alerts",
    {
      title: "List saved searches",
      description:
        "Buyer saved searches (alerts) with their criteria and their owner. `origin` is " +
        '"user" for a search a buyer saved themselves and "owner-auto" for one created ' +
        "automatically around a franchise owner's locations. Money criteria are in cents " +
        "with a formatted string. Returns { items, next_cursor }.",
      inputSchema: z.object({
        user_id: z.string().max(64).optional().describe("Only this user's saved searches."),
        origin: z
          .enum(["user", "owner-auto"])
          .optional()
          .describe("Filter by how the search was created."),
        notify_enabled: z
          .boolean()
          .optional()
          .describe("Only searches with email notifications on (true) or off (false)."),
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_alerts", args, async () =>
        listAlerts({
          userId: args.user_id,
          origin: args.origin,
          notifyEnabled: args.notify_enabled,
          limit: args.limit ?? DEFAULT_LIMIT,
          cursor: args.cursor,
        }),
      ),
  )
}
```

- [ ] **Step 6: Write the connection tools**

Create `src/lib/mcp/tools/connections.ts`:

```ts
// The MCP's view of its own OAuth grants.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import { withAudit } from "@/lib/admin/audit"
import { listMcpConnections, revokeMcpToken } from "@/lib/mcp/oauth/grants"
import { requireConfirmation } from "@/lib/mcp/confirm"
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ANNOTATIONS,
  REQUIRES_USER_INTERACTION,
  confirmationField,
  cursorField,
  limitField,
  paginateArray,
  readTool,
  writeTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

type Grant = {
  tokenId: string
  clientId: string
  label: string | null
  scope: string
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date
  revokedAt: Date | null
  userId: string
  userEmail: string | null
}

function grantStatus(g: Grant): "revoked" | "expired" | "active" {
  if (g.revokedAt) return "revoked"
  if (g.expiresAt.getTime() <= Date.now()) return "expired"
  return "active"
}

function projectGrant(g: Grant, currentTokenId: string): Record<string, unknown> {
  return {
    token_id: g.tokenId,
    client_id: g.clientId,
    label: g.label,
    scopes: g.scope.split(" ").filter(Boolean),
    status: grantStatus(g),
    user: { id: g.userId, email: g.userEmail },
    created_at: g.createdAt.toISOString(),
    last_used_at: g.lastUsedAt ? g.lastUsedAt.toISOString() : null,
    expires_at: g.expiresAt.toISOString(),
    revoked_at: g.revokedAt ? g.revokedAt.toISOString() : null,
    is_current_connection: g.tokenId === currentTokenId,
  }
}

export function registerConnectionTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_mcp_connections",
    {
      title: "List MCP connections",
      description:
        "OAuth grants that can reach this MCP server. Shows your own connections by default; " +
        "set all: true to see every admin's. Each row carries the client (claude-hosted for " +
        "Claude.ai, claude-code for the CLI), the granted scopes, when it was last used, and " +
        "whether it is active, expired or revoked. `is_current_connection` marks the grant " +
        "this very request is authenticated with.",
      inputSchema: z.object({
        all: z.boolean().optional().describe("Include every admin's connections, not just yours."),
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_mcp_connections", args, async () => {
        const grants = (await listMcpConnections({
          userId: ctx.actor.userId,
          all: args.all,
        })) as Grant[]
        const page = paginateArray(grants, args.limit, args.cursor)
        return {
          items: page.items.map((g) => projectGrant(g, ctx.mcp.tokenId)),
          next_cursor: page.next_cursor,
        }
      }),
  )

  if (!ctx.canWrite) return

  server.registerTool(
    "revoke_mcp_connection",
    {
      title: "Revoke MCP connection",
      description:
        "Revoke one of YOUR OWN MCP connections immediately. Its access and refresh tokens " +
        "stop working at once and the client must go through the OAuth consent flow again. " +
        "You cannot revoke another admin's connection from here — use /admin/mcp-connections " +
        "for that. DESTRUCTIVE: preview first, then re-send with confirmation_token.",
      inputSchema: z.object({
        token_id: z
          .string()
          .min(1)
          .max(64)
          .describe("The grant's token_id, from list_mcp_connections."),
        confirmation_token: confirmationField,
      }),
      annotations: { ...DESTRUCTIVE_ANNOTATIONS, idempotentHint: true },
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "revoke_mcp_connection", args, async () => {
        const { confirmation_token, ...rest } = args
        const grants = (await listMcpConnections({ userId: ctx.actor.userId })) as Grant[]
        const grant = grants.find((g) => g.tokenId === rest.token_id)
        // Pre-check before minting a token: revokeMcpToken with ownOnly would refuse
        // anyway, and this way the model learns immediately that the id is wrong.
        if (!grant) throw new Error("Connection not found")

        const isSelf = grant.tokenId === ctx.mcp.tokenId
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "revoke_mcp_connection",
          rest,
          confirmation_token,
          `Revoke the MCP connection "${grant.label ?? grant.tokenId}" (${grant.clientId}).` +
            (isSelf
              ? " THIS IS THE CONNECTION YOU ARE USING RIGHT NOW — every following call will fail until the client re-authorises."
              : " That client must go through the OAuth consent flow again."),
        )
        if (prompt) return { ...prompt }

        // The only write tool that audits itself: PR B's revokeMcpToken returns
        // { ok } and writes nothing to admin_audit_log.
        const { auditId } = await withAudit(
          ctx.actor,
          "mcp_token.revoke",
          { type: "mcp_token", id: rest.token_id },
          rest,
          async () => {
            const outcome = await revokeMcpToken({
              tokenId: rest.token_id,
              requesterUserId: ctx.actor.userId,
              ownOnly: true,
            })
            if (!outcome.ok) throw new Error(outcome.error)
            return outcome
          },
        )
        return {
          audit_id: auditId,
          target: { type: "mcp_token", id: rest.token_id, revoked: true },
        }
      }),
  )
}
```

- [ ] **Step 7: Register both domains**

In `src/lib/mcp/server.ts`, add the imports:

```ts
import { registerMarketTools } from "@/lib/mcp/tools/market"
import { registerConnectionTools } from "@/lib/mcp/tools/connections"
```

and, inside `buildMcpServer` after `registerDataTools(server, ctx)`:

```ts
  registerMarketTools(server, ctx)
  registerConnectionTools(server, ctx)
```

- [ ] **Step 8: Add the inventory and drift guard**

Append to `src/__tests__/mcp/server.test.ts` (the mock block at the top of that file must now stub every module `buildMcpServer` imports — copy the block from `tools-market.test.ts`):

```ts
const SPEC_READ_TOOLS = [
  "get_marketplace_overview",
  "list_recent_activity",
  "list_listings",
  "get_listing",
  "list_users",
  "get_user",
  "list_allowlist",
  "list_inquiries",
  "list_brand_requests",
  "get_brand_request",
  "list_owner_directory",
  "list_owner_links",
  "list_unresolved_data_mappings",
  "list_competitor_closures",
  "list_alerts",
  "list_audit_log",
  "list_mcp_connections",
]

describe("tool inventory", () => {
  it("advertises exactly the read tools the spec lists to a read-only token", async () => {
    const { client, close } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual([...SPEC_READ_TOOLS].sort())
    await close()
  })

  it("adds exactly WRITE_TOOL_NAMES when the token also carries marketplace:write", async () => {
    const readOnly = await mcpTestClient({ scopes: ["marketplace:read"] })
    const readNames = new Set((await readOnly.client.listTools()).tools.map((t) => t.name))
    await readOnly.close()

    const full = await mcpTestClient()
    const fullNames = (await full.client.listTools()).tools.map((t) => t.name)
    await full.close()

    const added = fullNames.filter((n) => !readNames.has(n)).sort()
    // This is what makes WRITE_TOOL_NAMES unable to drift: the route's 403 pre-check
    // reads that set, so a write tool missing from it would be silently callable.
    expect(added).toEqual([...WRITE_TOOL_NAMES].sort())
  })

  it("gives every destructive tool a confirmation_token and the interaction flag", async () => {
    const { client, close } = await mcpTestClient()
    for (const tool of (await client.listTools()).tools) {
      if (!tool.annotations?.destructiveHint) continue
      expect(JSON.stringify(tool.inputSchema), tool.name).toContain("confirmation_token")
      expect(tool._meta, tool.name).toMatchObject({ "anthropic/requiresUserInteraction": true })
    }
    await close()
  })

  it("marks every non-write tool read-only and every write tool not read-only", async () => {
    const { client, close } = await mcpTestClient()
    for (const tool of (await client.listTools()).tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(!WRITE_TOOL_NAMES.has(tool.name))
    }
    await close()
  })
})
```

- [ ] **Step 9: Run the whole MCP suite**

```
npx vitest run src/__tests__/mcp
```

Expected: PASS. A failure in "adds exactly WRITE_TOOL_NAMES" means either a write tool is registered outside the `if (!ctx.canWrite) return` guard, or `WRITE_TOOL_NAMES` is out of date — fix the code, never the expectation.

- [ ] **Step 10: Type-check and lint**

```
npx tsc --noEmit
npx eslint src/lib/mcp
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add src/lib/mcp src/__tests__/mcp
git commit -F- <<'MSG'
feat(mcp): competitor, alert and MCP-connection tools

list_competitor_closures (read-only; the scraper owns that table),
list_alerts, list_mcp_connections and revoke_mcp_connection. The revoke tool is
the one write that audits itself, because PR B's revokeMcpToken writes no audit
row. Adds a tools/list inventory test that pins the full tool set to the spec and
makes WRITE_TOOL_NAMES unable to drift from what is actually registered.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 10: The `/api/mcp` route handler

Spec §7.1. The route is the only place that touches HTTP: it verifies the bearer, answers an unauthenticated request with the `WWW-Authenticate` challenge that tells a client where to find the OAuth metadata, refuses a write call from a read-only token with `insufficient_scope`, and otherwise hands the request to the SDK handler built for that actor.

**Files:**
- Create: `src/app/api/mcp/route.ts`
- Test: `src/__tests__/mcp/route.test.ts`

**Interfaces:**
- Consumes: `verifyMcpToken`, `type McpActor` (`@/lib/mcp/auth/verify-token`); `protectedResourceMetadataUrl`, `mcpResourceUrl` (`@/lib/mcp/oauth/urls`); `createMcpRequestHandler`, `WRITE_TOOL_NAMES` (`@/lib/mcp/server`); `preloadSchemas` (`@modelcontextprotocol/server`).
- Produces: `POST`, `GET`, `DELETE` route handlers; `const runtime = "nodejs"`; `const dynamic = "force-dynamic"`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/mcp/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const { verifyMcpToken, protectedResourceMetadataUrl, mcpResourceUrl, fetchImpl, closeImpl, createMcpRequestHandler } =
  vi.hoisted(() => {
    const fetchImpl = vi.fn()
    const closeImpl = vi.fn()
    return {
      verifyMcpToken: vi.fn(),
      protectedResourceMetadataUrl: vi.fn(),
      mcpResourceUrl: vi.fn(),
      fetchImpl,
      closeImpl,
      createMcpRequestHandler: vi.fn(() => ({ fetch: fetchImpl, close: closeImpl })),
    }
  })

vi.mock("@/lib/mcp/auth/verify-token", () => ({ verifyMcpToken }))
vi.mock("@/lib/mcp/oauth/urls", () => ({ protectedResourceMetadataUrl, mcpResourceUrl }))
vi.mock("@/lib/mcp/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/server")>("@/lib/mcp/server")
  return { createMcpRequestHandler, WRITE_TOOL_NAMES: actual.WRITE_TOOL_NAMES }
})

import { POST, GET, DELETE } from "@/app/api/mcp/route"

const ADMIN = {
  userId: "u-1",
  email: "admin@hellosugar.salon",
  scopes: ["marketplace:read", "marketplace:write"],
  clientId: "claude-code",
  tokenId: "tok-1",
}

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://marketplace.hellosugar.salon/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

const AUTHED = { authorization: "Bearer good-token" }

beforeEach(() => {
  verifyMcpToken.mockReset().mockResolvedValue(ADMIN)
  protectedResourceMetadataUrl
    .mockReset()
    .mockReturnValue("https://marketplace.hellosugar.salon/.well-known/oauth-protected-resource/api/mcp")
  mcpResourceUrl.mockReset().mockReturnValue("https://marketplace.hellosugar.salon/api/mcp")
  fetchImpl.mockReset().mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
  closeImpl.mockReset().mockResolvedValue(undefined)
  createMcpRequestHandler.mockClear()
})

describe("unauthenticated requests", () => {
  it("answers 401 with the RFC 9728 resource_metadata challenge", async () => {
    verifyMcpToken.mockResolvedValue(null)
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }))
    expect(res.status).toBe(401)
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://marketplace.hellosugar.salon/.well-known/oauth-protected-resource/api/mcp", scope="marketplace:read"',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("issues the same challenge when the Authorization header is missing entirely", async () => {
    verifyMcpToken.mockResolvedValue(null)
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {}))
    expect(res.status).toBe(401)
    expect(verifyMcpToken).toHaveBeenCalledWith(null)
  })

  it("passes the raw Authorization header to the verifier", async () => {
    await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, AUTHED))
    expect(verifyMcpToken).toHaveBeenCalledWith("Bearer good-token")
  })

  it("never caches an auth failure", async () => {
    verifyMcpToken.mockResolvedValue(null)
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }))
    expect(res.headers.get("cache-control")).toBe("no-store")
  })
})

describe("scope enforcement", () => {
  it("rejects a token without marketplace:read as insufficient_scope", async () => {
    verifyMcpToken.mockResolvedValue({ ...ADMIN, scopes: [] })
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, AUTHED))
    expect(res.status).toBe(403)
    expect(res.headers.get("www-authenticate")).toContain('error="insufficient_scope"')
    expect(res.headers.get("www-authenticate")).toContain('scope="marketplace:read"')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects a write tools/call from a read-only token with 403, not a missing-tool error", async () => {
    verifyMcpToken.mockResolvedValue({ ...ADMIN, scopes: ["marketplace:read"] })
    const res = await POST(
      rpc(
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "reject_listing", arguments: {} } },
        AUTHED,
      ),
    )
    expect(res.status).toBe(403)
    expect(res.headers.get("www-authenticate")).toContain('scope="marketplace:write"')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("lets a READ tools/call through on a read-only token", async () => {
    verifyMcpToken.mockResolvedValue({ ...ADMIN, scopes: ["marketplace:read"] })
    const res = await POST(
      rpc(
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_listings", arguments: {} } },
        AUTHED,
      ),
    )
    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("lets a write tools/call through on a read+write token", async () => {
    const res = await POST(
      rpc(
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "reject_listing", arguments: {} } },
        AUTHED,
      ),
    )
    expect(res.status).toBe(200)
  })
})

describe("dispatch", () => {
  it("builds the handler for the verified actor and hands it the parsed body", async () => {
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list" }
    await POST(rpc(body, AUTHED))
    expect(createMcpRequestHandler).toHaveBeenCalledWith(ADMIN)
    expect(fetchImpl.mock.calls[0][1]).toEqual({ parsedBody: body })
  })

  it("returns the handler's response untouched", async () => {
    fetchImpl.mockResolvedValue(new Response('{"jsonrpc":"2.0"}', { status: 202 }))
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, AUTHED))
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('{"jsonrpc":"2.0"}')
  })

  it("answers a malformed JSON body with a JSON-RPC parse error, not a 500", async () => {
    const res = await POST(
      new Request("https://marketplace.hellosugar.salon/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTHED },
        body: "{ not json",
      }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe("non-POST methods", () => {
  it("answers GET with 405 and an Allow header", async () => {
    const res = await GET()
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
  })

  it("answers DELETE with 405 and an Allow header", async () => {
    const res = await DELETE()
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```
npx vitest run src/__tests__/mcp/route.test.ts
```

Expected: FAIL — `Failed to resolve import "@/app/api/mcp/route"`.

- [ ] **Step 3: Write the route handler**

Create `src/app/api/mcp/route.ts`:

```ts
import { preloadSchemas } from "@modelcontextprotocol/server"
import { verifyMcpToken } from "@/lib/mcp/auth/verify-token"
import { protectedResourceMetadataUrl } from "@/lib/mcp/oauth/urls"
import { createMcpRequestHandler, WRITE_TOOL_NAMES } from "@/lib/mcp/server"

/**
 * Remote MCP endpoint (spec §7.1).
 *
 * This route owns everything HTTP about the MCP: bearer verification, the
 * WWW-Authenticate challenges, method rejection, and body parsing. The SDK handler
 * it delegates to trusts its caller completely — it validates no Host header, no
 * Origin header and no token — so nothing below may be skipped.
 *
 * Node runtime: verifyMcpToken reads the Auth.js-backed users table through the Neon
 * driver and the confirmation module uses node:crypto. Never move this to the edge.
 */
export const runtime = "nodejs"
/** Every request is per-token and mutating; there is nothing here to cache. */
export const dynamic = "force-dynamic"

// Build the SDK's wire schemas during isolate warm-up rather than inside the first
// request of every cold Vercel instance. Idempotent and memoised.
preloadSchemas()

const NO_STORE = { "cache-control": "no-store" } as const

function challenge401(): Response {
  return new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
    headers: {
      ...NO_STORE,
      "content-type": "application/json",
      // RFC 9728: points the client at the protected-resource metadata so it can
      // discover the authorization server and start the OAuth flow unprompted.
      "www-authenticate": `Bearer resource_metadata="${protectedResourceMetadataUrl()}", scope="marketplace:read"`,
    },
  })
}

function insufficientScope(required: string): Response {
  return new Response(
    JSON.stringify({ error: "insufficient_scope", scope: required }),
    {
      status: 403,
      headers: {
        ...NO_STORE,
        "content-type": "application/json",
        "www-authenticate": `Bearer error="insufficient_scope", scope="${required}"`,
      },
    },
  )
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { ...NO_STORE, "content-type": "application/json", allow: "POST" },
  })
}

/** The name of the tool a `tools/call` body targets, or null for anything else. */
function calledToolName(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const message = body as { method?: unknown; params?: unknown }
  if (message.method !== "tools/call") return null
  const params = message.params
  if (typeof params !== "object" || params === null) return null
  const name = (params as { name?: unknown }).name
  return typeof name === "string" ? name : null
}

export async function POST(request: Request): Promise<Response> {
  const actor = await verifyMcpToken(request.headers.get("authorization"))
  if (!actor) return challenge401()

  if (!actor.scopes.includes("marketplace:read")) {
    return insufficientScope("marketplace:read")
  }

  // Read the body once, here. The SDK handler accepts it as `parsedBody`, which is
  // exactly the framework-integration path, and reading it ourselves is what lets the
  // scope pre-check below see which tool is being called.
  let parsedBody: unknown
  try {
    parsedBody = await request.json()
  } catch {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }),
      { status: 400, headers: { ...NO_STORE, "content-type": "application/json" } },
    )
  }

  // Write tools are never REGISTERED on a read-only token, so without this the client
  // would get a bare "tool not found" and no idea it needs a broader grant. Answering
  // 403 insufficient_scope tells it exactly what to ask for.
  const tool = calledToolName(parsedBody)
  if (tool && WRITE_TOOL_NAMES.has(tool) && !actor.scopes.includes("marketplace:write")) {
    return insufficientScope("marketplace:write")
  }

  // One handler, one actor, one request. The factory inside it builds a fresh
  // McpServer whose tool set is already filtered to this token's scopes.
  const handler = createMcpRequestHandler(actor)
  return handler.fetch(request, { parsedBody })
}

export async function GET(): Promise<Response> {
  // Stateless Streamable HTTP: there is no session to resume over a GET SSE stream.
  return methodNotAllowed()
}

export async function DELETE(): Promise<Response> {
  // Stateless Streamable HTTP: there is no session to terminate.
  return methodNotAllowed()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```
npx vitest run src/__tests__/mcp/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the whole suite**

```
npx vitest run
```

Expected: PASS, every file.

- [ ] **Step 6: Type-check and lint**

```
npx tsc --noEmit
npx eslint .
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/mcp/route.ts src/__tests__/mcp/route.test.ts
git commit -F- <<'MSG'
feat(mcp): POST /api/mcp endpoint with bearer verification and scope gating

Verifies the bearer before the SDK handler sees the request, answers an
unauthenticated call with the RFC 9728 resource_metadata challenge so a client
can discover the OAuth server on its own, and turns a write tools/call from a
read-only token into 403 insufficient_scope rather than a bare "tool not found".
GET and DELETE return 405: the endpoint is stateless and has no session to
resume or terminate.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 11: Gates, live verification, and the pull request

Spec §8's per-PR gates and its "Live check before merging PR C", then the PR itself. Nothing here is optional: the SDK integration, the OAuth handshake and the Claude-side tool rendering are the three things unit tests cannot prove.

**Files:**
- No source changes. Fixes discovered here belong in the task that owns the file.

**Interfaces:**
- Consumes: everything built in Tasks 1–10.
- Produces: a green branch and an open PR against `origin/main`.

- [ ] **Step 1: Confirm the dev server is stopped**

```
npx tsc --noEmit
```

If this is the first command of a fresh session, check first that nothing is holding the `.next` lock: on this Windows machine a running `npm run dev` makes a later `next build` fail. `tsc` itself is safe either way. **Never start `npm run dev` yourself** — Step 6 asks the user to start it.

Expected: no output, exit 0.

- [ ] **Step 2: Lint gate**

```
npx eslint .
```

Expected: no errors and no warnings. Lint is enforced in CI, so a warning here is a red build.

- [ ] **Step 3: Full test gate**

```
npm test
```

Expected: every file passes, including the pre-existing admin, listing, owner-directory, data-mapping and analytics suites. The three modules this PR modified (`load-listing.ts`, `owner-directory/data.ts`, `server.ts`) are all covered by existing tests that must still pass unchanged.

- [ ] **Step 4: Confirm the tool inventory one more time, by hand**

```
npx vitest run src/__tests__/mcp/server.test.ts -t "tool inventory"
```

Expected: PASS. Then read the spec's §7.3 and §7.4 tables next to `SPEC_READ_TOOLS` and `WRITE_TOOL_NAMES` and confirm by eye that all 17 read tools and all 18 write tools are present. That is 35 tools total.

- [ ] **Step 5: Push the branch and open the PR**

```bash
git push -u origin feature/admin-mcp-server-c
gh pr create --base main --title "feat(mcp): MCP endpoint, tools and destructive confirmation (PR C)" --body-file - <<'BODY'
Third and final PR of the admin MCP server (spec §7–§9). Depends on PR A (core
extraction + audit log) and PR B (OAuth server) being merged first.

## What this adds

- `POST /api/mcp` — bearer-verified, stateless Streamable HTTP. `GET`/`DELETE` are 405.
- 17 read tools and 18 write tools, grouped by domain under `src/lib/mcp/tools/`.
- Scope filtering: write tools are never registered for a `marketplace:read` token,
  so `tools/list` filters itself; a write `tools/call` on such a token gets
  403 `insufficient_scope` instead of a confusing "tool not found".
- Two-step confirmation on all 11 destructive tools: a stateless HMAC token binds
  the tool, the canonicalised arguments and the acting admin for 10 minutes.
- Every read writes one `mcp.read` audit row; every write returns the `audit_id`
  from the core function that performed it.
- Per-token write rate limit of 30/minute (best-effort, DEBT-028).

## Verification

- `npx tsc --noEmit`, `npx eslint .`, `npm test` all green.
- Live check against Claude Code and a Claude.ai custom connector: one read, one
  confirmed write, audit row visible on `/admin/activity`, grant visible on
  `/admin/mcp-connections`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
```

If `gh` returns 403, switch accounts: only `sugarparker` can push to `Hello-Brands/HS-Marketplace`.

```bash
gh auth switch
```

- [ ] **Step 6: Ask the user to start the dev server and confirm the preview URL**

Ask the user (do not run it yourself):

> Please start the dev server (`npm run dev`) for the local check, and tell me the Vercel preview URL for this PR once the deployment is green.

Note from the repo's history: **PR preview deployments on this project always report ERROR** even when production is fine. If the preview will not build, do the live check against the production deployment after merge instead, and say so explicitly rather than skipping it.

Both `MCP_CONFIRM_SECRET` and `MCP_ISSUER_URL` must already be set in the target environment — PR B added them. Confirm with the user before starting Step 7; a missing `MCP_CONFIRM_SECRET` makes every destructive tool throw at token-minting time.

- [ ] **Step 7: Live check — Claude Code**

Run, with `<url>` being the deployment's `/api/mcp`:

```bash
claude mcp add --transport http hs-marketplace <url> --client-id claude-code
```

Then in a Claude Code session, confirm each of these by hand:

1. The OAuth consent page opens in a browser, shows the client name, and offers the **Read only** / **Read and write** choice. Choose **Read and write**.
2. `/mcp` lists the server as connected.
3. Ask for the marketplace overview. Expect `get_marketplace_overview` to run and return real listing counts that match `/admin/listings`.
4. Ask to list pending listings. Expect `list_listings` with `status: "pending"`, and money rendered as a dollar string.
5. Ask to reject one specific pending listing with a reason. Expect **two** turns: a preview naming the listing and the reason, then — after you approve — the execution. Claude Code must prompt for the write even in an auto-accept mode (that is the `_meta` flag working).
6. Run the same reject again with the stale token. Expect the "does not match these arguments" or "expired" refusal, not a second rejection.

- [ ] **Step 8: Live check — Claude.ai custom connector**

In Claude.ai → Settings → Connectors → Add custom connector:
- URL: the same `/api/mcp`
- Client ID: `claude-hosted`

Confirm:

1. The consent page renders and the connection completes.
2. A read tool runs and returns real data.
3. A destructive tool shows the preview first and asks for confirmation before the second call. Claude.ai does **not** support elicitation — the confirmation must come through the two-call tool contract, not a popup.

- [ ] **Step 9: Verify the audit trail**

In the browser:

1. `/admin/activity` — the reject from Step 7 appears as an `admin_action` with **source `mcp`** and the right actor. Its `audit_id` matches what the tool returned.
2. `/admin/activity` with the kind filter — `mcp.read` rows are NOT in the feed (§6.3 excludes them).
3. `/admin/mcp-connections` — both grants are listed with their labels, client ids, scopes and a recent "last used".
4. Run `list_audit_log` with `include_reads: true` from the MCP and confirm the `mcp.read` rows for Steps 7.3 and 7.4 are there with the tool names in `args`.

- [ ] **Step 10: Verify demotion revokes access**

Ask the user to temporarily demote a second admin account that has an active MCP grant (or, if no second admin exists, skip this step and note it on the PR). Then have that account's MCP client make one call.

Expected: 401 with the `WWW-Authenticate` challenge on the **next call**, not at token expiry — `verifyMcpToken` re-reads the user row every request. Restore the role afterwards.

- [ ] **Step 11: Record the results on the PR and request review**

```bash
gh pr comment --body-file - <<'BODY'
Live check complete.

- Claude Code (`claude-code`): consent flow, `get_marketplace_overview`,
  `list_listings`, and a confirmed `reject_listing` — all as expected. Replaying
  the stale confirmation token was refused.
- Claude.ai custom connector (`claude-hosted`): consent flow and a read tool
  verified; destructive preview/confirm renders as two tool calls.
- `/admin/activity` shows the write with source `mcp` and the matching audit id;
  `mcp.read` rows are correctly excluded from the feed and visible via
  `list_audit_log` with `include_reads: true`.
- `/admin/mcp-connections` lists both grants with recent last-used timestamps.
BODY
```

Then request review. Do not merge until CI is green **and** the live check comment is posted.

---

## References

Every SDK claim in this plan was verified against the published `2.0.0` tarballs
(`npm pack @modelcontextprotocol/server@2.0.0` etc., type definitions read directly)
and against the SDK's own documentation on 2026-09-14.

**Packages and versions**

- npm registry metadata, `dist-tags.latest`: `@modelcontextprotocol/server` → `2.0.0`,
  `@modelcontextprotocol/core` → `2.0.0`, `@modelcontextprotocol/client` → `2.0.0`,
  `@modelcontextprotocol/sdk` (v1) → `1.30.0`. All four published 2026-07-27.
  - https://registry.npmjs.org/@modelcontextprotocol/server
  - https://registry.npmjs.org/@modelcontextprotocol/core
  - https://registry.npmjs.org/@modelcontextprotocol/client
  - https://registry.npmjs.org/@modelcontextprotocol/sdk
- `@modelcontextprotocol/server@2.0.0` dependencies: `zod ^4.2.0`, `@modelcontextprotocol/core 2.0.0`;
  `engines.node >= 20`; exports `"."`, `"./stdio"`, `"./validators/ajv"`, `"./validators/cf-worker"`.
  No Express or Hono dependency. (Read from the package's own `package.json` in the tarball.)

**SDK repository and docs**

- Repository, `main` branch is v2: https://github.com/modelcontextprotocol/typescript-sdk
- README (states "v2 is the stable release line", released alongside the 2026-07-28 spec;
  v1.x gets fixes for at least 6 months): https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md
- v2 documentation site: https://ts.sdk.modelcontextprotocol.io/v2/ (v1: https://ts.sdk.modelcontextprotocol.io/)
- HTTP serving — `createMcpHandler`, the per-request factory, "the handler trusts its caller",
  `authInfo` pass-through: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md
- Web-standard serving (`(Request) => Promise<Response>`):
  https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/web-standard.md
- Tool errors — `isError: true` results vs JSON-RPC errors:
  https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/errors.md
- Dynamic tool lists — `enable()` / `disable()` / `update()` / `remove()` and `tools/list_changed`:
  https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/notifications.md
- Testing — the `handler.fetch` loopback harness, and the note that
  `InMemoryTransport.createLinkedPair()` connects **2025-era instances only**:
  https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/testing.md
- v1 → v2 migration (context remap `extra.*` → `ctx.mcpReq.*` / `ctx.http?.*`; codemod
  `npx @modelcontextprotocol/codemod@latest v1-to-v2 .`):
  https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md
- Standard Schema support (Zod 4, Valibot, ArkType):
  https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/advanced/schema-libraries.md

**Protocol**

- MCP specification index: https://modelcontextprotocol.io/sitemap.xml
- Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are
  hints, never security guarantees: `.agents/skills/mcp-builder/reference/mcp_best_practices.md`
- Tool design, pagination and response-format guidance:
  `.agents/skills/mcp-builder/reference/node_mcp_server.md`
- RFC 9728 (OAuth 2.0 Protected Resource Metadata — the `WWW-Authenticate: Bearer
  resource_metadata=…` challenge): https://www.rfc-editor.org/rfc/rfc9728

### SDK version decision — v2, high confidence

**Decision: `@modelcontextprotocol/server@^2`.** Confidence: **high**.

- `2.0.0` is the `latest` dist-tag, not a prerelease, for all three packages. It shipped
  alongside the 2026-07-28 protocol revision and the repo's `main` branch and docs site are
  built for it.
- The exact APIs this plan uses — `createMcpHandler`, `McpServer`, `registerTool`'s
  `{ title, description, inputSchema, outputSchema, annotations, icons, _meta }` config,
  `ToolCallback`'s `(args, ctx)` shape, `ctx.http?.authInfo`, `RegisteredTool`'s
  `enable/disable/update/remove`, `InMemoryTransport.createLinkedPair`,
  `WebStandardStreamableHTTPServerTransport`, `preloadSchemas` — were all read out of the
  published `dist/*.d.mts` type definitions, not recalled.
- `_meta` reaching the wire was verified in the shipped implementation: `McpServer`'s
  `tools/list` handler copies `tool._meta` straight onto each advertised tool, and the core
  wire schema types `_meta` as an open `Record<string, unknown>` — so
  `anthropic/requiresUserInteraction` is schema-valid.
- `isError: true` alongside `structuredContent` is safe: the shipped `validateToolOutput`
  returns early on `result.isError`, so an error result is never checked against `outputSchema`.
- The repo is already on `zod@^4.3.6`, satisfying the SDK's `zod@^4.2.0` with no migration.

**Two v2-specific facts this plan depends on:**

1. **`createMcpHandler` takes a factory** and calls it once per HTTP request. That is why
   `buildMcpServer(actor)` exists and why per-request tool filtering is the sanctioned way to
   vary the tool set by caller — not `registeredTool.disable()`.
2. **`InMemoryTransport.createLinkedPair()` connects 2025-era instances only in v2.** The
   documented in-process harness is a `StreamableHTTPClientTransport` whose `fetch` is
   `handler.fetch`. That is what `test/helpers/mcp-harness.ts` does, and it has the side
   benefit of exercising the exact handler configuration production runs.

**Fallback if v2 fails the Task 4 gate** (the harness cannot connect, or `tsc` rejects the
SDK's types under this repo's TypeScript): drop to `@modelcontextprotocol/sdk@^1.30`, which is
still maintained (bug and security fixes for at least six months past v2's release) and which
**does** ship a web-standard transport:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"

export async function POST(request: Request): Promise<Response> {
  const actor = await verifyMcpToken(request.headers.get("authorization"))
  if (!actor) return challenge401()
  const server = buildMcpServer(actor)                       // unchanged
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,                           // stateless
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return transport.handleRequest(request, { authInfo, parsedBody })
}
```

Under v1 the changes are confined to three places: this route's dispatch, the import paths in
`server.ts` and the tool modules (`@modelcontextprotocol/sdk/server/mcp.js`), and the tool
handler's second parameter, which is `extra` with `extra.authInfo` / `extra.requestInfo`
instead of `ctx.http`. The harness switches to `InMemoryTransport.createLinkedPair()` from
`@modelcontextprotocol/sdk/inMemory.js`, which is fully supported on v1. v1 also accepts
zod 3 or 4, and `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` mechanically migrates
back to v2 later — so starting on v1 is recoverable, not a dead end. **Prefer v2.**

---

## Spec ambiguities resolved in this plan

Each of these is a place where spec §7 did not fully determine the implementation. The
resolution is stated here so a reviewer can disagree with it deliberately rather than
discover it in the diff.

1. **`get_listing` cannot use `loadAdminListing`** (spec §7.3 names it). That function takes an
   Auth.js `Session` and calls `redirect()` / `notFound()`, which are Next navigation throws
   with no meaning in a route handler. **Resolved:** extract and export the underlying query as
   `queryAdminListing(id)`; `loadAdminListing` delegates to it, so both callers share one
   definition and page behaviour is unchanged. Task 5.

2. **`getOwnerDirectory` and `listUsersWithLinks` self-guard with `auth()`** (a cookie-backed
   session), which an MCP bearer request can never satisfy. **Resolved:** the same extraction —
   exported, session-free `queryOwnerDirectory` / `queryUsersWithLinks`, with the guarded
   exports keeping their names, signatures and guard. The MCP's admin check is
   `verifyMcpToken`, which re-reads the user row and refuses non-admins on every call. Task 8.

3. **`list_unresolved_data_mappings` needs BigQuery** to produce `suggestLocationMatch`
   candidates, but §2 keeps BigQuery out of v1. **Resolved:** it performs exactly the read
   `/admin/data` already performs (`listLocationNames()`), and degrades exactly the same way —
   when BigQuery is unreachable the tool still lists the blocking locations, every suggestion
   is `null`, and the result carries `bq_configured: false` so the model cannot read "no
   suggestion" as "no match exists". No new BigQuery surface, no financial tools. Task 8.

4. **`update_listing`'s "same zod patch schema"** cannot be published as the tool's JSON
   Schema: `listingPatchSchema` contains `z.coerce.date()`, whose zod input type is `unknown`.
   **Resolved:** the tool takes `patch` as an open object with the accepted keys named in the
   description, and `parseListingPatch` — the same function `adminUpdateListing` calls — is the
   authoritative gate, run *before* a confirmation token is minted so an invalid patch fails
   immediately with its offending paths. Location and photo edits go through the patch
   unchanged; the ISO-string `openingDate` works precisely because of that `z.coerce.date()`.
   Task 5.

5. **Money units in `update_listing`'s patch are DOLLARS, not cents** — `buildListingUpdate`
   applies `dollarsToCents` to `askingPrice`, `ttmProfit` and `inventoryCostEstimate`, because
   the patch's contract is the admin form's. Read tools report cents. **Resolved:** the
   asymmetry is stated in capitals in the tool description and pinned by a test that asserts
   the raw patch reaches the core untouched. Task 5.

6. **`"Unexpected error (ref <audit_id>)"` (spec §7.4) cannot use an audit id.** `withAudit`
   writes its error row and re-throws without returning the id, so by the time the tool
   catches, there is nothing to quote. **Resolved:** the reference is a generated UUID attached
   to the Sentry event as the `mcp_ref` tag, and the message reads `Unexpected error (ref
   <uuid>)`. An operator searches Sentry by that tag. Task 1.

7. **"Expected" vs "unexpected" errors** are not distinguishable by type in the spec.
   **Resolved:** a thrown plain `Error` (`err.name === "Error"`) is one of ours and its message
   is surfaced verbatim; any `Error` subclass (`NeonDbError`, `TypeError`, `ZodError`) or
   non-Error is unexpected and goes to Sentry. This works because every PR A core mutation
   refuses by throwing a plain `Error` with UI copy. Task 1.

8. **§8 asks for "a read-only token calling a write → 403"**, but §7.1 says write tools are
   *omitted* for read-only tokens — an omitted tool produces "tool not found", not a 403.
   **Resolved:** both. Registration is omitted (so `tools/list` filters), *and* the route
   pre-reads the JSON body and answers a `tools/call` naming a `WRITE_TOOL_NAMES` member with
   403 `insufficient_scope`. A test pins `WRITE_TOOL_NAMES` to the actual registration diff so
   the two can never drift. Tasks 9 and 10.

9. **Write rate limiting placement.** §7.6 says "per-token limit on write tools".
   **Resolved:** in the shared `writeTool` wrapper rather than the route, so every write tool
   is covered by construction and the limit is exercised by the tool tests rather than only by
   route tests. Task 1.

10. **`revoke_mcp_connection` has no auditing core function.** PR B's `revokeMcpToken` returns
    `{ ok }` and writes no audit row, but §7.4 requires `{ audit_id, target }` from every write.
    **Resolved:** this one tool calls `withAudit(actor, "mcp_token.revoke", { type:
    "mcp_token", id }, args, fn)` itself. It is the only such case, and a comment says so at
    the call site. Task 9.

11. **`outputSchema` is not declared on any tool.** §7.2 requires `title`, `description`,
    `inputSchema` and `annotations`; `outputSchema` is optional. Destructive tools return two
    different shapes (the preview and the executed result), which a single output schema could
    only express as a union that adds no safety. **Resolved:** no `outputSchema` anywhere;
    every tool still returns `structuredContent` alongside the compact JSON text block, which
    is what §7.2 actually asks for.

12. **Tool names are unprefixed**, against `mcp-builder`'s `{service}_{action}_{resource}`
    guidance. **Resolved:** the spec's §7.3/§7.4 tables fix the names, and MCP clients already
    namespace tools by server name (`hs-marketplace`). Noted in Global Constraints so nobody
    "fixes" it later.
