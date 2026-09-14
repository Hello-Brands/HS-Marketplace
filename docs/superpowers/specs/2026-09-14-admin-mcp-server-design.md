# Admin MCP Server — Design

**Date:** 2026-09-14
**Status:** Approved for planning
**Branch:** `feature/admin-mcp-server`

## 1. Goal

Give marketplace admins a remote MCP (Model Context Protocol) server, hosted inside
this Next.js app on Vercel, that lets an AI client (Claude.ai, Claude Desktop,
Claude Code) **read everything happening on the marketplace and take every admin
action the web UI can take today**. Every action, from the UI or the MCP, is
recorded in a new admin audit log and surfaced in an activity feed.

### Non-goals (v1)

- Dynamic Client Registration (DCR) and Client ID Metadata Documents (CIMD).
  Metadata is laid out so CIMD can be added later without breaking connections.
- BigQuery-backed financial tools (net sales, MCR, KPIs).
- New admin powers the UI lacks today (admin delist/unpublish, ban/suspend,
  admin-triggered alert matching, re-sending seller emails).
- Elicitation-based confirmation. Claude.ai web does not support elicitation.
- Logging seller/buyer actions (listing edits by sellers, favorites, alerts).
- A stdio/local MCP variant.

## 2. Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Hosting | Remote endpoint `POST /api/mcp` in this app | Reuses DB, auth, server logic; reachable from Claude.ai web |
| Client auth | OAuth 2.1, hand-rolled authorization server in this app | Claude.ai custom connectors need OAuth (static headers are a gated beta); pre-registered client IDs avoid DCR; no second identity vendor |
| MCP transport library | `@modelcontextprotocol/server` v2 directly (Streamable HTTP, stateless) | Ships web-standard handler, bearer verification, metadata helpers, zod 4. `mcp-handler` 2.x adds nothing on top |
| Write scope | Wrap existing admin actions only | Nothing the UI can't already do |
| Read scope | Marketplace data only | Keeps BigQuery latency and credential gotchas out of v1 |
| Guardrails | Audit log every admin action (UI + MCP); two-step confirm on destructive tools; read-only scope | User choice |
| Event tracking | Log all admin mutations, UI and MCP | Closes the never-built `audit_log` item from `.planning/research/PITFALLS.md` |

## 3. Constraints from the codebase

- Admin is `users.role === "admin"` (`src/db/schema/auth.ts`). Guard helper is
  `requireAdmin()` in `src/lib/auth-guards.ts`, which reads the Auth.js **database
  session cookie**. An MCP request carries a bearer token and no cookie, so existing
  `"use server"` actions cannot be called from the MCP path. Core logic must be
  extracted (section 5).
- Neon HTTP driver: **no transactions**. Multi-row writes use `db.batch`.
- Hand-authored migrations only; `drizzle-kit generate` is broken (snapshot drift).
  Next migration number is **0009**.
- Every `"use server"` export is a public POST endpoint. New shared modules must not
  be `"use server"` and carry the same "NOT a use server module" header used by
  `src/lib/alerts/matching.ts`.
- `src/lib/rate-limit.ts` is per-instance in-memory (DEBT-028). Any MCP rate limit
  is best-effort.
- Auth.js sessions are database-backed; never put NextAuth in `middleware.ts`.
- Modified Next.js: mirror sibling routes; `params` is a Promise.
- vitest: node env, `src/__tests__/**/*.test.ts` only, no component tests.
- `brand_requests` is co-written by the external competitor-monitor repo. Never
  cache reads of it.
- `competitor_opportunities` and `monitored_brands` are scraper/monitor-owned.
  Read-only.

## 4. OAuth 2.1 authorization server

### 4.1 Tables (migration 0010, shipped in PR B — see section 9)

**`mcp_oauth_clients`** — pre-registered clients, seeded by script, never via DCR.

| column | type | notes |
|---|---|---|
| `client_id` | text PK | e.g. `claude-hosted`, `claude-code` |
| `name` | text | display name on consent page |
| `redirect_uris` | jsonb (string[]) | exact match, except loopback rule below |
| `is_public` | boolean | true = PKCE only, no secret. Both seeded clients are public |
| `created_at` | timestamptz | |

Seeded rows:
- `claude-hosted`: `["https://claude.ai/api/mcp/auth_callback"]`
- `claude-code`: `["http://localhost/callback", "http://127.0.0.1/callback"]`
  — **port is ignored when matching** loopback URIs (RFC 8252 / MCP client-registration spec).

**`mcp_oauth_codes`** — authorization codes.

| column | type | notes |
|---|---|---|
| `code_hash` | text PK | SHA-256 of the opaque code |
| `client_id` | text FK → clients | |
| `user_id` | text FK → users (cascade) | |
| `redirect_uri` | text | must match on exchange |
| `code_challenge` | text | S256 only |
| `scope` | text | space-separated |
| `resource` | text | RFC 8707 resource indicator |
| `label` | text null | optional connection label from consent |
| `expires_at` | timestamptz | now + 5 min |
| `used_at` | timestamptz null | single use |
| `created_at` | timestamptz | |

**`mcp_oauth_tokens`** — one row per grant (access + refresh pair).

| column | type | notes |
|---|---|---|
| `id` | text PK | app-generated |
| `token_hash` | text unique | SHA-256 of access token |
| `refresh_token_hash` | text unique | SHA-256 of refresh token |
| `client_id` | text FK → clients | |
| `user_id` | text FK → users (cascade) | |
| `scope` | text | |
| `label` | text null | |
| `expires_at` | timestamptz | access: now + 1 h |
| `refresh_expires_at` | timestamptz | now + 30 d |
| `last_used_at` | timestamptz null | updated at most once per minute |
| `revoked_at` | timestamptz null | |
| `created_at` | timestamptz | |

Indexes: `(user_id)`, `(expires_at)`.

Tokens are 32-byte random values, base64url encoded, hashed with SHA-256 at rest.
A DB read never yields a usable token. Refresh rotates both hashes in place and
extends `expires_at`; the previous access token is invalid immediately.

### 4.2 Routes

All Node runtime, under `src/app/`.

| Route | Method | Purpose |
|---|---|---|
| `/.well-known/oauth-authorization-server` | GET, OPTIONS | RFC 8414 metadata |
| `/.well-known/oauth-protected-resource` | GET, OPTIONS | RFC 9728 metadata |
| `/.well-known/oauth-protected-resource/api/mcp` | GET, OPTIONS | path-suffixed variant; Claude probes this first |
| `/mcp/authorize` | GET | authorization endpoint (page) |
| `/mcp/token` | POST | token endpoint |
| `/mcp/revoke` | POST | RFC 7009 revocation |

**Authorization server metadata** advertises:
`issuer` = `MCP_ISSUER_URL`; `authorization_endpoint`, `token_endpoint`,
`revocation_endpoint`; `response_types_supported: ["code"]`;
`grant_types_supported: ["authorization_code", "refresh_token"]`;
`code_challenge_methods_supported: ["S256"]`;
`token_endpoint_auth_methods_supported: ["none"]`;
`scopes_supported: ["marketplace:read", "marketplace:write"]`;
`authorization_response_iss_parameter_supported: true`. **No**
`registration_endpoint`, **no** `client_id_metadata_document_supported`.

**Protected resource metadata**: `resource` = exact MCP URL (`${MCP_ISSUER_URL}/api/mcp`),
`authorization_servers: [MCP_ISSUER_URL]`, `scopes_supported`,
`bearer_methods_supported: ["header"]`.

**`GET /mcp/authorize`** (page + server action):
1. Validate `client_id` exists, `redirect_uri` matches (loopback rule),
   `response_type=code`, `code_challenge` present, `code_challenge_method=S256`,
   `resource` equals the MCP URL, requested `scope` ⊆ supported. On any failure
   with an invalid `redirect_uri` render an error page (never redirect). With a
   valid `redirect_uri`, redirect with `error=invalid_request` etc.
2. No Auth.js session → redirect to `/login?callbackUrl=<this URL>`.
3. Session but `role !== "admin"` → render access-denied (reuse `/access-denied` copy).
4. Render consent: client name, radio **Read only** / **Read and write**, optional
   label (max 60 chars), Approve / Deny. Deny redirects with `error=access_denied`.
5. Approve (server action, `requireAdmin()`): mint code, insert row, redirect to
   `redirect_uri?code=…&state=…&iss=<issuer>`.

**`POST /mcp/token`**: `application/x-www-form-urlencoded` only (JSON → 415).
- `grant_type=authorization_code`: look up `code_hash`; reject if missing, used,
  expired, `client_id` mismatch, `redirect_uri` mismatch, `resource` mismatch, or
  `SHA256(code_verifier) != code_challenge`. Mark used, mint token row, return
  `{ access_token, token_type: "Bearer", expires_in, refresh_token, scope }`.
- `grant_type=refresh_token`: look up `refresh_token_hash`; reject if revoked or
  refresh expired; re-check user still `admin`; rotate both tokens; return same shape.
- Errors follow RFC 6749 (`invalid_grant`, `invalid_client`, `invalid_request`,
  `unsupported_grant_type`) with `Cache-Control: no-store`.

**`POST /mcp/revoke`**: accepts `token` (access or refresh); sets `revoked_at`.
Always 200 per RFC 7009.

### 4.3 Bearer verification (every MCP request)

`src/lib/mcp/auth/verify-token.ts` → `verifyMcpToken(bearer): Promise<McpActor | null>`:
1. `SHA256(bearer)` → token row. Null if missing, `revoked_at` set, or `expires_at` past.
2. Reload `users` row; null unless `role === "admin"`. **Demotion revokes MCP
   access on the next call**, not at token expiry.
3. Touch `last_used_at` if older than 60 s.
4. Return `{ userId, email, scopes, clientId, tokenId }`.

Failure → 401 with
`WWW-Authenticate: Bearer resource_metadata="<PRM URL>", scope="marketplace:read"`.
Missing scope → 403 with `error="insufficient_scope"`.

### 4.4 Admin UI

`/admin/mcp-connections`: table of grants (label, client, scope, created, last used,
status) with **Revoke**. Shows the caller's own grants by default with an
"All admins" toggle. Includes copy-paste setup instructions for Claude.ai (URL +
client ID `claude-hosted`) and Claude Code
(`claude mcp add --transport http hs-marketplace <url> --client-id claude-code`).
Added to admin nav in `src/lib/navigation.ts`.

### 4.5 Env

- `MCP_ISSUER_URL` — defaults to the app's canonical URL; validated as https URL.
- `MCP_CONFIRM_SECRET` — ≥ 32 chars, used in section 7.
Both added to `src/lib/env.ts`.

## 5. Core-logic extraction

New folder `src/lib/admin/core/`, plain modules (not `"use server"`), each with the
"NOT a use server module" header:

| module | functions extracted from |
|---|---|
| `listings.ts` | `src/lib/admin/actions.ts` (approve, reject, update, markSold, getPending, getAll) |
| `users.ts` | `src/app/admin/users/actions.ts` (setUserRole, setSellerAccess, removeUser, getUsers) |
| `allowlist.ts` | same file (addToAllowlist, removeFromAllowlist, getAllowlist) |
| `brand-requests.ts` | `src/lib/brand-requests/actions.ts` (approve, reject, retryDispatch) |
| `owner-links.ts` | `src/lib/owner-directory/actions.ts` (add, revoke, clear) |
| `owner-directory.ts` | same file (refreshOwnerDirectory) |
| `data-mappings.ts` | `src/lib/data/mapping-actions.ts` (setLocationMapping) |
| `inquiries.ts`, `analytics.ts` | read paths from `src/app/admin/{inquiries,analytics}/actions.ts` |

Every mutation takes an **actor** first:

```ts
export type AdminActor = {
  userId: string;
  source: "ui" | "mcp";
  clientId?: string;   // mcp only
  tokenId?: string;    // mcp only
};
```

Core functions keep today's behavior byte-for-byte: state-machine checks,
`db.batch` writes, emails, `triggerAlertMatching`, `revalidatePath` calls, and the
existing error convention (throw for admin actions; `{ ok:false, error }` for
`addToAllowlist` and `setLocationMapping`).

Existing server actions become thin wrappers:

```ts
export async function approveListing(id: string) {
  const session = await requireAdmin();
  return approveListingCore({ userId: session.user.id, source: "ui" }, id);
}
```

Exported names and signatures are unchanged, so no client component changes.
`setLocationMapping`'s inline role check is replaced with `requireAdmin()`.

## 6. Audit log and activity feed

### 6.1 Table `admin_audit_log` (migration 0009, shipped in PR A)

| column | type | notes |
|---|---|---|
| `id` | text PK | app-generated |
| `actor_user_id` | text FK → users (set null on delete) | |
| `source` | text | `ui` \| `mcp` |
| `mcp_client_id` | text null | |
| `mcp_token_id` | text null | |
| `action` | text | dotted verb, e.g. `listing.approve`, `user.set_role`, `mcp.read` |
| `target_type` | text null | `listing` \| `user` \| `allowlist` \| `brand_request` \| `owner_link` \| `listing_location` \| `owner_directory` \| `mcp_token` |
| `target_id` | text null | |
| `args` | jsonb | redacted: strings > 2 KB truncated; keys named `message`, `notes`, `body` replaced with `[redacted]` |
| `outcome` | text | `ok` \| `error` |
| `error` | text null | message only |
| `duration_ms` | integer | |
| `created_at` | timestamptz | |

Indexes: `(created_at desc)`, `(target_type, target_id)`, `(actor_user_id, created_at desc)`.

### 6.2 Writer

`src/lib/admin/audit.ts`:

```ts
withAudit(actor, action, target, args, fn): Promise<T>
```

Runs `fn`, inserts one row on success (`ok`) or failure (`error`, then re-throws).
Insert failure is logged to Sentry and swallowed so auditing never blocks the action.
Every core mutation is called through it. UI reads are not audited. **MCP reads**
write one row with `action = "mcp.read"`, `args = { tool, filters }`.

### 6.3 Activity feed

`src/lib/admin/activity.ts` → `getRecentActivity({ kinds?, actorUserId?, since?, cursor?, limit })`.
One SQL `UNION ALL` producing `{ at, kind, id, actor, target, summary }` from:

| kind | source |
|---|---|
| `admin_action` | `admin_audit_log` (excluding `mcp.read`) |
| `listing_created` / `listing_listed` / `listing_updated` | `listings.created_at` / `listed_at` / `updated_at` (updated only when ≠ created) |
| `inquiry` | `contacts.created_at` |
| `favorite` | `favorites.created_at` |
| `login` | `login_events.created_at` |
| `brand_request_submitted` / `brand_request_decided` | `brand_requests.created_at` / `decided_at` |
| `owner_link_changed` | `user_owner_links.updated_at` |

Ordered `at desc, kind, id`; keyset cursor is base64 of `(at, kind, id)`.

### 6.4 UI

`/admin/activity`: feed with filters (kind, actor, source, since) and a link from each
row to the target's admin page. Added to admin nav.

## 7. MCP endpoint and tools

### 7.1 Endpoint

`src/app/api/mcp/route.ts` (POST, plus GET/DELETE returning 405) →
`createMcpHandler` from `@modelcontextprotocol/server` in stateless mode, wrapped so
that `verifyMcpToken` runs first and the actor is placed on the request context.
Tool registration lives in `src/lib/mcp/server.ts`; tools in `src/lib/mcp/tools/*.ts`
grouped by domain. `tools/list` filters by scope: write tools are omitted for
read-only tokens.

Dependencies added: `@modelcontextprotocol/server@^2`, `@modelcontextprotocol/core@^2`
(and `@modelcontextprotocol/client@^2` as a dev dependency for tests).

### 7.2 Conventions

- Names `snake_case` verbs; one operation per tool; every tool has `title`,
  `description`, zod 4 `inputSchema`, and honest `annotations`
  (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`).
- List tools accept `limit` (default 25, max 100) and `cursor`; return `{ items, next_cursor }`.
- Money returned as `{ cents, formatted }`.
- Free-text inputs capped (`search` 200 chars, reasons/notes 2 000 chars).
- Results are compact JSON in a single text content block plus `structuredContent`.

### 7.3 Read tools (`marketplace:read`, `readOnlyHint: true`)

| tool | source |
|---|---|
| `get_marketplace_overview` | counts by listing status, pending queue, open brand requests, users/admins, inquiries & logins 7d/30d (reuse `getAnalyticsSummary` core) |
| `list_recent_activity` | section 6.3 |
| `list_listings` | `getAllListings` core + filters status/type/state/sellerId/search |
| `get_listing` | `loadAdminListing` + recent inquiries, view count, audit history for the listing |
| `list_users` / `get_user` | `getUsers` / `getUserAnalytics` core + owner links, listings, alerts, favorites |
| `list_allowlist` | `getAllowlist` core |
| `list_inquiries` | `getInquiries` core + listingId/since filters |
| `list_brand_requests` / `get_brand_request` | direct DB, no cache |
| `list_owner_directory` | `getOwnerDirectory(search)` |
| `list_owner_links` | `listUsersWithLinks` |
| `list_unresolved_data_mappings` | `unresolvedSalonLocations` + `suggestLocationMatch` |
| `list_competitor_closures` | `getCompetitorClosures` with existing filters |
| `list_alerts` | `alerts` table + owner |
| `list_audit_log` | `admin_audit_log` with actor/action/target/source filters |
| `list_mcp_connections` | caller's grants; `all: true` for every admin's |

### 7.4 Write tools (`marketplace:write`)

| tool | core function | destructive |
|---|---|---|
| `approve_listing` | `approveListing` | no |
| `reject_listing` | `rejectListing` | yes |
| `update_listing` | `adminUpdateListing` (same zod patch schema) | yes |
| `mark_listing_sold` | `adminMarkSold` | yes |
| `set_user_role` | `setUserRole` | yes |
| `set_seller_access` | `setSellerAccess` | no |
| `add_to_allowlist` | `addToAllowlist` | no |
| `remove_from_allowlist` | `removeFromAllowlist` | yes |
| `remove_user` | `removeUser` | yes |
| `approve_brand_request` | `approveBrandRequest` | no |
| `reject_brand_request` | `rejectBrandRequest` | yes |
| `retry_brand_request_dispatch` | `retryMonitorDispatch` | no |
| `add_owner_link` | `addOwnerLink` | no |
| `revoke_owner_link` | `revokeOwnerLink` | yes |
| `clear_owner_link` | `clearOwnerLink` | yes |
| `set_location_data_mapping` | `setLocationMapping` | no |
| `refresh_owner_directory` | `refreshOwnerDirectory` | no |
| `revoke_mcp_connection` | new; caller's own grants only | yes |

Every write result includes `{ audit_id, target }` where `target` is the post-write
state. Tool errors are `isError: true` with the UI's message; unexpected exceptions
go to Sentry and return `"Unexpected error (ref <audit_id>)"`.

### 7.5 Destructive confirmation

Destructive tools take optional `confirmation_token: string`.

- **Without it**: run the same pre-checks the action would (state machine,
  last-admin rule, unresolved mappings, non-empty reason), then return
  `{ preview: "<human sentence>", confirmation_token, expires_in: 600 }` and make no changes.
- **With it**: verify and execute.
- Token = base64url(payload) + "." + HMAC-SHA256(payload, `MCP_CONFIRM_SECRET`) where
  payload = `{ tool, args: canonicalJson(args minus confirmation_token), userId, exp }`.
  Any argument change, another actor, or expiry (10 min) invalidates it. Stateless.
- Destructive tools also set `destructiveHint: true` and
  `_meta["anthropic/requiresUserInteraction"] = true` so Claude.ai prompts per call
  and Claude Code prompts even in auto modes.

### 7.6 Rate limiting

Per-token limit on write tools via the existing `src/lib/rate-limit.ts` (best-effort,
DEBT-028): 30 writes / minute. `POST /mcp/token`: 20 requests / minute / IP.

## 8. Testing

All in `src/__tests__/`, node env.

- **OAuth primitives**: PKCE S256 verify, token hash, redirect matching incl.
  loopback port-ignore, code single-use/expiry, refresh rotation, resource check.
- **OAuth routes**: handlers invoked with `Request`; mocked DB; happy path and every
  rejection branch; JSON body to `/mcp/token` → 415; metadata document shapes.
- **Confirmation tokens**: round-trip, tampered args, wrong actor, expired.
- **Core extraction**: existing admin-action tests pass unchanged; new tests call core
  functions with an `mcp` actor and assert audit rows on `ok` and on thrown error.
- **Tools**: in-memory MCP client (`@modelcontextprotocol/client`) against the server:
  schema rejection, `tools/list` scope filtering, read-only token calling a write → 403,
  destructive preview-then-execute, result shape, `mcp.read` audit row.
- **Activity feed**: ordering and cursor stability against seeded data.
- **Live check before merging PR C**: Claude Code (`claude mcp add --transport http`)
  and Claude.ai custom connector with client ID `claude-hosted`; one read, one confirmed
  write; verify audit row on `/admin/activity` and grant on `/admin/mcp-connections`.

Gates per PR: `npx tsc --noEmit`, `npx eslint .`, `npm test`. Dev server off during
any `next build` (Windows `.next` lock).

## 9. Rollout

Three PRs, each cut from `origin/main`:

1. **PR A — core extraction + audit log + activity page.** Migration `0009` (audit
   table only). No MCP code. Largest diff, lowest risk.
2. **PR B — OAuth server.** Migration `0010` (three OAuth tables), routes, consent
   page, `/admin/mcp-connections`, seed script `scripts/seed-mcp-clients.ts`, env vars.
3. **PR C — MCP endpoint + tools + confirmation.**

Migrations are hand-authored, applied with the guarded push after preview
verification. Prod env gains `MCP_CONFIRM_SECRET` and `MCP_ISSUER_URL` before PR B
deploys.

## 10. Follow-ups (not v1)

- CIMD support (`client_id_metadata_document_supported`) so Claude can use its
  published identity without a pre-registered client.
- BigQuery financial tools behind an additional scope.
- Admin delist/unpublish and suspend actions (new core functions).
- Seller/buyer event logging into the activity feed.
- Elicitation-based confirmation once Claude.ai supports it.
- Durable rate limiting (DEBT-028) if MCP write volume warrants it.
