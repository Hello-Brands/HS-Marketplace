# Admin MCP Server — PR B: OAuth 2.1 Authorization Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a hand-rolled OAuth 2.1 authorization server inside this Next.js app — discovery metadata, an admin consent page, token/refresh/revoke endpoints, bearer verification, and an `/admin/mcp-connections` management screen — so that PR C's `POST /api/mcp` can authenticate Claude.ai and Claude Code with a scoped, revocable bearer token.

**Architecture:** Three new tables (migration `0012`) hold pre-registered clients, single-use authorization codes, and one row per grant (access + refresh pair, both SHA-256 hashed at rest). All crypto and matching logic lives in pure, DB-free modules under `src/lib/mcp/oauth/` so it is unit-testable in this repo's node-env vitest; the App Router routes under `src/app/.well-known/**` and `src/app/mcp/**` are thin shells over them. `verifyMcpToken` in `src/lib/mcp/auth/verify-token.ts` is the single entry point PR C imports, and it re-reads `users.role` on every call so an admin demotion kills MCP access immediately rather than at token expiry.

**Tech Stack:** Next.js 15 App Router (React 18), TypeScript, Drizzle ORM on Neon Postgres (neon-http driver — **no transactions**, `db.batch` instead), Auth.js v5 with database sessions, zod 4 via `@t3-oss/env-nextjs`, Node `crypto` for all token material, vitest (node environment), Tailwind v4 with a brand `@theme`.

**Spec:** `docs/superpowers/specs/2026-09-14-admin-mcp-server-design.md` — this plan implements sections **4.1–4.5**, the OAuth slice of **8 (testing)**, and the PR B row of **9 (rollout)**. Section 3 lists the codebase constraints every task must honor.

## Global Constraints

- **This is PR B of three.** It is cut from `origin/main` **after PR A has merged**, because it imports `withAudit` from `@/lib/admin/audit` and `uiActor` from `@/lib/admin/core/actor` (both shipped by PR A) and because its migration number assumes PR A's `0011` is already in `drizzle/meta/_journal.json`. If `drizzle/0011_*.sql` is absent when you start, **stop and report** — do not renumber.
- **Migration number is `0012_mcp_oauth`.** `0011` belongs to PR A's `admin_audit_log`.
- **`drizzle-kit generate` is broken in this repo** (snapshot drift). The `.sql` file, the `drizzle/meta/_journal.json` entry, **and** `drizzle/meta/0012_snapshot.json` are all hand-authored. Never run `npm run db:generate` or `npm run db:push`.
- **Neon HTTP driver has no `db.transaction`.** Any multi-row atomic write uses `db.batch([...])` (see `src/lib/owner-directory/login.ts:76`).
- **Every `"use server"` export is a public POST endpoint.** New shared modules must NOT be `"use server"` and must carry the "NOT a use server module" header used by `src/lib/alerts/matching.ts`. Every `"use server"` export in this PR starts with `await requireAdmin()`.
- **Token material is 32 random bytes, base64url**, stored only as `sha256Hex(...)`. A database read must never yield a usable token. No token, code, or verifier is ever logged.
- **PKCE is S256 only.** `plain` is not accepted and is not advertised.
- **Only two scopes exist, spelled exactly:** `marketplace:read` and `marketplace:write`.
- **Access token TTL 1 hour; refresh token TTL 30 days; authorization code TTL 5 minutes; `last_used_at` touched at most once per 60 s.**
- **`/mcp/token` and `/mcp/revoke` accept `application/x-www-form-urlencoded` only** — any other content type is `415`. Every token-endpoint response carries `Cache-Control: no-store`.
- **`src/lib/rate-limit.ts` is per-instance in-memory (DEBT-028).** The 20/min/IP limit on `/mcp/token` is best-effort by design; do not claim otherwise in comments.
- **Never put NextAuth in `src/middleware.ts`.** The edge gate is a cookie-presence check; new public paths go in `src/lib/auth-public-paths.ts`.
- **Modified Next.js — mirror sibling routes, never memory.** `params` and `searchParams` are Promises (`src/app/api/actions/[token]/route.ts`, `src/app/(auth)/access-denied/page.tsx`). `node_modules/next/dist/docs/` does not exist in this checkout.
- **vitest: node environment, `src/__tests__/**/*.test.ts` only.** React components cannot be rendered or even imported in tests — all testable logic lives in `.ts` modules, and client components are gated by `tsc` plus a browser check.
- **Do not run `next build` while a dev server is running** (Windows `.next` lock). Per-task type gate is `npx tsc --noEmit`.
- **Never start `npm run dev` unprompted.** Manual verification steps say to ask the user.
- **Push account:** only `sugarparker` can push to `Hello-Brands/HS-Marketplace`. On a 403, run `gh auth switch`.
- **Every commit message ends with the line** `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Environment variables and issuer URLs

The issuer URL is the root of every other string in this PR — metadata documents, the `iss` redirect parameter, the RFC 8707 `resource` value, and the `WWW-Authenticate` challenge all derive from it. It lands first so nothing else has to guess.

`MCP_CONFIRM_SECRET` is declared here even though nothing in PR B reads it: spec §4.5 puts both vars in this PR, and spec §9 requires prod to hold both **before** PR B deploys. It is a **required** var, so adding it without setting it in Vercel breaks the next production build — Step 7 is not optional.

**Files:**
- Modify: `src/lib/env.ts` (server block, after `SENTRY_DSN`)
- Create: `src/lib/mcp/oauth/urls.ts`
- Modify: `.env.example` (append a section)
- Modify: `README.md:25` and `README.md:29` (env var lists)
- Test: `src/__tests__/mcp/oauth-urls.test.ts`

**Interfaces:**
- Consumes: `env` from `@/lib/env` (a live `process.env` proxy under the test runner — see the comment at the bottom of `src/lib/env.ts`, which is why `vi.stubEnv` works below).
- Produces:
  - `issuerUrl(): string` — `MCP_ISSUER_URL ?? NEXT_PUBLIC_APP_URL`, trailing slashes stripped
  - `mcpResourceUrl(): string` — `` `${issuerUrl()}/api/mcp` ``
  - `protectedResourceMetadataUrl(): string` — `` `${issuerUrl()}/.well-known/oauth-protected-resource/api/mcp` ``
  - `env.MCP_ISSUER_URL: string | undefined`, `env.MCP_CONFIRM_SECRET: string`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/mcp/oauth-urls.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  issuerUrl,
  mcpResourceUrl,
  protectedResourceMetadataUrl,
} from "@/lib/mcp/oauth/urls"

/**
 * env.X is a live view of process.env under the test runner (see the Proxy at
 * the bottom of src/lib/env.ts), so vi.stubEnv in beforeEach is visible to the
 * module under test even though it was imported at file load.
 */
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://marketplace.hellosugar.salon")
  vi.stubEnv("MCP_ISSUER_URL", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("issuerUrl", () => {
  it("falls back to NEXT_PUBLIC_APP_URL when MCP_ISSUER_URL is unset", () => {
    expect(issuerUrl()).toBe("https://marketplace.hellosugar.salon")
  })

  it("prefers MCP_ISSUER_URL when it is set", () => {
    vi.stubEnv("MCP_ISSUER_URL", "https://mcp.hellosugar.salon")
    expect(issuerUrl()).toBe("https://mcp.hellosugar.salon")
  })

  it("strips trailing slashes so concatenated paths never double up", () => {
    vi.stubEnv("MCP_ISSUER_URL", "https://mcp.hellosugar.salon///")
    expect(issuerUrl()).toBe("https://mcp.hellosugar.salon")
  })

  it("throws when neither var is set, rather than emitting 'undefined/api/mcp'", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "")
    expect(() => issuerUrl()).toThrow(/MCP_ISSUER_URL/)
  })
})

describe("derived URLs", () => {
  it("builds the RFC 8707 resource identifier for the MCP endpoint", () => {
    expect(mcpResourceUrl()).toBe("https://marketplace.hellosugar.salon/api/mcp")
  })

  it("builds the path-suffixed protected-resource metadata URL Claude probes first", () => {
    expect(protectedResourceMetadataUrl()).toBe(
      "https://marketplace.hellosugar.salon/.well-known/oauth-protected-resource/api/mcp",
    )
  })

  it("derives both from the issuer override, not from the app URL", () => {
    vi.stubEnv("MCP_ISSUER_URL", "https://mcp.hellosugar.salon/")
    expect(mcpResourceUrl()).toBe("https://mcp.hellosugar.salon/api/mcp")
    expect(protectedResourceMetadataUrl()).toBe(
      "https://mcp.hellosugar.salon/.well-known/oauth-protected-resource/api/mcp",
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run src/__tests__/mcp/oauth-urls.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/mcp/oauth/urls"`.

- [ ] **Step 3: Add the two env vars**

In `src/lib/env.ts`, inside the `server:` object, directly after the `SENTRY_DSN` line:

```ts
    // Public origin of the MCP OAuth authorization server (spec §4.5). Optional:
    // src/lib/mcp/oauth/urls.ts falls back to NEXT_PUBLIC_APP_URL. Set it only
    // when the MCP issuer is not the app's own canonical origin — changing it
    // after clients have connected invalidates their stored metadata.
    MCP_ISSUER_URL: z.string().url().optional(),
    // HMAC key for the destructive-tool confirmation tokens in spec §7.5.
    // REQUIRED and declared here (not in PR C) so prod carries it before this
    // PR deploys; nothing in PR B reads it yet.
    MCP_CONFIRM_SECRET: z.string().min(32),
```

- [ ] **Step 4: Write the URL helpers**

Create `src/lib/mcp/oauth/urls.ts`:

```ts
/**
 * Canonical URLs for the MCP OAuth authorization server.
 *
 * This module is deliberately NOT a `"use server"` file — every export of such
 * a module is reachable as an unauthenticated POST endpoint. It is a plain
 * helper imported by routes, the consent page and PR C's MCP endpoint.
 *
 * Every OAuth string in this feature hangs off `issuerUrl()`: the metadata
 * documents, the `iss` parameter on the authorization redirect (RFC 9207), the
 * RFC 8707 `resource` indicator, and the `WWW-Authenticate` challenge. Keep one
 * source so a mismatch is impossible — clients reject a `resource` that differs
 * from the one they were issued against by a single character.
 */
import { env } from "@/lib/env"

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "")
}

/** `MCP_ISSUER_URL` when set, else the app's canonical URL. No trailing slash. */
export function issuerUrl(): string {
  const raw = env.MCP_ISSUER_URL || env.NEXT_PUBLIC_APP_URL
  if (!raw) {
    // Throw rather than emit "undefined/api/mcp", which clients would cache.
    throw new Error(
      "MCP issuer URL is not configured: set MCP_ISSUER_URL or NEXT_PUBLIC_APP_URL",
    )
  }
  return stripTrailingSlash(raw)
}

/** RFC 8707 resource indicator — the exact MCP endpoint URL. */
export function mcpResourceUrl(): string {
  return `${issuerUrl()}/api/mcp`
}

/**
 * RFC 9728 protected-resource metadata URL, path-suffixed with the resource's
 * own path. Claude probes this variant first.
 */
export function protectedResourceMetadataUrl(): string {
  return `${issuerUrl()}/.well-known/oauth-protected-resource/api/mcp`
}
```

- [ ] **Step 5: Run the test to verify it passes**

```
npx vitest run src/__tests__/mcp/oauth-urls.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Document the vars**

Append to `.env.example`:

```
# MCP admin server (spec docs/superpowers/specs/2026-09-14-admin-mcp-server-design.md).
# Optional. Public origin of the OAuth authorization server; defaults to NEXT_PUBLIC_APP_URL.
# Changing it after clients connect invalidates their cached metadata.
# MCP_ISSUER_URL=https://marketplace.hellosugar.salon
# REQUIRED, >= 32 chars. HMAC key for destructive-tool confirmation tokens.
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
MCP_CONFIRM_SECRET=your-mcp-confirm-secret-at-least-32-characters
```

In `README.md`, change line 25 from:

```
**Required — server:** `DATABASE_URL` (pooled), `DATABASE_URL_DIRECT` (direct, for migrations), `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `RESEND_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `ACTION_TOKEN_SECRET`, `CRON_SECRET`.
```

to:

```
**Required — server:** `DATABASE_URL` (pooled), `DATABASE_URL_DIRECT` (direct, for migrations), `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `RESEND_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `ACTION_TOKEN_SECRET`, `CRON_SECRET`, `MCP_CONFIRM_SECRET` (≥ 32 chars — HMAC key for MCP destructive-tool confirmations).
```

and append to the optional list on line 29, before the closing period:

```
, `MCP_ISSUER_URL` (MCP OAuth issuer origin — defaults to `NEXT_PUBLIC_APP_URL`)
```

- [ ] **Step 7: Set the required var locally and in Vercel**

Add a real value to the gitignored `.env.local` (this repo's build fails without it):

```bash
node -e "console.log('MCP_CONFIRM_SECRET=' + require('crypto').randomBytes(32).toString('base64url'))" >> .env.local
```

Then ask the user to add `MCP_CONFIRM_SECRET` to the Vercel project (Production **and** Preview) before this branch is merged. `MCP_ISSUER_URL` stays unset — the app's canonical URL is the issuer. Do not merge this PR until the user confirms the Vercel var exists; a missing required var fails `next build` on every deploy, not just MCP requests.

- [ ] **Step 8: Type-check and run the suite**

```
npx tsc --noEmit
npm test
```

Expected: no type errors; all tests pass. Tests set `SKIP_ENV_VALIDATION`, so the new required var does not break the suite.

- [ ] **Step 9: Commit**

```bash
git add src/lib/env.ts src/lib/mcp/oauth/urls.ts src/__tests__/mcp/oauth-urls.test.ts .env.example README.md
git commit -m "$(cat <<'EOF'
feat(mcp): MCP issuer env vars and OAuth URL helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration 0012 and the Drizzle schema for the three OAuth tables

**Order inside this task matters.** The migration is applied to the database *before* the Drizzle schema declares the tables, matching how `0010` was sequenced: several call sites select every declared column, so a schema that describes tables Postgres does not have turns into a runtime "relation does not exist".

**Files:**
- Create: `drizzle/0012_mcp_oauth.sql`
- Create: `drizzle/meta/0012_snapshot.json`
- Modify: `drizzle/meta/_journal.json` (append one entry)
- Create: `src/db/schema/mcpOauth.ts`
- Modify: `src/db/schema.ts` (append one export)
- Test: `src/__tests__/db/migration-artifacts.test.ts` (extend — the existing gate reads a snapshot per journal entry)

**Interfaces:**
- Consumes: `users` from `src/db/schema/auth.ts`.
- Produces (imported by every later task):
  - `mcpOauthClients` — `{ clientId, name, redirectUris: string[], isPublic, createdAt }`
  - `mcpOauthCodes` — `{ codeHash, clientId, userId, redirectUri, codeChallenge, scope, resource, label, expiresAt, usedAt, createdAt }`
  - `mcpOauthTokens` — `{ id, tokenHash, refreshTokenHash, clientId, userId, scope, label, expiresAt, refreshExpiresAt, lastUsedAt, revokedAt, createdAt }`
  - Types `McpOauthClient`, `McpOauthCode`, `McpOauthToken` (`$inferSelect`)
  - All three reachable as `db.query.mcpOauthClients` / `.mcpOauthCodes` / `.mcpOauthTokens` via the barrel

- [ ] **Step 1: Confirm PR A has landed**

```bash
ls drizzle/0011_*.sql && node -e "const j=require('./drizzle/meta/_journal.json');console.log(j.entries.at(-1))"
```

Expected: one `0011_*.sql` file, and a last journal entry with `"idx": 11`. If the last entry is `idx: 10`, PR A has not merged — **stop and report**. Do not renumber this migration to `0011`.

- [ ] **Step 2: Author the migration SQL**

Create `drizzle/0012_mcp_oauth.sql`:

```sql
CREATE TABLE "mcp_oauth_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text NOT NULL,
	"resource" text NOT NULL,
	"label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_oauth_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "mcp_oauth_tokens_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_oauth_codes" ADD CONSTRAINT "mcp_oauth_codes_client_id_mcp_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_oauth_clients"("client_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_oauth_codes" ADD CONSTRAINT "mcp_oauth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_oauth_tokens" ADD CONSTRAINT "mcp_oauth_tokens_client_id_mcp_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_oauth_clients"("client_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_oauth_tokens" ADD CONSTRAINT "mcp_oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX "mcp_oauth_codes_user_id_idx" ON "mcp_oauth_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_codes_client_id_idx" ON "mcp_oauth_codes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_codes_expires_at_idx" ON "mcp_oauth_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mcp_oauth_tokens_user_id_idx" ON "mcp_oauth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_tokens_client_id_idx" ON "mcp_oauth_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_tokens_expires_at_idx" ON "mcp_oauth_tokens" USING btree ("expires_at");
```

Three notes on deliberate choices:

- `ON DELETE cascade` on both `user_id` FKs: deleting an admin must not leave usable grants behind. The `client_id` FKs are `no action` — a seeded client must never be deletable while grants reference it.
- Spec §4.1 names indexes `(user_id)` and `(expires_at)` for the tokens table. The `client_id` indexes and the three on `mcp_oauth_codes` are added on top because Postgres does not auto-index foreign keys, and both cascade deletes and the expiry sweep would otherwise sequential-scan.
- `UNIQUE` on both hash columns is what makes "one row per grant, rotated in place" safe: a rotation that somehow collided would error rather than silently create two live tokens.

- [ ] **Step 3: Register the migration in the journal**

The migrator reads **only** `_journal.json` to decide which files to run; a `.sql` file with no entry is silently skipped.

In `drizzle/meta/_journal.json`, append to `entries` after PR A's `0011` entry (adding a comma to that entry's closing brace):

```json
    {
      "idx": 12,
      "version": "7",
      "when": 1789344000000,
      "tag": "0012_mcp_oauth",
      "breakpoints": true
    }
```

`when` must be strictly greater than `0011`'s. `1789344000000` is 2026-09-14T00:00:00Z. If PR A chose a `when` at or after that instant, bump this one to PR A's `when + 86400000` — `src/__tests__/db/migration-artifacts.test.ts` asserts strictly increasing `when`.

- [ ] **Step 4: Hand-author the snapshot**

`drizzle/meta/0012_snapshot.json` is mandatory, not optional: `src/__tests__/db/migration-artifacts.test.ts` reads one snapshot per journal entry and chains `prevId`, so a journal entry without a matching snapshot fails the suite on a missing-file throw.

Build it mechanically, exactly as `0005`–`0011` were built:

```bash
cp drizzle/meta/0011_snapshot.json drizzle/meta/0012_snapshot.json
node -e "console.log(require('crypto').randomUUID())"   # new id
node -e "console.log(require('./drizzle/meta/0011_snapshot.json').id)"  # becomes prevId
```

Set the copy's `id` to the fresh UUID and its `prevId` to `0011`'s `id`. Then add these three entries to `tables`, after `"public.monitored_brands"` (leave every other table byte-identical):

```json
    "public.mcp_oauth_clients": {
      "name": "mcp_oauth_clients",
      "schema": "",
      "columns": {
        "client_id": { "name": "client_id", "type": "text", "primaryKey": true, "notNull": true },
        "name": { "name": "name", "type": "text", "primaryKey": false, "notNull": true },
        "redirect_uris": { "name": "redirect_uris", "type": "jsonb", "primaryKey": false, "notNull": true },
        "is_public": { "name": "is_public", "type": "boolean", "primaryKey": false, "notNull": true, "default": true },
        "created_at": { "name": "created_at", "type": "timestamp with time zone", "primaryKey": false, "notNull": true, "default": "now()" }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {},
      "checkConstraints": {},
      "isRLSEnabled": false
    },
    "public.mcp_oauth_codes": {
      "name": "mcp_oauth_codes",
      "schema": "",
      "columns": {
        "code_hash": { "name": "code_hash", "type": "text", "primaryKey": true, "notNull": true },
        "client_id": { "name": "client_id", "type": "text", "primaryKey": false, "notNull": true },
        "user_id": { "name": "user_id", "type": "text", "primaryKey": false, "notNull": true },
        "redirect_uri": { "name": "redirect_uri", "type": "text", "primaryKey": false, "notNull": true },
        "code_challenge": { "name": "code_challenge", "type": "text", "primaryKey": false, "notNull": true },
        "scope": { "name": "scope", "type": "text", "primaryKey": false, "notNull": true },
        "resource": { "name": "resource", "type": "text", "primaryKey": false, "notNull": true },
        "label": { "name": "label", "type": "text", "primaryKey": false, "notNull": false },
        "expires_at": { "name": "expires_at", "type": "timestamp with time zone", "primaryKey": false, "notNull": true },
        "used_at": { "name": "used_at", "type": "timestamp with time zone", "primaryKey": false, "notNull": false },
        "created_at": { "name": "created_at", "type": "timestamp with time zone", "primaryKey": false, "notNull": true, "default": "now()" }
      },
      "indexes": {
        "mcp_oauth_codes_user_id_idx": { "name": "mcp_oauth_codes_user_id_idx", "columns": [{ "expression": "user_id", "isExpression": false, "asc": true, "nulls": "last" }], "isUnique": false, "concurrently": false, "method": "btree", "with": {} },
        "mcp_oauth_codes_client_id_idx": { "name": "mcp_oauth_codes_client_id_idx", "columns": [{ "expression": "client_id", "isExpression": false, "asc": true, "nulls": "last" }], "isUnique": false, "concurrently": false, "method": "btree", "with": {} },
        "mcp_oauth_codes_expires_at_idx": { "name": "mcp_oauth_codes_expires_at_idx", "columns": [{ "expression": "expires_at", "isExpression": false, "asc": true, "nulls": "last" }], "isUnique": false, "concurrently": false, "method": "btree", "with": {} }
      },
      "foreignKeys": {
        "mcp_oauth_codes_client_id_mcp_oauth_clients_client_id_fk": { "name": "mcp_oauth_codes_client_id_mcp_oauth_clients_client_id_fk", "tableFrom": "mcp_oauth_codes", "tableTo": "mcp_oauth_clients", "columnsFrom": ["client_id"], "columnsTo": ["client_id"], "onDelete": "no action", "onUpdate": "no action" },
        "mcp_oauth_codes_user_id_users_id_fk": { "name": "mcp_oauth_codes_user_id_users_id_fk", "tableFrom": "mcp_oauth_codes", "tableTo": "users", "columnsFrom": ["user_id"], "columnsTo": ["id"], "onDelete": "cascade", "onUpdate": "no action" }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {},
      "checkConstraints": {},
      "isRLSEnabled": false
    },
    "public.mcp_oauth_tokens": {
      "name": "mcp_oauth_tokens",
      "schema": "",
      "columns": {
        "id": { "name": "id", "type": "text", "primaryKey": true, "notNull": true },
        "token_hash": { "name": "token_hash", "type": "text", "primaryKey": false, "notNull": true },
        "refresh_token_hash": { "name": "refresh_token_hash", "type": "text", "primaryKey": false, "notNull": true },
        "client_id": { "name": "client_id", "type": "text", "primaryKey": false, "notNull": true },
        "user_id": { "name": "user_id", "type": "text", "primaryKey": false, "notNull": true },
        "scope": { "name": "scope", "type": "text", "primaryKey": false, "notNull": true },
        "label": { "name": "label", "type": "text", "primaryKey": false, "notNull": false },
        "expires_at": { "name": "expires_at", "type": "timestamp with time zone", "primaryKey": false, "notNull": true },
        "refresh_expires_at": { "name": "refresh_expires_at", "type": "timestamp with time zone", "primaryKey": false, "notNull": true },
        "last_used_at": { "name": "last_used_at", "type": "timestamp with time zone", "primaryKey": false, "notNull": false },
        "revoked_at": { "name": "revoked_at", "type": "timestamp with time zone", "primaryKey": false, "notNull": false },
        "created_at": { "name": "created_at", "type": "timestamp with time zone", "primaryKey": false, "notNull": true, "default": "now()" }
      },
      "indexes": {
        "mcp_oauth_tokens_user_id_idx": { "name": "mcp_oauth_tokens_user_id_idx", "columns": [{ "expression": "user_id", "isExpression": false, "asc": true, "nulls": "last" }], "isUnique": false, "concurrently": false, "method": "btree", "with": {} },
        "mcp_oauth_tokens_client_id_idx": { "name": "mcp_oauth_tokens_client_id_idx", "columns": [{ "expression": "client_id", "isExpression": false, "asc": true, "nulls": "last" }], "isUnique": false, "concurrently": false, "method": "btree", "with": {} },
        "mcp_oauth_tokens_expires_at_idx": { "name": "mcp_oauth_tokens_expires_at_idx", "columns": [{ "expression": "expires_at", "isExpression": false, "asc": true, "nulls": "last" }], "isUnique": false, "concurrently": false, "method": "btree", "with": {} }
      },
      "foreignKeys": {
        "mcp_oauth_tokens_client_id_mcp_oauth_clients_client_id_fk": { "name": "mcp_oauth_tokens_client_id_mcp_oauth_clients_client_id_fk", "tableFrom": "mcp_oauth_tokens", "tableTo": "mcp_oauth_clients", "columnsFrom": ["client_id"], "columnsTo": ["client_id"], "onDelete": "no action", "onUpdate": "no action" },
        "mcp_oauth_tokens_user_id_users_id_fk": { "name": "mcp_oauth_tokens_user_id_users_id_fk", "tableFrom": "mcp_oauth_tokens", "tableTo": "users", "columnsFrom": ["user_id"], "columnsTo": ["id"], "onDelete": "cascade", "onUpdate": "no action" }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "mcp_oauth_tokens_token_hash_unique": { "name": "mcp_oauth_tokens_token_hash_unique", "nullsNotDistinct": false, "columns": ["token_hash"] },
        "mcp_oauth_tokens_refresh_token_hash_unique": { "name": "mcp_oauth_tokens_refresh_token_hash_unique", "nullsNotDistinct": false, "columns": ["refresh_token_hash"] }
      },
      "policies": {},
      "checkConstraints": {},
      "isRLSEnabled": false
    },
```

Confirm the file is still valid JSON:

```bash
node -e "const s=require('./drizzle/meta/0012_snapshot.json');console.log(Object.keys(s.tables).filter(t=>t.includes('mcp')))"
```

Expected: `[ 'public.mcp_oauth_clients', 'public.mcp_oauth_codes', 'public.mcp_oauth_tokens' ]`.

- [ ] **Step 5: Apply the migration**

```
npm run db:migrate
```

Expected: `Running migrations...` then `Migrations complete`. The database's `drizzle.__drizzle_migrations` table already records `0000`–`0011`, so this run applies only `0012`. (The known "a fresh `db:migrate` fails at 0008" problem applies to replaying the whole folder against an empty database, not to this incremental run.)

If it fails on a checksum mismatch for an earlier migration, **stop and report** rather than editing older files.

- [ ] **Step 6: Verify the tables against the real database**

Write `scripts/_tmp-verify-0012.ts`:

```ts
import { db } from "@/db"
import { sql } from "drizzle-orm"

async function main() {
  const cols = await db.execute(sql`
    select table_name, column_name, data_type, is_nullable
    from information_schema.columns
    where table_name in ('mcp_oauth_clients','mcp_oauth_codes','mcp_oauth_tokens')
    order by table_name, ordinal_position`)
  console.log("columns:", JSON.stringify(cols.rows ?? cols, null, 1))

  const cons = await db.execute(sql`
    select conname, contype from pg_constraint
    where conrelid::regclass::text like 'mcp_oauth%'
    order by conname`)
  console.log("constraints:", JSON.stringify(cons.rows ?? cons))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

```
npx tsx --env-file=.env.local scripts/_tmp-verify-0012.ts
rm scripts/_tmp-verify-0012.ts
```

Expected: 5 columns on `mcp_oauth_clients`, 11 on `mcp_oauth_codes`, 12 on `mcp_oauth_tokens`; every `timestamp with time zone`; both `mcp_oauth_tokens_*_unique` constraints present with `contype: "u"`; four `*_fk` constraints with `contype: "f"`.

- [ ] **Step 7: Write the Drizzle schema**

Create `src/db/schema/mcpOauth.ts`:

```ts
import {
  pgTable,
  text,
  jsonb,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core"
import { users } from "./auth"

/**
 * OAuth 2.1 authorization-server tables for the admin MCP endpoint
 * (spec §4.1, migration 0012).
 *
 * Secrets discipline: `mcp_oauth_codes.code_hash`, `mcp_oauth_tokens.token_hash`
 * and `mcp_oauth_tokens.refresh_token_hash` hold SHA-256 hex digests, never the
 * value itself. A database dump therefore yields nothing a client could present.
 * Do NOT add a plaintext column for debugging.
 *
 * Every timestamp is timestamptz: these instants are compared against `now()`
 * from a serverless runtime whose local zone is not ours.
 */

/**
 * Pre-registered clients. There is no Dynamic Client Registration in v1, so
 * rows arrive only from scripts/seed-mcp-clients.ts. `redirect_uris` is matched
 * exactly, except that loopback URIs ignore the port
 * (RFC 8252 §7.3 — Claude Code binds an ephemeral port).
 */
export const mcpOauthClients = pgTable("mcp_oauth_clients", {
  clientId: text("client_id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  // true = public client: PKCE only, no client secret. Both seeded clients are
  // public; the token endpoint advertises token_endpoint_auth_methods_supported
  // ["none"] to match.
  isPublic: boolean("is_public").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

/** Single-use authorization codes. 5-minute TTL; `used_at` enforces single use. */
export const mcpOauthCodes = pgTable(
  "mcp_oauth_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpOauthClients.clientId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Must equal the value presented at the token endpoint, byte for byte.
    redirectUri: text("redirect_uri").notNull(),
    // PKCE S256 challenge. `plain` is neither accepted nor advertised.
    codeChallenge: text("code_challenge").notNull(),
    // Space-separated, a subset of MCP_SCOPES.
    scope: text("scope").notNull(),
    // RFC 8707 resource indicator — the exact MCP endpoint URL.
    resource: text("resource").notNull(),
    // Optional connection label typed on the consent screen (max 60 chars).
    label: text("label"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Postgres does not auto-index FKs; the user cascade and the client join
    // would otherwise sequential-scan.
    index("mcp_oauth_codes_user_id_idx").on(table.userId),
    index("mcp_oauth_codes_client_id_idx").on(table.clientId),
    index("mcp_oauth_codes_expires_at_idx").on(table.expiresAt),
  ],
)

/**
 * One row per grant, holding the access/refresh pair. Refresh ROTATES both
 * hashes in place and extends both expiries, so the previous access token stops
 * working immediately — there is never a second live row for one grant.
 */
export const mcpOauthTokens = pgTable(
  "mcp_oauth_tokens",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tokenHash: text("token_hash").notNull().unique(),
    refreshTokenHash: text("refresh_token_hash").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpOauthClients.clientId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    label: text("label"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", {
      withTimezone: true,
    }).notNull(),
    // Touched at most once per 60 s by verifyMcpToken, so a busy client does
    // not turn every MCP call into a write.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("mcp_oauth_tokens_user_id_idx").on(table.userId),
    index("mcp_oauth_tokens_client_id_idx").on(table.clientId),
    index("mcp_oauth_tokens_expires_at_idx").on(table.expiresAt),
  ],
)

export type McpOauthClient = typeof mcpOauthClients.$inferSelect
export type McpOauthCode = typeof mcpOauthCodes.$inferSelect
export type McpOauthToken = typeof mcpOauthTokens.$inferSelect
```

- [ ] **Step 8: Export from the barrel**

Append to `src/db/schema.ts`:

```ts
// MCP OAuth 2.1 authorization server (spec §4.1; migration 0012)
export * from "./schema/mcpOauth"
```

This is what makes `db.query.mcpOauthClients` / `.mcpOauthCodes` / `.mcpOauthTokens` exist — `src/db/index.ts` builds the query API from this barrel, and every later task uses it.

- [ ] **Step 9: Extend the migration-artifacts gate**

Append to `src/__tests__/db/migration-artifacts.test.ts`, inside the existing `describe` block:

```ts
  it("records the three mcp_oauth tables in the latest snapshot", () => {
    const latest = journal.entries.length - 1
    const snap = JSON.parse(
      readFileSync(path.join(DRIZZLE, "meta", `${String(latest).padStart(4, "0")}_snapshot.json`), "utf8")
    )

    expect(Object.keys(snap.tables["public.mcp_oauth_clients"].columns).sort()).toEqual([
      "client_id", "created_at", "is_public", "name", "redirect_uris",
    ])
    expect(Object.keys(snap.tables["public.mcp_oauth_codes"].columns).sort()).toEqual([
      "client_id", "code_challenge", "code_hash", "created_at", "expires_at",
      "label", "redirect_uri", "resource", "scope", "used_at", "user_id",
    ])

    const tokens = snap.tables["public.mcp_oauth_tokens"]
    expect(Object.keys(tokens.columns).sort()).toEqual([
      "client_id", "created_at", "expires_at", "id", "label", "last_used_at",
      "refresh_expires_at", "refresh_token_hash", "revoked_at", "scope",
      "token_hash", "user_id",
    ])
    // Both hashes unique: a rotation that collided must error, never leave two
    // live tokens for one grant.
    expect(Object.keys(tokens.uniqueConstraints).sort()).toEqual([
      "mcp_oauth_tokens_refresh_token_hash_unique",
      "mcp_oauth_tokens_token_hash_unique",
    ])
    // Deleting an admin must not leave usable grants behind.
    expect(tokens.foreignKeys["mcp_oauth_tokens_user_id_users_id_fk"].onDelete).toBe("cascade")
  })
```

- [ ] **Step 10: Run the gate and the type-check**

```
npx vitest run src/__tests__/db/migration-artifacts.test.ts
npx tsc --noEmit
```

Expected: PASS (5 tests — 4 pre-existing plus the new one); no type errors.

- [ ] **Step 11: Commit**

```bash
git add drizzle/0012_mcp_oauth.sql drizzle/meta/_journal.json drizzle/meta/0012_snapshot.json src/db/schema/mcpOauth.ts src/db/schema.ts src/__tests__/db/migration-artifacts.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): migration 0012 and Drizzle schema for the OAuth tables

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Pure OAuth primitives — scopes, constants, token/PKCE/redirect helpers

Everything in this task is DB-free and side-effect-free, which is the only way it can be tested in this repo (vitest runs in a node environment with a `.ts`-only glob). Every later task builds on these four modules.

**Files:**
- Create: `src/lib/mcp/oauth/scopes.ts`
- Create: `src/lib/mcp/oauth/constants.ts`
- Create: `src/lib/mcp/oauth/tokens.ts`
- Test: `src/__tests__/mcp/oauth-tokens.test.ts`

**Interfaces:**
- Consumes: Node `crypto` only.
- Produces:
  - `MCP_SCOPES = ["marketplace:read", "marketplace:write"] as const`, `type McpScope = typeof MCP_SCOPES[number]`, `isMcpScope(value: string): value is McpScope`, `parseScopeString(raw: string | null): McpScope[] | null` (null = contains an unknown scope)
  - `AUTHORIZATION_CODE_TTL_MS`, `ACCESS_TOKEN_TTL_MS`, `REFRESH_TOKEN_TTL_MS`, `LAST_USED_TOUCH_INTERVAL_MS`, `CONSENT_LABEL_MAX_LENGTH`, `TOKEN_ENDPOINT_RATE_LIMIT`, `TOKEN_ENDPOINT_RATE_WINDOW_MS` — all `number`
  - `generateOpaqueToken(): string`
  - `sha256Hex(value: string): string`
  - `verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean`
  - `redirectUriMatches(registered: string[], presented: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/mcp/oauth-tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import {
  generateOpaqueToken,
  sha256Hex,
  verifyPkceS256,
  redirectUriMatches,
} from "@/lib/mcp/oauth/tokens"
import { MCP_SCOPES, isMcpScope, parseScopeString } from "@/lib/mcp/oauth/scopes"

describe("generateOpaqueToken", () => {
  it("returns 32 bytes of entropy, base64url encoded", () => {
    const token = generateOpaqueToken()
    // 32 bytes -> 43 base64url chars, no padding, no + or /
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token, "base64url")).toHaveLength(32)
  })

  it("never repeats across a large sample", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateOpaqueToken()))
    expect(seen.size).toBe(500)
  })
})

describe("sha256Hex", () => {
  it("is the SHA-256 hex digest of the UTF-8 bytes", () => {
    expect(sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    )
  })

  it("is stable and 64 hex characters wide", () => {
    const token = generateOpaqueToken()
    expect(sha256Hex(token)).toBe(sha256Hex(token))
    expect(sha256Hex(token)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("differs for values that differ by one character", () => {
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"))
  })
})

describe("verifyPkceS256", () => {
  // The worked example from RFC 7636 Appendix B.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

  it("accepts the RFC 7636 Appendix B vector", () => {
    expect(verifyPkceS256(verifier, challenge)).toBe(true)
  })

  it("accepts a freshly generated verifier/challenge pair", () => {
    const v = generateOpaqueToken()
    const c = createHash("sha256").update(v, "ascii").digest("base64url")
    expect(verifyPkceS256(v, c)).toBe(true)
  })

  it("rejects a verifier that does not hash to the challenge", () => {
    expect(verifyPkceS256("wrong-verifier", challenge)).toBe(false)
  })

  it("rejects the base64 (non-url) spelling of the same digest", () => {
    // A client that sent standard base64 must fail rather than half-match.
    const standard = createHash("sha256").update(verifier, "ascii").digest("base64")
    expect(standard).not.toBe(challenge)
    expect(verifyPkceS256(verifier, standard)).toBe(false)
  })

  it("rejects empty inputs instead of treating them as a match", () => {
    expect(verifyPkceS256("", "")).toBe(false)
    expect(verifyPkceS256(verifier, "")).toBe(false)
    expect(verifyPkceS256("", challenge)).toBe(false)
  })
})

describe("redirectUriMatches", () => {
  const hosted = ["https://claude.ai/api/mcp/auth_callback"]
  const code = ["http://localhost/callback", "http://127.0.0.1/callback"]

  it("accepts an exact match", () => {
    expect(redirectUriMatches(hosted, "https://claude.ai/api/mcp/auth_callback")).toBe(true)
  })

  it("rejects a different path on the registered host", () => {
    expect(redirectUriMatches(hosted, "https://claude.ai/api/mcp/evil")).toBe(false)
  })

  it("rejects a lookalike host", () => {
    expect(redirectUriMatches(hosted, "https://claude.ai.evil.com/api/mcp/auth_callback")).toBe(false)
  })

  it("rejects an added query string on a non-loopback URI", () => {
    expect(redirectUriMatches(hosted, "https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false)
  })

  it("ignores the port on a loopback URI (RFC 8252 §7.3)", () => {
    // Claude Code binds an ephemeral port it cannot register ahead of time.
    expect(redirectUriMatches(code, "http://localhost:54321/callback")).toBe(true)
    expect(redirectUriMatches(code, "http://127.0.0.1:8976/callback")).toBe(true)
  })

  it("still requires the loopback path to match", () => {
    expect(redirectUriMatches(code, "http://localhost:54321/steal")).toBe(false)
  })

  it("does not extend the port exemption to non-loopback hosts", () => {
    expect(redirectUriMatches(hosted, "https://claude.ai:8443/api/mcp/auth_callback")).toBe(false)
  })

  it("does not treat an https loopback as matching an http registration", () => {
    expect(redirectUriMatches(code, "https://localhost:54321/callback")).toBe(false)
  })

  it("rejects a host that merely contains 'localhost'", () => {
    expect(redirectUriMatches(code, "http://localhost.evil.com:80/callback")).toBe(false)
  })

  it("rejects an unparseable URI without throwing", () => {
    expect(() => redirectUriMatches(code, "not a url")).not.toThrow()
    expect(redirectUriMatches(code, "not a url")).toBe(false)
  })

  it("rejects everything when the client registered no URIs", () => {
    expect(redirectUriMatches([], "http://localhost:1234/callback")).toBe(false)
  })
})

describe("scopes", () => {
  it("exposes exactly the two supported scopes, in order", () => {
    expect(MCP_SCOPES).toEqual(["marketplace:read", "marketplace:write"])
  })

  it("recognises supported scopes and nothing else", () => {
    expect(isMcpScope("marketplace:read")).toBe(true)
    expect(isMcpScope("marketplace:write")).toBe(true)
    expect(isMcpScope("marketplace:admin")).toBe(false)
    expect(isMcpScope("")).toBe(false)
  })

  it("parses a space-separated scope string", () => {
    expect(parseScopeString("marketplace:read marketplace:write")).toEqual([
      "marketplace:read",
      "marketplace:write",
    ])
  })

  it("tolerates extra whitespace", () => {
    expect(parseScopeString("  marketplace:read   marketplace:write  ")).toEqual([
      "marketplace:read",
      "marketplace:write",
    ])
  })

  it("defaults an absent or empty scope to every supported scope", () => {
    // The consent screen narrows this down; an omitted scope must not mean none.
    expect(parseScopeString(null)).toEqual(["marketplace:read", "marketplace:write"])
    expect(parseScopeString("   ")).toEqual(["marketplace:read", "marketplace:write"])
  })

  it("returns null when any requested scope is unknown", () => {
    expect(parseScopeString("marketplace:read marketplace:delete")).toBeNull()
  })

  it("de-duplicates repeated scopes", () => {
    expect(parseScopeString("marketplace:read marketplace:read")).toEqual([
      "marketplace:read",
    ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run src/__tests__/mcp/oauth-tokens.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/mcp/oauth/tokens"`.

- [ ] **Step 3: Write the scopes module**

Create `src/lib/mcp/oauth/scopes.ts`:

```ts
/**
 * The MCP scope vocabulary.
 *
 * NOT a `"use server"` module — every export of such a module is a public POST
 * endpoint. This is a plain constants/parsing module, imported by the consent
 * page, the metadata routes, the token endpoint and PR C's tool registry.
 *
 * Kept free of any `@/db` or `@/lib/env` import so it stays usable from pure
 * unit tests and from `tsx` scripts.
 */
export const MCP_SCOPES = ["marketplace:read", "marketplace:write"] as const

export type McpScope = (typeof MCP_SCOPES)[number]

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value)
}

/**
 * Parse a space-separated OAuth scope string.
 *
 * Returns the de-duplicated list, or `null` when ANY entry is unsupported —
 * the caller turns null into `error=invalid_scope`. An absent or whitespace-only
 * value means "everything supported": the consent screen is what narrows the
 * grant, so an omitted `scope` must not silently mint a zero-scope token.
 */
export function parseScopeString(raw: string | null | undefined): McpScope[] | null {
  const parts = (raw ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return [...MCP_SCOPES]
  if (!parts.every(isMcpScope)) return null
  return [...new Set(parts as McpScope[])]
}

/** Render a scope list back into the wire format. */
export function formatScopes(scopes: readonly McpScope[]): string {
  return scopes.join(" ")
}
```

- [ ] **Step 4: Write the constants module**

Create `src/lib/mcp/oauth/constants.ts`:

```ts
/**
 * Lifetimes and limits for the MCP OAuth server (spec §4.1, §4.3, §7.6).
 *
 * NOT a `"use server"` module. Kept dependency-free so both routes and tests
 * read the same numbers — a test that hard-codes "3600" drifts silently.
 */

/** Authorization code TTL. Short by design: it is exchanged immediately. */
export const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000

/** Access token TTL (spec §4.1: now + 1 h). */
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000

/** Refresh token TTL (spec §4.1: now + 30 d). Extended on every rotation. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Minimum gap between `last_used_at` writes. Without it every MCP call becomes
 * a write; with it the column is accurate to the minute, which is all the
 * admin UI claims.
 */
export const LAST_USED_TOUCH_INTERVAL_MS = 60 * 1000

/** Consent-screen label cap (spec §4.2 step 4). */
export const CONSENT_LABEL_MAX_LENGTH = 60

/**
 * Token endpoint: 20 requests per minute per IP (spec §7.6).
 * Best-effort only — src/lib/rate-limit.ts is per-instance in-memory (DEBT-028).
 */
export const TOKEN_ENDPOINT_RATE_LIMIT = 20
export const TOKEN_ENDPOINT_RATE_WINDOW_MS = 60 * 1000
```

- [ ] **Step 5: Write the crypto and matching helpers**

Create `src/lib/mcp/oauth/tokens.ts`:

```ts
/**
 * Pure OAuth primitives: token minting, hashing, PKCE verification and
 * redirect-URI matching.
 *
 * NOT a `"use server"` module and deliberately DB-free, so every branch is
 * unit-testable under this repo's node-env vitest (no component tests, `.ts`
 * glob only). Node `crypto` is used directly — `jose` is a dependency but
 * these are opaque tokens, not JWTs, so there is nothing to sign or parse.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * 32 bytes of CSPRNG entropy, base64url encoded (43 chars, no padding).
 * Used for authorization codes, access tokens and refresh tokens alike — only
 * the hash is ever stored, so one generator covers all three.
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url")
}

/** SHA-256 hex digest — the at-rest form of every code and token. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

/**
 * RFC 7636 S256: BASE64URL(SHA256(ASCII(code_verifier))) === code_challenge.
 *
 * Compared with `timingSafeEqual` even though the challenge is not a secret:
 * the verifier is, and a length-aware early return plus byte-wise compare keeps
 * this from becoming an oracle if the two are ever swapped at a call site.
 */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false
  const computed = createHash("sha256").update(codeVerifier, "ascii").digest("base64url")
  const a = Buffer.from(computed, "utf8")
  const b = Buffer.from(codeChallenge, "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * Exact string match against the client's registered URIs, with one carve-out:
 * an `http` loopback URI matches on scheme + host + path + query while IGNORING
 * the port (RFC 8252 §7.3, echoed by the MCP client-registration spec). Claude
 * Code binds an ephemeral port it cannot register ahead of time.
 *
 * The carve-out is narrow on purpose: https loopback does not match an http
 * registration, a host that merely contains "localhost" is not loopback, and a
 * differing path or query fails like any other URI.
 */
export function redirectUriMatches(registered: string[], presented: string): boolean {
  if (registered.includes(presented)) return true

  let url: URL
  try {
    url = new URL(presented)
  } catch {
    return false
  }
  if (url.protocol !== "http:") return false
  if (!LOOPBACK_HOSTS.has(url.hostname)) return false

  return registered.some((candidate) => {
    let reg: URL
    try {
      reg = new URL(candidate)
    } catch {
      return false
    }
    return (
      reg.protocol === url.protocol &&
      reg.hostname === url.hostname &&
      reg.pathname === url.pathname &&
      reg.search === url.search
    )
  })
}
```

- [ ] **Step 6: Run the test to verify it passes**

```
npx vitest run src/__tests__/mcp/oauth-tokens.test.ts
```

Expected: PASS, 27 tests.

- [ ] **Step 7: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/oauth/scopes.ts src/lib/mcp/oauth/constants.ts src/lib/mcp/oauth/tokens.ts src/__tests__/mcp/oauth-tokens.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): PKCE, token hashing and redirect-URI matching primitives

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Discovery metadata routes and the edge-gate allowlist

Three GET/OPTIONS routes serve two documents. Claude probes the path-suffixed protected-resource URL first, so all three must exist and must be reachable **without a session cookie** — which means adding them to `src/lib/auth-public-paths.ts`. The same change opens `/mcp/authorize`, `/mcp/token` and `/mcp/revoke`: each authenticates itself (session, PKCE code, bearer token) and the cookie gate would otherwise bounce the OAuth flow to `/login`.

`src/app/.well-known/**` is a real route segment — a leading dot is not Next's private-folder marker (`_` is), and the middleware matcher's `.*\.[^/]+$` exclusion does not fire because the dot is followed by a `/`.

**Files:**
- Create: `src/lib/mcp/oauth/metadata.ts`
- Create: `src/app/.well-known/oauth-authorization-server/route.ts`
- Create: `src/app/.well-known/oauth-protected-resource/route.ts`
- Create: `src/app/.well-known/oauth-protected-resource/api/mcp/route.ts`
- Modify: `src/lib/auth-public-paths.ts` (add 4 entries to `PUBLIC_PATHS`)
- Test: `src/__tests__/mcp/oauth-metadata-routes.test.ts`
- Test: `src/__tests__/middleware-gate.test.ts` (extend the public-path and lookalike lists)

**Interfaces:**
- Consumes: `issuerUrl`, `mcpResourceUrl` (Task 1); `MCP_SCOPES` (Task 3).
- Produces:
  - `authorizationServerMetadata(): Record<string, unknown>`
  - `protectedResourceMetadata(): Record<string, unknown>`
  - `METADATA_CORS_HEADERS: Record<string, string>`
  - `metadataResponse(body: unknown): Response` and `metadataPreflightResponse(): Response`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/mcp/oauth-metadata-routes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Tests the REAL route handlers under src/app/.well-known/**. Nothing is
 * mocked except the environment — these documents are pure functions of the
 * issuer URL, and their exact key set is a contract with Claude's client.
 */

import {
  GET as authServerGet,
  OPTIONS as authServerOptions,
} from "@/app/.well-known/oauth-authorization-server/route"
import {
  GET as prGet,
  OPTIONS as prOptions,
} from "@/app/.well-known/oauth-protected-resource/route"
import {
  GET as prSuffixedGet,
  OPTIONS as prSuffixedOptions,
} from "@/app/.well-known/oauth-protected-resource/api/mcp/route"

const ISSUER = "https://marketplace.hellosugar.salon"

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ISSUER)
  vi.stubEnv("MCP_ISSUER_URL", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("authorization server metadata (RFC 8414)", () => {
  it("advertises the endpoints, grants and PKCE method the server implements", async () => {
    const res = await authServerGet()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/mcp/authorize`,
      token_endpoint: `${ISSUER}/mcp/token`,
      revocation_endpoint: `${ISSUER}/mcp/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["marketplace:read", "marketplace:write"],
      authorization_response_iss_parameter_supported: true,
    })
  })

  it("omits registration_endpoint and CIMD support (v1 has no DCR)", async () => {
    const body = await (await authServerGet()).json()
    expect(body).not.toHaveProperty("registration_endpoint")
    expect(body).not.toHaveProperty("client_id_metadata_document_supported")
  })

  it("never advertises the plain PKCE method", async () => {
    const body = await (await authServerGet()).json()
    expect(body.code_challenge_methods_supported).not.toContain("plain")
  })

  it("serves JSON with permissive CORS so a browser-based client can read it", async () => {
    const res = await authServerGet()
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS")
    expect(res.headers.get("access-control-allow-headers")).toBe("*")
  })

  it("answers the CORS preflight with 204 and the same headers", async () => {
    const res = await authServerOptions()
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS")
    expect(res.headers.get("access-control-allow-headers")).toBe("*")
  })

  it("follows MCP_ISSUER_URL when it overrides the app URL", async () => {
    vi.stubEnv("MCP_ISSUER_URL", "https://mcp.hellosugar.salon")
    const body = await (await authServerGet()).json()
    expect(body.issuer).toBe("https://mcp.hellosugar.salon")
    expect(body.token_endpoint).toBe("https://mcp.hellosugar.salon/mcp/token")
  })
})

describe("protected resource metadata (RFC 9728)", () => {
  const expected = {
    resource: `${ISSUER}/api/mcp`,
    authorization_servers: [ISSUER],
    scopes_supported: ["marketplace:read", "marketplace:write"],
    bearer_methods_supported: ["header"],
  }

  it("names the exact MCP endpoint as the resource", async () => {
    expect(await (await prGet()).json()).toEqual(expected)
  })

  it("serves the identical document at the path-suffixed URL Claude probes first", async () => {
    expect(await (await prSuffixedGet()).json()).toEqual(expected)
  })

  it("sets CORS on both variants", async () => {
    for (const res of [await prGet(), await prSuffixedGet()]) {
      expect(res.headers.get("access-control-allow-origin")).toBe("*")
      expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS")
      expect(res.headers.get("access-control-allow-headers")).toBe("*")
    }
  })

  it("answers the CORS preflight on both variants", async () => {
    expect((await prOptions()).status).toBe(204)
    expect((await prSuffixedOptions()).status).toBe(204)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run src/__tests__/mcp/oauth-metadata-routes.test.ts
```

Expected: FAIL — `Failed to resolve import "@/app/.well-known/oauth-authorization-server/route"`.

- [ ] **Step 3: Write the metadata builders**

Create `src/lib/mcp/oauth/metadata.ts`:

```ts
/**
 * RFC 8414 (authorization server) and RFC 9728 (protected resource) discovery
 * documents.
 *
 * NOT a `"use server"` module. Shared by the three `.well-known` routes so the
 * two protected-resource URLs cannot drift apart.
 *
 * Deliberately absent: `registration_endpoint` and
 * `client_id_metadata_document_supported`. v1 has no Dynamic Client
 * Registration and no CIMD (spec section 1 non-goals); advertising either would
 * make clients attempt a flow that does not exist. The shape leaves room to add
 * CIMD later without invalidating existing connections.
 */
import { issuerUrl, mcpResourceUrl } from "./urls"
import { MCP_SCOPES } from "./scopes"

export function authorizationServerMetadata(): Record<string, unknown> {
  const issuer = issuerUrl()
  return {
    issuer,
    authorization_endpoint: `${issuer}/mcp/authorize`,
    token_endpoint: `${issuer}/mcp/token`,
    revocation_endpoint: `${issuer}/mcp/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // S256 only. `plain` is neither accepted by /mcp/token nor advertised here.
    code_challenge_methods_supported: ["S256"],
    // Both seeded clients are public: PKCE is the proof, there is no secret.
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SCOPES],
    // RFC 9207: we return `iss` on the authorization redirect, so clients can
    // pin the response to this server.
    authorization_response_iss_parameter_supported: true,
  }
}

export function protectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [issuerUrl()],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
  }
}

/**
 * Discovery documents are public and are fetched cross-origin by browser-based
 * clients, so they carry wide-open CORS. They contain no secrets and no
 * user-specific data — only URLs this server already publishes.
 */
export const METADATA_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
}

export function metadataResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Short cache: the documents are static in practice, but a bad issuer
      // value must be fixable inside a deploy cycle rather than an hour later.
      "Cache-Control": "public, max-age=300",
      ...METADATA_CORS_HEADERS,
    },
  })
}

export function metadataPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { ...METADATA_CORS_HEADERS, "Access-Control-Max-Age": "86400" },
  })
}
```

- [ ] **Step 4: Write the three routes**

Create `src/app/.well-known/oauth-authorization-server/route.ts`:

```ts
import {
  authorizationServerMetadata,
  metadataPreflightResponse,
  metadataResponse,
} from "@/lib/mcp/oauth/metadata"

// Node runtime: the metadata builders read process.env through @/lib/env.
export const runtime = "nodejs"

export async function GET(): Promise<Response> {
  return metadataResponse(authorizationServerMetadata())
}

export async function OPTIONS(): Promise<Response> {
  return metadataPreflightResponse()
}
```

Create `src/app/.well-known/oauth-protected-resource/route.ts`:

```ts
import {
  metadataPreflightResponse,
  metadataResponse,
  protectedResourceMetadata,
} from "@/lib/mcp/oauth/metadata"

export const runtime = "nodejs"

export async function GET(): Promise<Response> {
  return metadataResponse(protectedResourceMetadata())
}

export async function OPTIONS(): Promise<Response> {
  return metadataPreflightResponse()
}
```

Create `src/app/.well-known/oauth-protected-resource/api/mcp/route.ts`:

```ts
import {
  metadataPreflightResponse,
  metadataResponse,
  protectedResourceMetadata,
} from "@/lib/mcp/oauth/metadata"

/**
 * Path-suffixed variant of the RFC 9728 document: the resource lives at
 * /api/mcp, so its metadata also lives at
 * /.well-known/oauth-protected-resource/api/mcp. Claude probes THIS URL first
 * and only falls back to the bare one, so both must exist and must serve the
 * identical body.
 */
export const runtime = "nodejs"

export async function GET(): Promise<Response> {
  return metadataResponse(protectedResourceMetadata())
}

export async function OPTIONS(): Promise<Response> {
  return metadataPreflightResponse()
}
```

- [ ] **Step 5: Run the test to verify it passes**

```
npx vitest run src/__tests__/mcp/oauth-metadata-routes.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 6: Open the OAuth paths in the edge gate**

`src/middleware.ts` is deny-by-default: anything outside `PUBLIC_PATHS` needs a session cookie. Without this change, Claude's metadata probe gets a 307 to `/login` and the flow never starts.

In `src/lib/auth-public-paths.ts`, add to the `PUBLIC_PATHS` array after the `"/api/cron"` entry:

```ts
  // MCP OAuth 2.1 authorization server (spec section 4.2). Each of these
  // authenticates itself rather than by session cookie:
  //   /.well-known/*   public discovery documents, no auth at all
  //   /mcp/authorize   renders its own login redirect and admin check, so the
  //                    callbackUrl points back at the consent screen instead
  //                    of the gate's default landing
  //   /mcp/token       authenticated by the PKCE code or the refresh token
  //   /mcp/revoke      authenticated by the token being revoked
  "/.well-known",
  "/mcp/authorize",
  "/mcp/token",
  "/mcp/revoke",
```

Listing the three `/mcp/*` paths individually rather than `"/mcp"` is deliberate: a future `/mcp/anything` must stay gated by default.

- [ ] **Step 7: Extend the middleware gate tests**

In `src/__tests__/middleware-gate.test.ts`, add to the `publicPaths` array inside `describe("public paths need no session")`:

```ts
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/api/mcp",
    "/mcp/authorize",
    "/mcp/token",
    "/mcp/revoke",
```

and add to the `lookalikes` array inside `describe("prefix matching does not over-match")`:

```ts
    "/.well-knownx",
    "/mcp",
    "/mcp/authorizex",
    "/mcp/tokens",
    "/mcp/revoke-all",
    "/mcpx/token",
```

`"/mcp"` belongs in the lookalike list: the MCP endpoint itself is `/api/mcp` (PR C) and nothing should be reachable at the bare `/mcp` segment.

- [ ] **Step 8: Run the gate tests and the type-check**

```
npx vitest run src/__tests__/middleware-gate.test.ts
npx tsc --noEmit
```

Expected: PASS; no type errors.

- [ ] **Step 9: Verify the documents in a browser**

Ask the user to start the dev server (`npm run dev`) — do not start it yourself. Then, signed OUT (or in a private window), open:

- `http://localhost:3000/.well-known/oauth-authorization-server`
- `http://localhost:3000/.well-known/oauth-protected-resource`
- `http://localhost:3000/.well-known/oauth-protected-resource/api/mcp`

Expected: JSON in all three, **no** redirect to `/login`. `issuer` should read `http://localhost:3000` (from `NEXT_PUBLIC_APP_URL` in `.env.local`). A redirect here means Step 6 did not take effect.

- [ ] **Step 10: Commit**

```bash
git add src/lib/mcp/oauth/metadata.ts "src/app/.well-known" src/lib/auth-public-paths.ts src/__tests__/mcp/oauth-metadata-routes.test.ts src/__tests__/middleware-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): RFC 8414/9728 discovery routes and edge-gate allowlist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Authorization-request validation and a callback-aware `/login`

Spec §4.2 fixes the validation ORDER, and the order is the security property: until `client_id` and `redirect_uri` are known-good we must render an error page, because redirecting an error to an unverified URI is an open redirect that also leaks `state`. Everything after that point redirects with an RFC 6749 error code.

This task also makes `/login` honour `callbackUrl`. Today it ignores the parameter entirely (see the comment in `src/middleware.ts`) and always lands on `/browse`, which would strand every OAuth authorization mid-flow. The accepted value is a **relative path only**, so this cannot become an open redirect.

**Files:**
- Create: `src/lib/mcp/oauth/authorize-validation.ts`
- Create: `src/lib/auth/callback-url.ts`
- Modify: `src/app/(auth)/login/page.tsx` (signature + both `signIn` calls)
- Test: `src/__tests__/mcp/authorize-validation.test.ts`
- Test: `src/__tests__/login-callback-url.test.ts`

**Interfaces:**
- Consumes: `redirectUriMatches` (Task 3), `parseScopeString` / `McpScope` (Task 3).
- Produces:
  - `interface McpOauthClientRecord { clientId: string; name: string; redirectUris: string[] }`
  - `interface AuthorizeParams { clientId: string | null; redirectUri: string | null; responseType: string | null; codeChallenge: string | null; codeChallengeMethod: string | null; scope: string | null; state: string | null; resource: string | null }`
  - `interface ValidAuthorizeRequest { client: McpOauthClientRecord; redirectUri: string; codeChallenge: string; requestedScopes: McpScope[]; state: string | null; resource: string }`
  - `type AuthorizeValidation = { kind: "error_page"; message: string } | { kind: "error_redirect"; redirectUri: string; error: string; description: string; state: string | null } | { kind: "ok"; request: ValidAuthorizeRequest }`
  - `validateAuthorizeParams(params: AuthorizeParams, client: McpOauthClientRecord | null, expectedResource: string): AuthorizeValidation`
  - `buildAuthorizeErrorRedirect(opts: { redirectUri: string; error: string; description: string; state: string | null; issuer: string }): string`
  - `buildAuthorizeSuccessRedirect(opts: { redirectUri: string; code: string; state: string | null; issuer: string }): string`
  - `safeCallbackUrl(raw: string | null | undefined, fallback?: string): string`

- [ ] **Step 1: Write the failing validation test**

Create `src/__tests__/mcp/authorize-validation.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  validateAuthorizeParams,
  buildAuthorizeErrorRedirect,
  buildAuthorizeSuccessRedirect,
  type AuthorizeParams,
  type McpOauthClientRecord,
} from "@/lib/mcp/oauth/authorize-validation"

const RESOURCE = "https://marketplace.hellosugar.salon/api/mcp"
const ISSUER = "https://marketplace.hellosugar.salon"

const client: McpOauthClientRecord = {
  clientId: "claude-hosted",
  name: "Claude (claude.ai)",
  redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
}

const valid: AuthorizeParams = {
  clientId: "claude-hosted",
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
  responseType: "code",
  codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  codeChallengeMethod: "S256",
  scope: "marketplace:read marketplace:write",
  state: "xyz-state",
  resource: RESOURCE,
}

const params = (overrides: Partial<AuthorizeParams>): AuthorizeParams => ({
  ...valid,
  ...overrides,
})

describe("validateAuthorizeParams — happy path", () => {
  it("accepts a well-formed request and carries every field forward", () => {
    const result = validateAuthorizeParams(valid, client, RESOURCE)
    expect(result).toEqual({
      kind: "ok",
      request: {
        client,
        redirectUri: "https://claude.ai/api/mcp/auth_callback",
        codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        requestedScopes: ["marketplace:read", "marketplace:write"],
        state: "xyz-state",
        resource: RESOURCE,
      },
    })
  })

  it("defaults an omitted scope to both supported scopes", () => {
    const result = validateAuthorizeParams(params({ scope: null }), client, RESOURCE)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.request.requestedScopes).toEqual([
      "marketplace:read",
      "marketplace:write",
    ])
  })

  it("accepts a read-only request", () => {
    const result = validateAuthorizeParams(
      params({ scope: "marketplace:read" }),
      client,
      RESOURCE,
    )
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.request.requestedScopes).toEqual(["marketplace:read"])
  })

  it("accepts a loopback redirect_uri on an ephemeral port", () => {
    const codeClient: McpOauthClientRecord = {
      clientId: "claude-code",
      name: "Claude Code",
      redirectUris: ["http://localhost/callback", "http://127.0.0.1/callback"],
    }
    const result = validateAuthorizeParams(
      params({ clientId: "claude-code", redirectUri: "http://localhost:51820/callback" }),
      codeClient,
      RESOURCE,
    )
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    // The presented URI, not the registered one — the token exchange compares
    // against exactly what the client sent here.
    expect(result.request.redirectUri).toBe("http://localhost:51820/callback")
  })

  it("accepts a request with no state (state is optional in OAuth 2.1)", () => {
    const result = validateAuthorizeParams(params({ state: null }), client, RESOURCE)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.request.state).toBeNull()
  })
})

describe("validateAuthorizeParams — failures that must NOT redirect", () => {
  // Redirecting an error to an unverified URI is an open redirect that also
  // leaks `state`. These four render an error page instead.
  it("renders an error page when client_id is missing", () => {
    expect(validateAuthorizeParams(params({ clientId: null }), null, RESOURCE)).toEqual({
      kind: "error_page",
      message: "Missing client_id.",
    })
  })

  it("renders an error page when the client is not registered", () => {
    expect(
      validateAuthorizeParams(params({ clientId: "ghost" }), null, RESOURCE),
    ).toEqual({
      kind: "error_page",
      message: "Unknown client_id: ghost",
    })
  })

  it("renders an error page when redirect_uri is missing", () => {
    expect(validateAuthorizeParams(params({ redirectUri: null }), client, RESOURCE)).toEqual({
      kind: "error_page",
      message: "Missing redirect_uri.",
    })
  })

  it("renders an error page when redirect_uri is not registered", () => {
    expect(
      validateAuthorizeParams(
        params({ redirectUri: "https://evil.example/steal" }),
        client,
        RESOURCE,
      ),
    ).toEqual({
      kind: "error_page",
      message: "redirect_uri is not registered for this client.",
    })
  })

  it("checks the client BEFORE the response type, so a bad client never redirects", () => {
    const result = validateAuthorizeParams(
      params({ clientId: "ghost", responseType: "token" }),
      null,
      RESOURCE,
    )
    expect(result.kind).toBe("error_page")
  })
})

describe("validateAuthorizeParams — failures that redirect with an error code", () => {
  const expectRedirect = (p: Partial<AuthorizeParams>, error: string) => {
    const result = validateAuthorizeParams(params(p), client, RESOURCE)
    expect(result.kind).toBe("error_redirect")
    if (result.kind !== "error_redirect") return
    expect(result.error).toBe(error)
    expect(result.redirectUri).toBe("https://claude.ai/api/mcp/auth_callback")
    expect(result.state).toBe("xyz-state")
  }

  it("rejects an implicit-flow response_type", () => {
    expectRedirect({ responseType: "token" }, "unsupported_response_type")
  })

  it("rejects a missing response_type", () => {
    expectRedirect({ responseType: null }, "unsupported_response_type")
  })

  it("rejects a missing code_challenge — PKCE is mandatory", () => {
    expectRedirect({ codeChallenge: null }, "invalid_request")
  })

  it("rejects code_challenge_method=plain", () => {
    expectRedirect({ codeChallengeMethod: "plain" }, "invalid_request")
  })

  it("rejects a missing code_challenge_method", () => {
    expectRedirect({ codeChallengeMethod: null }, "invalid_request")
  })

  it("rejects a resource indicator that is not this MCP endpoint", () => {
    expectRedirect({ resource: "https://marketplace.hellosugar.salon/api/other" }, "invalid_request")
  })

  it("rejects a missing resource indicator", () => {
    expectRedirect({ resource: null }, "invalid_request")
  })

  it("rejects a scope outside the supported set", () => {
    expectRedirect({ scope: "marketplace:read marketplace:delete" }, "invalid_scope")
  })
})

describe("buildAuthorizeErrorRedirect", () => {
  it("appends error, description, state and iss", () => {
    const url = new URL(
      buildAuthorizeErrorRedirect({
        redirectUri: "https://claude.ai/api/mcp/auth_callback",
        error: "access_denied",
        description: "The administrator denied this request.",
        state: "xyz-state",
        issuer: ISSUER,
      }),
    )
    expect(url.origin + url.pathname).toBe("https://claude.ai/api/mcp/auth_callback")
    expect(url.searchParams.get("error")).toBe("access_denied")
    expect(url.searchParams.get("error_description")).toBe(
      "The administrator denied this request.",
    )
    expect(url.searchParams.get("state")).toBe("xyz-state")
    expect(url.searchParams.get("iss")).toBe(ISSUER)
  })

  it("omits state entirely when the request carried none", () => {
    const url = new URL(
      buildAuthorizeErrorRedirect({
        redirectUri: "https://claude.ai/api/mcp/auth_callback",
        error: "invalid_request",
        description: "nope",
        state: null,
        issuer: ISSUER,
      }),
    )
    expect(url.searchParams.has("state")).toBe(false)
  })

  it("preserves a query string already on the redirect_uri", () => {
    const url = new URL(
      buildAuthorizeErrorRedirect({
        redirectUri: "https://claude.ai/cb?keep=1",
        error: "invalid_request",
        description: "nope",
        state: null,
        issuer: ISSUER,
      }),
    )
    expect(url.searchParams.get("keep")).toBe("1")
    expect(url.searchParams.get("error")).toBe("invalid_request")
  })
})

describe("buildAuthorizeSuccessRedirect", () => {
  it("appends code, state and iss", () => {
    const url = new URL(
      buildAuthorizeSuccessRedirect({
        redirectUri: "https://claude.ai/api/mcp/auth_callback",
        code: "opaque-code-value",
        state: "xyz-state",
        issuer: ISSUER,
      }),
    )
    expect(url.searchParams.get("code")).toBe("opaque-code-value")
    expect(url.searchParams.get("state")).toBe("xyz-state")
    expect(url.searchParams.get("iss")).toBe(ISSUER)
    expect(url.searchParams.has("error")).toBe(false)
  })

  it("omits state when there was none", () => {
    const url = new URL(
      buildAuthorizeSuccessRedirect({
        redirectUri: "http://localhost:51820/callback",
        code: "c",
        state: null,
        issuer: ISSUER,
      }),
    )
    expect(url.searchParams.has("state")).toBe(false)
    expect(url.searchParams.get("code")).toBe("c")
  })
})
```

- [ ] **Step 2: Write the failing callback-URL test**

Create `src/__tests__/login-callback-url.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { safeCallbackUrl } from "@/lib/auth/callback-url"

/**
 * /login previously ignored ?callbackUrl and always landed on /browse, which
 * would strand every MCP authorization mid-flow. It now honours the parameter —
 * but only for same-origin RELATIVE paths, so it never becomes an open redirect.
 */
describe("safeCallbackUrl", () => {
  it("returns the default when there is no callbackUrl", () => {
    expect(safeCallbackUrl(null)).toBe("/browse")
    expect(safeCallbackUrl(undefined)).toBe("/browse")
    expect(safeCallbackUrl("")).toBe("/browse")
  })

  it("keeps a relative path with its query string", () => {
    expect(safeCallbackUrl("/mcp/authorize?client_id=claude-hosted&state=abc")).toBe(
      "/mcp/authorize?client_id=claude-hosted&state=abc",
    )
  })

  it("rejects an absolute URL on another origin", () => {
    expect(safeCallbackUrl("https://evil.example/steal")).toBe("/browse")
  })

  it("rejects a protocol-relative URL", () => {
    // "//evil.example" is an absolute URL to a browser, not a path.
    expect(safeCallbackUrl("//evil.example/steal")).toBe("/browse")
  })

  it("rejects a backslash-smuggled origin", () => {
    // Some browsers normalise "/\" to "//".
    expect(safeCallbackUrl("/\\evil.example/steal")).toBe("/browse")
  })

  it("rejects a javascript: URL", () => {
    expect(safeCallbackUrl("javascript:alert(1)")).toBe("/browse")
  })

  it("rejects a value with a control character or newline", () => {
    expect(safeCallbackUrl("/browse\nLocation: https://evil.example")).toBe("/browse")
  })

  it("honours an explicit fallback", () => {
    expect(safeCallbackUrl(null, "/admin")).toBe("/admin")
  })
})
```

- [ ] **Step 3: Run both tests to verify they fail**

```
npx vitest run src/__tests__/mcp/authorize-validation.test.ts src/__tests__/login-callback-url.test.ts
```

Expected: FAIL — neither `@/lib/mcp/oauth/authorize-validation` nor `@/lib/auth/callback-url` resolves.

- [ ] **Step 4: Write the callback-URL guard**

Create `src/lib/auth/callback-url.ts`:

```ts
/**
 * Post-sign-in redirect target, sanitised.
 *
 * NOT a `"use server"` module. Deliberately dependency-free so it can be used
 * from the login page and from tests without pulling in Auth.js.
 *
 * Only a same-origin RELATIVE path is ever returned. Anything absolute,
 * protocol-relative, backslash-smuggled, scheme-bearing, or containing a
 * control character falls back — `signIn(..., { redirectTo })` would otherwise
 * hand an attacker a one-click open redirect off an authenticated session.
 */
export function safeCallbackUrl(
  raw: string | null | undefined,
  fallback = "/browse",
): string {
  if (!raw) return fallback
  // Control characters (incl. CR/LF header smuggling) disqualify outright.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback
  if (!raw.startsWith("/")) return fallback
  // "//host" and "/\host" are absolute URLs to a browser, not paths.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback
  return raw
}
```

- [ ] **Step 5: Write the authorization-request validator**

Create `src/lib/mcp/oauth/authorize-validation.ts`:

```ts
/**
 * Validation for `GET /mcp/authorize` (spec section 4.2).
 *
 * NOT a `"use server"` module and deliberately DB-free: the caller looks the
 * client up and passes the row in, which is what lets every branch below be
 * unit-tested under this repo's node-env vitest.
 *
 * THE ORDER IS THE SECURITY PROPERTY. Until `client_id` AND `redirect_uri` are
 * known-good we must render an error page: redirecting an error to an
 * unverified URI is an open redirect that also leaks `state`. Only after both
 * check out may a failure be reported by redirect.
 */
import { redirectUriMatches } from "./tokens"
import { parseScopeString, type McpScope } from "./scopes"

export interface McpOauthClientRecord {
  clientId: string
  name: string
  redirectUris: string[]
}

export interface AuthorizeParams {
  clientId: string | null
  redirectUri: string | null
  responseType: string | null
  codeChallenge: string | null
  codeChallengeMethod: string | null
  scope: string | null
  state: string | null
  resource: string | null
}

export interface ValidAuthorizeRequest {
  client: McpOauthClientRecord
  /** The URI as PRESENTED — the token exchange compares against this exact string. */
  redirectUri: string
  codeChallenge: string
  requestedScopes: McpScope[]
  state: string | null
  resource: string
}

export type AuthorizeValidation =
  | { kind: "error_page"; message: string }
  | {
      kind: "error_redirect"
      redirectUri: string
      error: string
      description: string
      state: string | null
    }
  | { kind: "ok"; request: ValidAuthorizeRequest }

export function validateAuthorizeParams(
  params: AuthorizeParams,
  client: McpOauthClientRecord | null,
  expectedResource: string,
): AuthorizeValidation {
  // --- Phase 1: nothing may redirect yet. ---
  if (!params.clientId) {
    return { kind: "error_page", message: "Missing client_id." }
  }
  if (!client) {
    return { kind: "error_page", message: `Unknown client_id: ${params.clientId}` }
  }
  if (!params.redirectUri) {
    return { kind: "error_page", message: "Missing redirect_uri." }
  }
  if (!redirectUriMatches(client.redirectUris, params.redirectUri)) {
    return {
      kind: "error_page",
      message: "redirect_uri is not registered for this client.",
    }
  }

  // --- Phase 2: redirect_uri is verified, so errors may go back to the client. ---
  const redirectUri = params.redirectUri
  const state = params.state
  const fail = (error: string, description: string): AuthorizeValidation => ({
    kind: "error_redirect",
    redirectUri,
    error,
    description,
    state,
  })

  if (params.responseType !== "code") {
    return fail(
      "unsupported_response_type",
      "Only response_type=code is supported.",
    )
  }
  if (!params.codeChallenge) {
    return fail("invalid_request", "code_challenge is required (PKCE is mandatory).")
  }
  if (params.codeChallengeMethod !== "S256") {
    return fail("invalid_request", "code_challenge_method must be S256.")
  }
  if (params.resource !== expectedResource) {
    // RFC 8707 resource indicator. Spec section 4.2 constrains error codes to
    // the RFC 6749 set, so this is invalid_request rather than invalid_target.
    return fail("invalid_request", `resource must be ${expectedResource}.`)
  }

  const requestedScopes = parseScopeString(params.scope)
  if (!requestedScopes) {
    return fail(
      "invalid_scope",
      "Supported scopes are marketplace:read and marketplace:write.",
    )
  }

  return {
    kind: "ok",
    request: {
      client,
      redirectUri,
      codeChallenge: params.codeChallenge,
      requestedScopes,
      state,
      resource: expectedResource,
    },
  }
}

function withParams(
  redirectUri: string,
  entries: Array<[string, string | null]>,
): string {
  const url = new URL(redirectUri)
  for (const [key, value] of entries) {
    if (value !== null) url.searchParams.set(key, value)
  }
  return url.toString()
}

/** RFC 6749 §4.1.2.1 error redirect, plus the RFC 9207 `iss` parameter. */
export function buildAuthorizeErrorRedirect(opts: {
  redirectUri: string
  error: string
  description: string
  state: string | null
  issuer: string
}): string {
  return withParams(opts.redirectUri, [
    ["error", opts.error],
    ["error_description", opts.description],
    ["state", opts.state],
    ["iss", opts.issuer],
  ])
}

/** RFC 6749 §4.1.2 success redirect, plus the RFC 9207 `iss` parameter. */
export function buildAuthorizeSuccessRedirect(opts: {
  redirectUri: string
  code: string
  state: string | null
  issuer: string
}): string {
  return withParams(opts.redirectUri, [
    ["code", opts.code],
    ["state", opts.state],
    ["iss", opts.issuer],
  ])
}
```

- [ ] **Step 6: Run both tests to verify they pass**

```
npx vitest run src/__tests__/mcp/authorize-validation.test.ts src/__tests__/login-callback-url.test.ts
```

Expected: PASS — 22 validation tests, 8 callback-URL tests.

- [ ] **Step 7: Make `/login` honour `callbackUrl`**

In `src/app/(auth)/login/page.tsx`, add the import after the existing `signIn` import on line 1:

```ts
import { safeCallbackUrl } from "@/lib/auth/callback-url"
```

Change the component signature from:

```tsx
export default function LoginPage() {
```

to:

```tsx
interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // The MCP consent screen bounces here with ?callbackUrl=/mcp/authorize?…;
  // without this the OAuth flow would end on /browse and never return a code.
  // safeCallbackUrl accepts only same-origin relative paths.
  const { callbackUrl } = await searchParams
  const redirectTo = safeCallbackUrl(callbackUrl)
```

Then change the Google form's action body from:

```tsx
                await signIn("google", { redirectTo: "/browse" })
```

to:

```tsx
                await signIn("google", { redirectTo })
```

and the magic-link form's from:

```tsx
              await signIn("resend", { email, redirectTo: "/browse" })
```

to:

```tsx
              await signIn("resend", { email, redirectTo })
```

`redirectTo` is a value closed over by two inline `"use server"` actions; Next encrypts closed-over arguments, and `safeCallbackUrl` has already reduced it to a relative path, so neither the encryption nor the value is a trust boundary here.

- [ ] **Step 8: Type-check and run the full suite**

```
npx tsc --noEmit
npm test
```

Expected: no type errors; all tests pass. `tsc` is what catches a missed `redirectTo` rename inside either form.

- [ ] **Step 9: Verify the login redirect in a browser**

Ask the user to start the dev server. Signed out, open `http://localhost:3000/login?callbackUrl=%2Fadmin%2Fusers` and sign in. Expected: you land on `/admin/users`, not `/browse`. Then open `http://localhost:3000/login?callbackUrl=https%3A%2F%2Fexample.com` and sign in — expected: you land on `/browse`, never on example.com.

- [ ] **Step 10: Commit**

```bash
git add src/lib/mcp/oauth/authorize-validation.ts src/lib/auth/callback-url.ts "src/app/(auth)/login/page.tsx" src/__tests__/mcp/authorize-validation.test.ts src/__tests__/login-callback-url.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): authorization-request validation and callback-aware login

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `/mcp/authorize` — consent page and `approveMcpConsent`

The page is a server component; the consent form posts to a `"use server"` action. The action **re-validates everything** rather than trusting its hidden fields: every `"use server"` export is a public POST endpoint whose action id ships in the client bundle, so the form is not a trust boundary.

There is no test for the page itself — this repo's vitest runs in a node environment with a `.ts`-only glob, so React components cannot be rendered or even imported. The page's logic lives in Task 5's validator (fully tested) and its gate is `tsc` plus the browser walkthrough in Step 8.

**Files:**
- Create: `src/app/mcp/authorize/page.tsx`
- Create: `src/app/mcp/authorize/actions.ts`
- Test: `src/__tests__/mcp/authorize-consent-action.test.ts`

**Interfaces:**
- Consumes: `validateAuthorizeParams`, `buildAuthorizeErrorRedirect`, `buildAuthorizeSuccessRedirect` (Task 5); `generateOpaqueToken`, `sha256Hex` (Task 3); `formatScopes`, `McpScope` (Task 3); `AUTHORIZATION_CODE_TTL_MS`, `CONSENT_LABEL_MAX_LENGTH` (Task 3); `issuerUrl`, `mcpResourceUrl` (Task 1); `mcpOauthClients`, `mcpOauthCodes` (Task 2); `requireAdmin` from `@/lib/auth-guards`; `auth` from `@/auth`.
- Produces: `approveMcpConsent(formData: FormData): Promise<void>` — the only export of `src/app/mcp/authorize/actions.ts`. Nothing in a later task imports it.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/mcp/authorize-consent-action.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

/**
 * Tests the REAL `approveMcpConsent` server action.
 *
 * `redirect()` is mocked to THROW a tagged error, which is what the real
 * next/navigation redirect does (it throws NEXT_REDIRECT); that is how each
 * test reads the destination URL and how it proves the action stopped there.
 */

const { redirectMock, requireAdmin, findFirst, insert } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    const err = new Error("NEXT_REDIRECT") as Error & { redirectUrl: string }
    err.redirectUrl = url
    throw err
  }),
  requireAdmin: vi.fn(),
  findFirst: vi.fn(),
  insert: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect: redirectMock }))
vi.mock("@/lib/auth-guards", () => ({ requireAdmin }))
vi.mock("@/db", () => ({
  db: {
    query: { mcpOauthClients: { findFirst } },
    insert: (...args: unknown[]) => insert(...args),
  },
}))

import { approveMcpConsent } from "@/app/mcp/authorize/actions"

const ISSUER = "https://marketplace.hellosugar.salon"
const RESOURCE = `${ISSUER}/api/mcp`
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
const CHALLENGE = createHash("sha256").update(VERIFIER, "ascii").digest("base64url")

const CLIENT = {
  clientId: "claude-hosted",
  name: "Claude (claude.ai)",
  redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
  isPublic: true,
  createdAt: new Date("2026-09-14T00:00:00.000Z"),
}

let insertBuilder: ChainedBuilder

function form(overrides: Record<string, string> = {}): FormData {
  const fields: Record<string, string> = {
    client_id: "claude-hosted",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    scope: "marketplace:read marketplace:write",
    resource: RESOURCE,
    state: "xyz-state",
    scope_choice: "read_write",
    decision: "approve",
    ...overrides,
  }
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== "") fd.set(key, value)
  }
  return fd
}

/** Run the action and return the URL its redirect() was handed. */
async function capture(fd: FormData): Promise<string> {
  try {
    await approveMcpConsent(fd)
  } catch (err) {
    const tagged = err as Error & { redirectUrl?: string }
    if (tagged.redirectUrl) return tagged.redirectUrl
    throw err
  }
  throw new Error("approveMcpConsent returned without redirecting")
}

/** The single row handed to db.insert(...).values(...). */
function insertedRow(): Record<string, unknown> {
  return insertBuilder.calls.values[0][0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ISSUER)
  vi.stubEnv("MCP_ISSUER_URL", "")
  requireAdmin.mockResolvedValue({ id: "admin-1", email: "parker@hellosugar.salon", role: "admin" })
  findFirst.mockResolvedValue(CLIENT)
  insertBuilder = builder(undefined)
  insert.mockReturnValue(insertBuilder)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("approveMcpConsent — approval", () => {
  it("redirects to the client with code, state and iss", async () => {
    const url = new URL(await capture(form()))
    expect(url.origin + url.pathname).toBe("https://claude.ai/api/mcp/auth_callback")
    expect(url.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get("state")).toBe("xyz-state")
    expect(url.searchParams.get("iss")).toBe(ISSUER)
    expect(url.searchParams.has("error")).toBe(false)
  })

  it("stores only the SHA-256 hash of the code, never the code itself", async () => {
    const url = new URL(await capture(form()))
    const code = url.searchParams.get("code")!
    const row = insertedRow()
    expect(row.codeHash).toBe(createHash("sha256").update(code, "utf8").digest("hex"))
    expect(JSON.stringify(row)).not.toContain(code)
  })

  it("records the client, admin, redirect_uri, challenge and resource", async () => {
    await capture(form())
    expect(insertedRow()).toMatchObject({
      clientId: "claude-hosted",
      userId: "admin-1",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: CHALLENGE,
      resource: RESOURCE,
    })
  })

  it("expires the code five minutes out", async () => {
    const before = Date.now()
    await capture(form())
    const expiresAt = insertedRow().expiresAt as Date
    expect(expiresAt).toBeInstanceOf(Date)
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(5 * 60 * 1000 - 50)
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(5 * 60 * 1000 + 5000)
  })

  it("grants both scopes for the read-and-write choice", async () => {
    await capture(form({ scope_choice: "read_write" }))
    expect(insertedRow().scope).toBe("marketplace:read marketplace:write")
  })

  it("grants only read for the read-only choice", async () => {
    await capture(form({ scope_choice: "read" }))
    expect(insertedRow().scope).toBe("marketplace:read")
  })

  it("never grants write when the client did not request it", async () => {
    // A tampered scope_choice must not widen the grant past the request.
    await capture(form({ scope: "marketplace:read", scope_choice: "read_write" }))
    expect(insertedRow().scope).toBe("marketplace:read")
  })

  it("stores a trimmed label", async () => {
    await capture(form({ label: "  Parker's laptop  " }))
    expect(insertedRow().label).toBe("Parker's laptop")
  })

  it("truncates a label past 60 characters", async () => {
    await capture(form({ label: "x".repeat(200) }))
    expect(insertedRow().label).toBe("x".repeat(60))
  })

  it("stores null for an omitted or whitespace-only label", async () => {
    await capture(form())
    expect(insertedRow().label).toBeNull()
    insertBuilder = builder(undefined)
    insert.mockReturnValue(insertBuilder)
    await capture(form({ label: "   " }))
    expect(insertedRow().label).toBeNull()
  })

  it("omits state from the redirect when the request carried none", async () => {
    const fd = form()
    fd.delete("state")
    const url = new URL(await capture(fd))
    expect(url.searchParams.has("state")).toBe(false)
    expect(url.searchParams.get("code")).toBeTruthy()
  })
})

describe("approveMcpConsent — denial", () => {
  it("redirects with error=access_denied and writes nothing", async () => {
    const url = new URL(await capture(form({ decision: "deny" })))
    expect(url.searchParams.get("error")).toBe("access_denied")
    expect(url.searchParams.get("state")).toBe("xyz-state")
    expect(url.searchParams.get("iss")).toBe(ISSUER)
    expect(url.searchParams.has("code")).toBe(false)
    expect(insert).not.toHaveBeenCalled()
  })

  it("treats an absent decision as a denial (fail closed)", async () => {
    const fd = form()
    fd.delete("decision")
    const url = new URL(await capture(fd))
    expect(url.searchParams.get("error")).toBe("access_denied")
    expect(insert).not.toHaveBeenCalled()
  })
})

describe("approveMcpConsent — rejection", () => {
  it("refuses a non-admin caller and writes nothing", async () => {
    requireAdmin.mockRejectedValue(new Error("Unauthorized: Admin access required"))
    await expect(approveMcpConsent(form())).rejects.toThrow("Unauthorized")
    expect(insert).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it("throws rather than redirecting when the client is unknown", async () => {
    // An unverified redirect_uri must never receive a redirect.
    findFirst.mockResolvedValue(undefined)
    await expect(approveMcpConsent(form({ client_id: "ghost" }))).rejects.toThrow(
      /Unknown client_id/,
    )
    expect(insert).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it("throws rather than redirecting when redirect_uri is not registered", async () => {
    await expect(
      approveMcpConsent(form({ redirect_uri: "https://evil.example/steal" })),
    ).rejects.toThrow(/redirect_uri is not registered/)
    expect(insert).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it("redirects with invalid_request when the PKCE method was tampered to plain", async () => {
    const url = new URL(await capture(form({ code_challenge_method: "plain" })))
    expect(url.searchParams.get("error")).toBe("invalid_request")
    expect(insert).not.toHaveBeenCalled()
  })

  it("redirects with invalid_request when the resource does not match", async () => {
    const url = new URL(await capture(form({ resource: `${ISSUER}/api/other` })))
    expect(url.searchParams.get("error")).toBe("invalid_request")
    expect(insert).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run src/__tests__/mcp/authorize-consent-action.test.ts
```

Expected: FAIL — `Failed to resolve import "@/app/mcp/authorize/actions"`.

- [ ] **Step 3: Write the consent server action**

Create `src/app/mcp/authorize/actions.ts`:

```ts
"use server"

import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { mcpOauthClients, mcpOauthCodes } from "@/db/schema/mcpOauth"
import { requireAdmin } from "@/lib/auth-guards"
import { issuerUrl, mcpResourceUrl } from "@/lib/mcp/oauth/urls"
import { generateOpaqueToken, sha256Hex } from "@/lib/mcp/oauth/tokens"
import { formatScopes, type McpScope } from "@/lib/mcp/oauth/scopes"
import {
  AUTHORIZATION_CODE_TTL_MS,
  CONSENT_LABEL_MAX_LENGTH,
} from "@/lib/mcp/oauth/constants"
import {
  buildAuthorizeErrorRedirect,
  buildAuthorizeSuccessRedirect,
  validateAuthorizeParams,
} from "@/lib/mcp/oauth/authorize-validation"

/**
 * Mint an authorization code for the consent screen (spec section 4.2 step 5).
 *
 * This is a `"use server"` export, i.e. a PUBLIC POST endpoint whose action id
 * ships in the client bundle. The hidden form fields are therefore NOT a trust
 * boundary: every parameter is re-read from the DB and re-validated here, in
 * the same order the page used, and the granted scope is intersected with the
 * scope the client actually requested so a tampered radio cannot widen it.
 */
export async function approveMcpConsent(formData: FormData): Promise<void> {
  const admin = await requireAdmin()
  if (!admin.id) throw new Error("Unauthorized: Admin access required")

  const field = (name: string): string | null => {
    const value = formData.get(name)
    return typeof value === "string" && value.length > 0 ? value : null
  }

  const params = {
    clientId: field("client_id"),
    redirectUri: field("redirect_uri"),
    responseType: field("response_type"),
    codeChallenge: field("code_challenge"),
    codeChallengeMethod: field("code_challenge_method"),
    scope: field("scope"),
    state: field("state"),
    resource: field("resource"),
  }

  const client = params.clientId
    ? await db.query.mcpOauthClients.findFirst({
        where: eq(mcpOauthClients.clientId, params.clientId),
      })
    : undefined

  const validation = validateAuthorizeParams(
    params,
    client
      ? {
          clientId: client.clientId,
          name: client.name,
          redirectUris: client.redirectUris,
        }
      : null,
    mcpResourceUrl(),
  )

  // An unverified redirect_uri must never receive a redirect — throw instead.
  // Next redacts thrown server-action messages in production, which is the
  // right outcome here: reaching this branch means the form was tampered with.
  if (validation.kind === "error_page") {
    throw new Error(validation.message)
  }

  const issuer = issuerUrl()

  if (validation.kind === "error_redirect") {
    return redirect(
      buildAuthorizeErrorRedirect({
        redirectUri: validation.redirectUri,
        error: validation.error,
        description: validation.description,
        state: validation.state,
        issuer,
      }),
    )
  }

  const request = validation.request

  // Fail closed: anything other than an explicit approval is a denial.
  if (formData.get("decision") !== "approve") {
    return redirect(
      buildAuthorizeErrorRedirect({
        redirectUri: request.redirectUri,
        error: "access_denied",
        description: "The administrator denied this request.",
        state: request.state,
        issuer,
      }),
    )
  }

  // Granted scope is the intersection of the radio choice with what the client
  // requested — never wider than either.
  const wantsWrite = formData.get("scope_choice") === "read_write"
  const granted: McpScope[] = request.requestedScopes.filter(
    (scope) => scope === "marketplace:read" || (wantsWrite && scope === "marketplace:write"),
  )
  if (granted.length === 0) {
    return redirect(
      buildAuthorizeErrorRedirect({
        redirectUri: request.redirectUri,
        error: "invalid_scope",
        description: "No supported scope was granted.",
        state: request.state,
        issuer,
      }),
    )
  }

  const rawLabel = formData.get("label")
  const label =
    typeof rawLabel === "string"
      ? rawLabel.trim().slice(0, CONSENT_LABEL_MAX_LENGTH) || null
      : null

  const code = generateOpaqueToken()

  // Only the hash is stored: a database read must never yield a usable code.
  await db.insert(mcpOauthCodes).values({
    codeHash: sha256Hex(code),
    clientId: request.client.clientId,
    userId: admin.id,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scope: formatScopes(granted),
    resource: request.resource,
    label,
    expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
  })

  return redirect(
    buildAuthorizeSuccessRedirect({
      redirectUri: request.redirectUri,
      code,
      state: request.state,
      issuer,
    }),
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
npx vitest run src/__tests__/mcp/authorize-consent-action.test.ts
```

Expected: PASS, 18 tests.

- [ ] **Step 5: Write the consent page**

Create `src/app/mcp/authorize/page.tsx`:

```tsx
import Link from "next/link"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"
import { db } from "@/db"
import { mcpOauthClients } from "@/db/schema/mcpOauth"
import { issuerUrl, mcpResourceUrl } from "@/lib/mcp/oauth/urls"
import { CONSENT_LABEL_MAX_LENGTH } from "@/lib/mcp/oauth/constants"
import {
  buildAuthorizeErrorRedirect,
  validateAuthorizeParams,
} from "@/lib/mcp/oauth/authorize-validation"
import { approveMcpConsent } from "./actions"

/**
 * OAuth 2.1 authorization endpoint (spec section 4.2).
 *
 * The order below is fixed and is the security property:
 *   1. validate the request (an unverified redirect_uri gets an error PAGE,
 *      never a redirect — redirecting there is an open redirect that also
 *      leaks `state`)
 *   2. no session -> /login?callbackUrl=<this page>
 *   3. session but not admin -> access-denied copy, in place
 *   4. consent form
 *
 * This route is in PUBLIC_PATHS (src/lib/auth-public-paths.ts) so it can render
 * its own login redirect with a callbackUrl that returns here, instead of the
 * edge gate's generic bounce.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RawSearchParams = Record<string, string | string[] | undefined>

interface McpAuthorizePageProps {
  searchParams: Promise<RawSearchParams>
}

function one(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === "string" && first.length > 0 ? first : null
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-12">
      <div className="w-full max-w-md space-y-6">{children}</div>
    </main>
  )
}

export default async function McpAuthorizePage({ searchParams }: McpAuthorizePageProps) {
  const raw = await searchParams

  const params = {
    clientId: one(raw.client_id),
    redirectUri: one(raw.redirect_uri),
    responseType: one(raw.response_type),
    codeChallenge: one(raw.code_challenge),
    codeChallengeMethod: one(raw.code_challenge_method),
    scope: one(raw.scope),
    state: one(raw.state),
    resource: one(raw.resource),
  }

  const client = params.clientId
    ? await db.query.mcpOauthClients.findFirst({
        where: eq(mcpOauthClients.clientId, params.clientId),
      })
    : undefined

  const validation = validateAuthorizeParams(
    params,
    client
      ? {
          clientId: client.clientId,
          name: client.name,
          redirectUris: client.redirectUris,
        }
      : null,
    mcpResourceUrl(),
  )

  if (validation.kind === "error_page") {
    return (
      <Shell>
        <div className="space-y-3 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Invalid connection request</h1>
          <p className="text-gray-600">{validation.message}</p>
          <p className="text-sm text-gray-500">
            Nothing was authorized. Start the connection again from your MCP client.
          </p>
        </div>
      </Shell>
    )
  }

  const issuer = issuerUrl()

  if (validation.kind === "error_redirect") {
    redirect(
      buildAuthorizeErrorRedirect({
        redirectUri: validation.redirectUri,
        error: validation.error,
        description: validation.description,
        state: validation.state,
        issuer,
      }),
    )
  }

  const request = validation.request

  const session = await auth()
  if (!session?.user) {
    // Relative path only — safeCallbackUrl in /login rejects anything absolute.
    const self = new URLSearchParams()
    for (const [key, value] of Object.entries(raw)) {
      const first = Array.isArray(value) ? value[0] : value
      if (typeof first === "string") self.set(key, first)
    }
    redirect(`/login?callbackUrl=${encodeURIComponent(`/mcp/authorize?${self.toString()}`)}`)
  }

  if (session.user.role !== "admin") {
    // Rendered in place rather than redirected to /access-denied, so the OAuth
    // request stays on screen and a sign-out/sign-in round trip can recover it.
    return (
      <Shell>
        <div className="space-y-4 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Admin access required</h1>
          <p className="text-gray-600">
            The MCP connector acts with marketplace admin powers, so only admins can
            authorize it. You are signed in as {session.user.email}.
          </p>
          <p className="text-sm text-gray-500">
            If you believe you should have access, email{" "}
            <a
              href="mailto:marketplace@hellosugar.salon"
              className="text-hs-red-600 underline underline-offset-2 hover:text-hs-red-700"
            >
              marketplace@hellosugar.salon
            </a>
            .
          </p>
        </div>
      </Shell>
    )
  }

  const canWrite = request.requestedScopes.includes("marketplace:write")

  return (
    <Shell>
      <div className="text-center">
        <img
          src="/hs-logo-stacked-color.png"
          alt="Hello Sugar"
          className="mx-auto h-16 w-auto"
        />
        <h1 className="mt-6 text-2xl font-bold text-gray-900">
          Connect {request.client.name}?
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Signed in as {session.user.email}. Approving lets {request.client.name} act on
          the Hello Sugar Marketplace as you.
        </p>
      </div>

      <form
        action={approveMcpConsent}
        className="space-y-6 rounded-xl border border-gray-200 bg-white p-6"
      >
        <input type="hidden" name="client_id" value={request.client.clientId} />
        <input type="hidden" name="redirect_uri" value={request.redirectUri} />
        <input type="hidden" name="response_type" value="code" />
        <input type="hidden" name="code_challenge" value={request.codeChallenge} />
        <input type="hidden" name="code_challenge_method" value="S256" />
        <input type="hidden" name="scope" value={request.requestedScopes.join(" ")} />
        <input type="hidden" name="resource" value={request.resource} />
        {request.state !== null && (
          <input type="hidden" name="state" value={request.state} />
        )}

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-gray-900">Access level</legend>

          <label className="flex cursor-pointer gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
            <input
              type="radio"
              name="scope_choice"
              value="read"
              defaultChecked={!canWrite}
              className="mt-1 h-4 w-4 accent-hs-red-600"
            />
            <span>
              <span className="block font-medium text-gray-900">Read only</span>
              <span className="block text-sm text-gray-500">
                Browse listings, users, inquiries, brand requests and the audit log.
                Changes nothing.
              </span>
            </span>
          </label>

          {canWrite && (
            <label className="flex cursor-pointer gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
              <input
                type="radio"
                name="scope_choice"
                value="read_write"
                defaultChecked
                className="mt-1 h-4 w-4 accent-hs-red-600"
              />
              <span>
                <span className="block font-medium text-gray-900">Read and write</span>
                <span className="block text-sm text-gray-500">
                  Everything above, plus every admin action the web UI can take —
                  approving and rejecting listings, changing roles, removing users.
                </span>
              </span>
            </label>
          )}
        </fieldset>

        <div className="space-y-2">
          <label htmlFor="label" className="block text-sm font-medium text-gray-700">
            Label <span className="text-gray-400">(optional)</span>
          </label>
          <input
            id="label"
            name="label"
            type="text"
            maxLength={CONSENT_LABEL_MAX_LENGTH}
            placeholder="Parker's laptop"
            className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-400 transition-colors focus:border-hs-red-500 focus:outline-none focus:ring-2 focus:ring-hs-red-500/20"
          />
          <p className="text-xs text-gray-500">
            Shown on the MCP connections page so you can tell connections apart.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 rounded-xl border-2 border-gray-200 bg-white px-5 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
          >
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="approve"
            className="flex-1 rounded-xl bg-hs-red-600 px-5 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-hs-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
          >
            Approve
          </button>
        </div>
      </form>

      <p className="text-center text-xs text-gray-400">
        You can revoke this connection at any time from{" "}
        <Link
          href="/admin/mcp-connections"
          className="text-hs-red-600 underline underline-offset-2 hover:text-hs-red-700"
        >
          MCP connections
        </Link>
        .
      </p>
    </Shell>
  )
}
```

- [ ] **Step 6: Type-check**

```
npx tsc --noEmit
```

Expected: no errors. A "Property 'request' does not exist" here means a `redirect()` call is missing its narrowing — `redirect` returns `never`, so the branches above must call it directly rather than assigning its result.

- [ ] **Step 7: Run the full suite**

```
npm test
```

Expected: PASS.

- [ ] **Step 8: Walk the consent screen in a browser**

Ask the user to start the dev server. Seed a client row by hand for this check (the real seed script arrives in Task 11) — write `scripts/_tmp-seed-client.ts`:

```ts
import { db } from "@/db"
import { mcpOauthClients } from "@/db/schema/mcpOauth"

async function main() {
  await db
    .insert(mcpOauthClients)
    .values({
      clientId: "claude-hosted",
      name: "Claude (claude.ai)",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback", "http://localhost:3000/dev-callback"],
      isPublic: true,
    })
    .onConflictDoUpdate({
      target: mcpOauthClients.clientId,
      set: { redirectUris: ["https://claude.ai/api/mcp/auth_callback", "http://localhost:3000/dev-callback"] },
    })
  console.log("seeded claude-hosted (dev)")
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

```
npx tsx --env-file=.env.local scripts/_tmp-seed-client.ts
```

Then check each branch:

1. **Bad client** — `http://localhost:3000/mcp/authorize?client_id=ghost` → "Invalid connection request / Unknown client_id: ghost", **no** redirect.
2. **Bad redirect_uri** — same URL with `client_id=claude-hosted&redirect_uri=https://evil.example/x` → error page, **no** redirect.
3. **Signed out** — in a private window, open the full valid URL below → bounced to `/login?callbackUrl=%2Fmcp%2Fauthorize%3F…`; sign in; you land back on the consent screen with the parameters intact.
4. **Non-admin** — signed in as a `role: "user"` account → "Admin access required", no form.
5. **Consent** — signed in as an admin, open:

```
http://localhost:3000/mcp/authorize?client_id=claude-hosted&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fdev-callback&response_type=code&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&scope=marketplace%3Aread%20marketplace%3Awrite&state=dev-state&resource=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fmcp
```

Both radios appear, "Read and write" is preselected. Click **Deny** → the browser lands on `/dev-callback?error=access_denied&state=dev-state&iss=http://localhost:3000` (a 404 page — `/dev-callback` does not exist; read the URL bar, that is the assertion). Go back, click **Approve** → the URL bar shows `?code=…&state=dev-state&iss=…`. Keep that `code` for Task 7's manual check.

Delete the temp script:

```bash
rm scripts/_tmp-seed-client.ts
```

- [ ] **Step 9: Commit**

```bash
git add src/app/mcp/authorize src/__tests__/mcp/authorize-consent-action.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): admin consent screen and authorization-code minting

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `POST /mcp/token` — authorization-code exchange and refresh rotation

The token endpoint is the only place a bearer token is ever created. Two grants, one response shape, RFC 6749 error JSON on every failure, `Cache-Control: no-store` on every response, and a best-effort 20/min/IP limit.

The code exchange marks the code used and inserts the token row in a **single `db.batch`** — the Neon HTTP driver has no `db.transaction` (spec §3), and a crash between the two writes would otherwise leave a replayable code.

**Files:**
- Create: `src/app/mcp/token/route.ts`
- Test: `src/__tests__/mcp/token-route.test.ts`

**Interfaces:**
- Consumes: `generateOpaqueToken`, `sha256Hex`, `verifyPkceS256` (Task 3); `ACCESS_TOKEN_TTL_MS`, `REFRESH_TOKEN_TTL_MS`, `TOKEN_ENDPOINT_RATE_LIMIT`, `TOKEN_ENDPOINT_RATE_WINDOW_MS` (Task 3); `mcpOauthClients`, `mcpOauthCodes`, `mcpOauthTokens` (Task 2); `users` from `@/db/schema/auth`; `checkRateLimit` from `@/lib/rate-limit`.
- Produces: `POST(request: Request): Promise<Response>` at `/mcp/token`. Nothing else imports it; the contract is the wire format:
  `{ access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string }`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/mcp/token-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"
import { __resetRateLimits } from "@/lib/rate-limit"

/**
 * Tests the REAL POST handler in src/app/mcp/token/route.ts. Only the DB is
 * mocked; the rate limiter is the production module, reset between tests.
 */

const { findClient, findCode, findToken, findUser, batch, update, insert } = vi.hoisted(() => ({
  findClient: vi.fn(),
  findCode: vi.fn(),
  findToken: vi.fn(),
  findUser: vi.fn(),
  batch: vi.fn().mockResolvedValue(undefined),
  update: vi.fn(),
  insert: vi.fn(),
}))

vi.mock("@/db", () => ({
  db: {
    query: {
      mcpOauthClients: { findFirst: findClient },
      mcpOauthCodes: { findFirst: findCode },
      mcpOauthTokens: { findFirst: findToken },
      users: { findFirst: findUser },
    },
    batch: (...args: unknown[]) => batch(...args),
    update: (...args: unknown[]) => update(...args),
    insert: (...args: unknown[]) => insert(...args),
  },
}))

import { POST } from "@/app/mcp/token/route"

const ISSUER = "https://marketplace.hellosugar.salon"
const RESOURCE = `${ISSUER}/api/mcp`
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
const CHALLENGE = createHash("sha256").update(VERIFIER, "ascii").digest("base64url")

const CLIENT = { clientId: "claude-hosted", name: "Claude", redirectUris: [], isPublic: true }

const future = (ms: number) => new Date(Date.now() + ms)
const past = (ms: number) => new Date(Date.now() - ms)

const codeRow = (overrides: Record<string, unknown> = {}) => ({
  codeHash: sha256("the-code"),
  clientId: "claude-hosted",
  userId: "admin-1",
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
  codeChallenge: CHALLENGE,
  scope: "marketplace:read marketplace:write",
  resource: RESOURCE,
  label: "Parker's laptop",
  expiresAt: future(60_000),
  usedAt: null,
  createdAt: new Date(),
  ...overrides,
})

const tokenRow = (overrides: Record<string, unknown> = {}) => ({
  id: "tok-1",
  tokenHash: sha256("old-access"),
  refreshTokenHash: sha256("the-refresh"),
  clientId: "claude-hosted",
  userId: "admin-1",
  scope: "marketplace:read marketplace:write",
  label: null,
  expiresAt: past(1000),
  refreshExpiresAt: future(86_400_000),
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date(),
  ...overrides,
})

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function post(
  body: Record<string, string>,
  init: { contentType?: string | null; ip?: string } = {},
): Request {
  const headers: Record<string, string> = {}
  const contentType =
    init.contentType === undefined ? "application/x-www-form-urlencoded" : init.contentType
  if (contentType !== null) headers["content-type"] = contentType
  headers["x-forwarded-for"] = init.ip ?? "203.0.113.7"
  return new Request("http://localhost/mcp/token", {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
  })
}

const codeGrant = (overrides: Record<string, string> = {}) => ({
  grant_type: "authorization_code",
  client_id: "claude-hosted",
  code: "the-code",
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  code_verifier: VERIFIER,
  resource: RESOURCE,
  ...overrides,
})

let updateBuilder: ChainedBuilder
let insertBuilder: ChainedBuilder

beforeEach(() => {
  vi.clearAllMocks()
  __resetRateLimits()
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ISSUER)
  vi.stubEnv("MCP_ISSUER_URL", "")
  findClient.mockResolvedValue(CLIENT)
  findCode.mockResolvedValue(codeRow())
  findToken.mockResolvedValue(tokenRow())
  findUser.mockResolvedValue({ role: "admin" })
  updateBuilder = builder(undefined)
  insertBuilder = builder(undefined)
  update.mockReturnValue(updateBuilder)
  insert.mockReturnValue(insertBuilder)
  batch.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("content type and method gate", () => {
  it("rejects a JSON body with 415", async () => {
    const res = await POST(post(codeGrant(), { contentType: "application/json" }))
    expect(res.status).toBe(415)
    expect((await res.json()).error).toBe("invalid_request")
    expect(batch).not.toHaveBeenCalled()
  })

  it("rejects a missing content type with 415", async () => {
    const res = await POST(post(codeGrant(), { contentType: null }))
    expect(res.status).toBe(415)
  })

  it("accepts a charset parameter on the form content type", async () => {
    const res = await POST(
      post(codeGrant(), { contentType: "application/x-www-form-urlencoded; charset=UTF-8" }),
    )
    expect(res.status).toBe(200)
  })
})

describe("authorization_code grant", () => {
  it("returns the token pair and marks the code used in one batch", async () => {
    const res = await POST(post(codeGrant()))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")

    const body = await res.json()
    expect(body.token_type).toBe("Bearer")
    expect(body.expires_in).toBe(3600)
    expect(body.scope).toBe("marketplace:read marketplace:write")
    expect(body.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.access_token).not.toBe(body.refresh_token)

    // One atomic batch: neon-http has no transactions, and a half-applied
    // exchange would leave a replayable code.
    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch.mock.calls[0][0]).toHaveLength(2)
    expect(updateBuilder.calls.set[0][0]).toMatchObject({ usedAt: expect.any(Date) })
  })

  it("stores only hashes of the issued tokens, and copies scope, label and owner", async () => {
    const body = await (await POST(post(codeGrant()))).json()
    const row = insertBuilder.calls.values[0][0] as Record<string, unknown>
    expect(row.tokenHash).toBe(sha256(body.access_token))
    expect(row.refreshTokenHash).toBe(sha256(body.refresh_token))
    expect(row).toMatchObject({
      clientId: "claude-hosted",
      userId: "admin-1",
      scope: "marketplace:read marketplace:write",
      label: "Parker's laptop",
    })
    expect(JSON.stringify(row)).not.toContain(body.access_token)
    expect(JSON.stringify(row)).not.toContain(body.refresh_token)
  })

  it("sets a 1-hour access expiry and a 30-day refresh expiry", async () => {
    const before = Date.now()
    await POST(post(codeGrant()))
    const row = insertBuilder.calls.values[0][0] as Record<string, Date>
    expect(row.expiresAt.getTime() - before).toBeGreaterThanOrEqual(3_600_000 - 50)
    expect(row.refreshExpiresAt.getTime() - before).toBeGreaterThanOrEqual(
      30 * 24 * 3_600_000 - 50,
    )
  })

  it("carries a read-only grant through unchanged", async () => {
    findCode.mockResolvedValue(codeRow({ scope: "marketplace:read" }))
    const body = await (await POST(post(codeGrant()))).json()
    expect(body.scope).toBe("marketplace:read")
  })

  const rejections: Array<[string, () => void, Record<string, string>]> = [
    ["an unknown code", () => findCode.mockResolvedValue(undefined), {}],
    ["an already-used code", () => findCode.mockResolvedValue(codeRow({ usedAt: past(1000) })), {}],
    ["an expired code", () => findCode.mockResolvedValue(codeRow({ expiresAt: past(1000) })), {}],
    ["a code issued to another client", () => findCode.mockResolvedValue(codeRow({ clientId: "claude-code" })), {}],
    ["a mismatched redirect_uri", () => {}, { redirect_uri: "https://claude.ai/other" }],
    ["a mismatched resource", () => {}, { resource: `${ISSUER}/api/other` }],
    ["a wrong PKCE verifier", () => {}, { code_verifier: "not-the-verifier" }],
  ]

  it.each(rejections)("rejects %s with invalid_grant and writes nothing", async (_label, arrange, overrides) => {
    arrange()
    const res = await POST(post(codeGrant(overrides)))
    expect(res.status).toBe(400)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect((await res.json()).error).toBe("invalid_grant")
    expect(batch).not.toHaveBeenCalled()
  })

  it("rejects a missing code_verifier with invalid_request", async () => {
    const fields = codeGrant()
    delete (fields as Record<string, string>).code_verifier
    const res = await POST(post(fields))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_request")
    expect(batch).not.toHaveBeenCalled()
  })

  it("never leaks the code or the verifier in an error body", async () => {
    findCode.mockResolvedValue(undefined)
    const text = await (await POST(post(codeGrant()))).text()
    expect(text).not.toContain("the-code")
    expect(text).not.toContain(VERIFIER)
  })
})

describe("refresh_token grant", () => {
  const refreshGrant = (overrides: Record<string, string> = {}) => ({
    grant_type: "refresh_token",
    client_id: "claude-hosted",
    refresh_token: "the-refresh",
    ...overrides,
  })

  it("rotates BOTH hashes and extends both expiries", async () => {
    const res = await POST(post(refreshGrant()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // The presented refresh token must NOT come back — rotation means the old
    // one is dead the moment this returns.
    expect(body.refresh_token).not.toBe("the-refresh")

    const set = updateBuilder.calls.set[0][0] as Record<string, unknown>
    expect(set.tokenHash).toBe(sha256(body.access_token))
    expect(set.refreshTokenHash).toBe(sha256(body.refresh_token))
    expect(set.expiresAt).toBeInstanceOf(Date)
    expect(set.refreshExpiresAt).toBeInstanceOf(Date)
  })

  it("returns the grant's existing scope", async () => {
    findToken.mockResolvedValue(tokenRow({ scope: "marketplace:read" }))
    const body = await (await POST(post(refreshGrant()))).json()
    expect(body.scope).toBe("marketplace:read")
  })

  it("re-checks that the user is still an admin, and refuses when they are not", async () => {
    // Demotion must kill the connection at the next refresh, not at expiry.
    findUser.mockResolvedValue({ role: "user" })
    const res = await POST(post(refreshGrant()))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_grant")
    expect(update).not.toHaveBeenCalled()
  })

  it("refuses when the user row is gone", async () => {
    findUser.mockResolvedValue(undefined)
    expect((await (await POST(post(refreshGrant()))).json()).error).toBe("invalid_grant")
    expect(update).not.toHaveBeenCalled()
  })

  it.each([
    ["an unknown refresh token", () => findToken.mockResolvedValue(undefined)],
    ["a revoked grant", () => findToken.mockResolvedValue(tokenRow({ revokedAt: past(1000) }))],
    ["an expired refresh token", () => findToken.mockResolvedValue(tokenRow({ refreshExpiresAt: past(1000) }))],
    ["a grant belonging to another client", () => findToken.mockResolvedValue(tokenRow({ clientId: "claude-code" }))],
  ])("rejects %s with invalid_grant", async (_label, arrange) => {
    arrange()
    const res = await POST(post(refreshGrant()))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_grant")
    expect(update).not.toHaveBeenCalled()
  })

  it("rejects a missing refresh_token with invalid_request", async () => {
    const res = await POST(post({ grant_type: "refresh_token", client_id: "claude-hosted" }))
    expect((await res.json()).error).toBe("invalid_request")
  })
})

describe("client and grant-type gate", () => {
  it("rejects a missing client_id with invalid_client", async () => {
    const fields = codeGrant()
    delete (fields as Record<string, string>).client_id
    const res = await POST(post(fields))
    expect((await res.json()).error).toBe("invalid_client")
    expect(batch).not.toHaveBeenCalled()
  })

  it("rejects an unregistered client with invalid_client", async () => {
    findClient.mockResolvedValue(undefined)
    const res = await POST(post(codeGrant()))
    expect((await res.json()).error).toBe("invalid_client")
    expect(batch).not.toHaveBeenCalled()
  })

  it("rejects an unsupported grant type", async () => {
    const res = await POST(post({ grant_type: "client_credentials", client_id: "claude-hosted" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("unsupported_grant_type")
  })

  it("rejects a missing grant type", async () => {
    const res = await POST(post({ client_id: "claude-hosted" }))
    expect((await res.json()).error).toBe("unsupported_grant_type")
  })
})

describe("per-IP rate limit", () => {
  it("blocks the 21st request in a minute from one IP with 429 and Retry-After", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await POST(post(codeGrant(), { ip: "198.51.100.4" }))
      expect(res.status).toBe(200)
    }
    const blocked = await POST(post(codeGrant(), { ip: "198.51.100.4" }))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("cache-control")).toBe("no-store")
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThanOrEqual(0)
  })

  it("keys the limit on the FIRST x-forwarded-for hop, not the whole header", async () => {
    for (let i = 0; i < 20; i++) {
      await POST(post(codeGrant(), { ip: "198.51.100.5, 10.0.0.1" }))
    }
    // Same client IP, different proxy chain — must still be blocked.
    const blocked = await POST(post(codeGrant(), { ip: "198.51.100.5, 10.0.0.2" }))
    expect(blocked.status).toBe(429)
  })

  it("does not let one IP exhaust another IP's budget", async () => {
    for (let i = 0; i < 20; i++) {
      await POST(post(codeGrant(), { ip: "198.51.100.6" }))
    }
    const other = await POST(post(codeGrant(), { ip: "198.51.100.7" }))
    expect(other.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run src/__tests__/mcp/token-route.test.ts
```

Expected: FAIL — `Failed to resolve import "@/app/mcp/token/route"`.

- [ ] **Step 3: Write the token endpoint**

Create `src/app/mcp/token/route.ts`:

```ts
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { mcpOauthClients, mcpOauthCodes, mcpOauthTokens } from "@/db/schema/mcpOauth"
import { checkRateLimit } from "@/lib/rate-limit"
import { generateOpaqueToken, sha256Hex, verifyPkceS256 } from "@/lib/mcp/oauth/tokens"
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  TOKEN_ENDPOINT_RATE_LIMIT,
  TOKEN_ENDPOINT_RATE_WINDOW_MS,
} from "@/lib/mcp/oauth/constants"

/**
 * OAuth 2.1 token endpoint (spec section 4.2).
 *
 * Two grants: `authorization_code` (with mandatory PKCE S256) and
 * `refresh_token` (rotating both hashes and re-checking that the account is
 * still an admin). Errors follow RFC 6749 section 5.2 and every response —
 * success or failure — carries `Cache-Control: no-store`.
 *
 * Never log `code`, `code_verifier`, `refresh_token` or any issued token.
 */
export const runtime = "nodejs"

const JSON_NO_STORE: Record<string, string> = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
}

function oauthError(error: string, description: string, status = 400): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: JSON_NO_STORE,
  })
}

function tokenResponse(accessToken: string, refreshToken: string, scope: string): Response {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope,
    }),
    { status: 200, headers: JSON_NO_STORE },
  )
}

/**
 * First hop of x-forwarded-for — the client. Later hops are our own proxies, so
 * keying on the whole header would let one client rotate its budget by changing
 * the chain.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  return request.headers.get("x-real-ip") ?? "unknown"
}

export async function POST(request: Request): Promise<Response> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase()
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return oauthError(
      "invalid_request",
      "The token endpoint accepts application/x-www-form-urlencoded only.",
      415,
    )
  }

  // Best-effort only: src/lib/rate-limit.ts is per-instance in-memory
  // (DEBT-028). It throttles one hot-looping caller on a warm instance; it is
  // not a distributed guarantee.
  const limit = checkRateLimit(
    `mcp-token:${clientIp(request)}`,
    TOKEN_ENDPOINT_RATE_LIMIT,
    TOKEN_ENDPOINT_RATE_WINDOW_MS,
  )
  if (!limit.allowed) {
    // RFC 6749 section 5.2 defines no code for throttling, so this reuses
    // invalid_request and carries the detail in Retry-After.
    return new Response(
      JSON.stringify({
        error: "invalid_request",
        error_description: "Too many token requests. Try again shortly.",
      }),
      {
        status: 429,
        headers: {
          ...JSON_NO_STORE,
          "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 0) / 1000)),
        },
      },
    )
  }

  const form = new URLSearchParams(await request.text())

  const clientId = form.get("client_id")
  if (!clientId) return oauthError("invalid_client", "client_id is required.")

  const client = await db.query.mcpOauthClients.findFirst({
    where: eq(mcpOauthClients.clientId, clientId),
  })
  if (!client) return oauthError("invalid_client", "Unknown client_id.")

  const grantType = form.get("grant_type")
  if (grantType === "authorization_code") return exchangeAuthorizationCode(form, clientId)
  if (grantType === "refresh_token") return exchangeRefreshToken(form, clientId)

  return oauthError(
    "unsupported_grant_type",
    "Supported grant types are authorization_code and refresh_token.",
  )
}

async function exchangeAuthorizationCode(
  form: URLSearchParams,
  clientId: string,
): Promise<Response> {
  const code = form.get("code")
  const redirectUri = form.get("redirect_uri")
  const codeVerifier = form.get("code_verifier")
  if (!code || !redirectUri || !codeVerifier) {
    return oauthError(
      "invalid_request",
      "code, redirect_uri and code_verifier are required.",
    )
  }

  const row = await db.query.mcpOauthCodes.findFirst({
    where: eq(mcpOauthCodes.codeHash, sha256Hex(code)),
  })
  const now = new Date()

  // One generic message per branch: an attacker learns nothing from which of
  // these fired, and the presented values are never echoed.
  if (!row) return oauthError("invalid_grant", "Authorization code is invalid.")
  if (row.usedAt) {
    return oauthError("invalid_grant", "Authorization code has already been used.")
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return oauthError("invalid_grant", "Authorization code has expired.")
  }
  if (row.clientId !== clientId) {
    return oauthError("invalid_grant", "Authorization code was issued to another client.")
  }
  if (row.redirectUri !== redirectUri) {
    return oauthError("invalid_grant", "redirect_uri does not match the authorization request.")
  }
  const resource = form.get("resource")
  if (resource !== null && resource !== row.resource) {
    return oauthError("invalid_grant", "resource does not match the authorization request.")
  }
  if (!verifyPkceS256(codeVerifier, row.codeChallenge)) {
    return oauthError("invalid_grant", "PKCE verification failed.")
  }

  const accessToken = generateOpaqueToken()
  const refreshToken = generateOpaqueToken()

  // neon-http has no db.transaction (spec section 3). db.batch is the atomic
  // unit: without it a crash between the two writes leaves a replayable code.
  await db.batch([
    db
      .update(mcpOauthCodes)
      .set({ usedAt: now })
      .where(eq(mcpOauthCodes.codeHash, row.codeHash)),
    db.insert(mcpOauthTokens).values({
      tokenHash: sha256Hex(accessToken),
      refreshTokenHash: sha256Hex(refreshToken),
      clientId: row.clientId,
      userId: row.userId,
      scope: row.scope,
      label: row.label,
      expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    }),
  ])

  return tokenResponse(accessToken, refreshToken, row.scope)
}

async function exchangeRefreshToken(
  form: URLSearchParams,
  clientId: string,
): Promise<Response> {
  const refreshToken = form.get("refresh_token")
  if (!refreshToken) return oauthError("invalid_request", "refresh_token is required.")

  const row = await db.query.mcpOauthTokens.findFirst({
    where: eq(mcpOauthTokens.refreshTokenHash, sha256Hex(refreshToken)),
  })
  const now = new Date()

  if (!row) return oauthError("invalid_grant", "Refresh token is invalid.")
  if (row.revokedAt) return oauthError("invalid_grant", "This connection has been revoked.")
  if (row.refreshExpiresAt.getTime() <= now.getTime()) {
    return oauthError("invalid_grant", "Refresh token has expired.")
  }
  if (row.clientId !== clientId) {
    return oauthError("invalid_grant", "Refresh token was issued to another client.")
  }

  // Live admin re-check: a demoted account loses the connection at its next
  // refresh, not thirty days later.
  const user = await db.query.users.findFirst({
    where: eq(users.id, row.userId),
    columns: { role: true },
  })
  if (user?.role !== "admin") {
    return oauthError(
      "invalid_grant",
      "The connected account is no longer a marketplace admin.",
    )
  }

  const accessToken = generateOpaqueToken()
  const nextRefreshToken = generateOpaqueToken()

  // Rotation in place: the previous access AND refresh tokens are dead the
  // moment this row updates. One row per grant, never two.
  await db
    .update(mcpOauthTokens)
    .set({
      tokenHash: sha256Hex(accessToken),
      refreshTokenHash: sha256Hex(nextRefreshToken),
      expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    })
    .where(eq(mcpOauthTokens.id, row.id))

  return tokenResponse(accessToken, nextRefreshToken, row.scope)
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
npx vitest run src/__tests__/mcp/token-route.test.ts
```

Expected: PASS, 26 tests.

- [ ] **Step 5: Type-check and run the full suite**

```
npx tsc --noEmit
npm test
```

Expected: no type errors; all tests pass. If `db.batch` complains about its argument type, the array literal must stay a two-element literal — `db.batch` requires a non-empty tuple (see `src/lib/listings/actions.ts:80` for the same constraint).

- [ ] **Step 6: Exchange a real code end to end**

Using the `code` captured in Task 6 Step 8 (codes expire in 5 minutes — re-approve the consent screen if it has lapsed), with the dev server running:

```bash
curl -i -X POST http://localhost:3000/mcp/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "client_id=claude-hosted" \
  --data-urlencode "code=<the code from the URL bar>" \
  --data-urlencode "redirect_uri=http://localhost:3000/dev-callback" \
  --data-urlencode "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" \
  --data-urlencode "resource=http://localhost:3000/api/mcp"
```

Expected: `200`, `Cache-Control: no-store`, and a JSON body with `access_token`, `token_type: "Bearer"`, `expires_in: 3600`, `refresh_token`, `scope`. **Keep both tokens** — Tasks 8 and 9 use them.

Then confirm single use by replaying the identical command: expected `400` with `{"error":"invalid_grant","error_description":"Authorization code has already been used."}`.

Then confirm the JSON rejection:

```bash
curl -i -X POST http://localhost:3000/mcp/token -H "Content-Type: application/json" -d '{"grant_type":"authorization_code"}'
```

Expected: `415`.

- [ ] **Step 7: Commit**

```bash
git add src/app/mcp/token src/__tests__/mcp/token-route.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): OAuth token endpoint with PKCE exchange and refresh rotation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `POST /mcp/revoke` — RFC 7009 revocation

Small, self-contained, and deliberately incurious: one `token` parameter, which may be either half of the pair, and a `200` whether or not it matched. RFC 7009 §2.2 is explicit that an unknown token is a success — telling a caller "that token does not exist" turns the endpoint into an oracle.

**Files:**
- Create: `src/app/mcp/revoke/route.ts`
- Test: `src/__tests__/mcp/revoke-route.test.ts`

**Interfaces:**
- Consumes: `sha256Hex` (Task 3); `mcpOauthTokens` (Task 2).
- Produces: `POST(request: Request): Promise<Response>` at `/mcp/revoke`. Nothing imports it.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/mcp/revoke-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHash } from "node:crypto"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

/** Tests the REAL POST handler in src/app/mcp/revoke/route.ts. */

const { update } = vi.hoisted(() => ({ update: vi.fn() }))

vi.mock("@/db", () => ({ db: { update: (...args: unknown[]) => update(...args) } }))

import { POST } from "@/app/mcp/revoke/route"

let updateBuilder: ChainedBuilder

function post(
  body: Record<string, string>,
  contentType: string | null = "application/x-www-form-urlencoded",
): Request {
  const headers: Record<string, string> = {}
  if (contentType !== null) headers["content-type"] = contentType
  return new Request("http://localhost/mcp/revoke", {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  updateBuilder = builder(undefined)
  update.mockReturnValue(updateBuilder)
})

describe("POST /mcp/revoke", () => {
  it("stamps revoked_at and returns 200 with no body", async () => {
    const res = await POST(post({ token: "an-access-token" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.text()).toBe("")
    expect(update).toHaveBeenCalledTimes(1)
    expect(updateBuilder.calls.set[0][0]).toMatchObject({ revokedAt: expect.any(Date) })
  })

  it("returns 200 for a token that matches nothing (RFC 7009: no oracle)", async () => {
    updateBuilder = builder(undefined)
    update.mockReturnValue(updateBuilder)
    const res = await POST(post({ token: "never-issued" }))
    expect(res.status).toBe(200)
  })

  it("accepts a refresh token in the same parameter", async () => {
    // The handler hashes once and matches either column, so this is the same
    // code path — the assertion is that it does not 400 on a non-access token.
    const res = await POST(post({ token: "a-refresh-token", token_type_hint: "refresh_token" }))
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it("rejects a JSON body with 415 and writes nothing", async () => {
    const res = await POST(post({ token: "x" }, "application/json"))
    expect(res.status).toBe(415)
    expect((await res.json()).error).toBe("invalid_request")
    expect(update).not.toHaveBeenCalled()
  })

  it("rejects a missing token parameter with invalid_request", async () => {
    const res = await POST(post({}))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_request")
    expect(update).not.toHaveBeenCalled()
  })

  it("never echoes the presented token", async () => {
    const res = await POST(post({ token: "secret-token-value" }))
    expect(await res.text()).not.toContain("secret-token-value")
  })

  it("hashes the token rather than querying it in the clear", async () => {
    // Guards against a regression that compared the raw value: the WHERE clause
    // is opaque here, so assert on what reached the driver instead.
    await POST(post({ token: "hash-me" }))
    const digest = createHash("sha256").update("hash-me", "utf8").digest("hex")
    expect(JSON.stringify(updateBuilder.calls.where?.[0] ?? [])).not.toContain("hash-me")
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run src/__tests__/mcp/revoke-route.test.ts
```

Expected: FAIL — `Failed to resolve import "@/app/mcp/revoke/route"`.

- [ ] **Step 3: Write the revocation endpoint**

Create `src/app/mcp/revoke/route.ts`:

```ts
import { and, eq, isNull, or } from "drizzle-orm"
import { db } from "@/db"
import { mcpOauthTokens } from "@/db/schema/mcpOauth"
import { sha256Hex } from "@/lib/mcp/oauth/tokens"

/**
 * RFC 7009 token revocation (spec section 4.2).
 *
 * `token` may be either half of the pair — one hash is compared against both
 * columns, so a client that revokes whichever token it happens to hold kills
 * the whole grant.
 *
 * Deliberately incurious: an unknown token still returns 200 (RFC 7009 section
 * 2.2). Reporting "no such token" would turn this into an oracle for guessing
 * valid tokens. The presented value is never echoed and never logged.
 */
export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase()
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return new Response(
      JSON.stringify({
        error: "invalid_request",
        error_description:
          "The revocation endpoint accepts application/x-www-form-urlencoded only.",
      }),
      {
        status: 415,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      },
    )
  }

  const form = new URLSearchParams(await request.text())
  const token = form.get("token")
  // RFC 7009 section 2.1: `token` is REQUIRED, so its absence is a malformed
  // request rather than a revocation of nothing.
  if (!token) {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "token is required." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      },
    )
  }

  const hash = sha256Hex(token)

  // `token_type_hint` is accepted and ignored: matching both columns is cheaper
  // than trusting a hint, and RFC 7009 section 2.1 requires the server to fall
  // back to the other type anyway.
  await db
    .update(mcpOauthTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        or(eq(mcpOauthTokens.tokenHash, hash), eq(mcpOauthTokens.refreshTokenHash, hash)),
        // Never move an existing revocation timestamp forward.
        isNull(mcpOauthTokens.revokedAt),
      ),
    )

  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } })
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
npx vitest run src/__tests__/mcp/revoke-route.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Type-check and revoke a real token**

```
npx tsc --noEmit
```

Expected: no errors. Then, with the dev server running, revoke the access token minted in Task 7 Step 6:

```bash
curl -i -X POST http://localhost:3000/mcp/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "token=<the access_token>"
```

Expected: `200` with an empty body. **Do not revoke the pair you need for Task 9** — mint a second one via the consent screen first if you only have one.

- [ ] **Step 6: Commit**

```bash
git add src/app/mcp/revoke src/__tests__/mcp/revoke-route.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): RFC 7009 token revocation endpoint

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `verifyMcpToken` — the bearer gate PR C imports

This is the single function PR C calls on every MCP request, and the one place the "demotion revokes access on the next call" rule is enforced: the `users` row is re-read every time rather than trusted from the token.

**Files:**
- Create: `src/lib/mcp/auth/verify-token.ts`
- Test: `src/__tests__/mcp/verify-token.test.ts`

**Interfaces:**
- Consumes: `sha256Hex` (Task 3); `LAST_USED_TOUCH_INTERVAL_MS` (Task 3); `MCP_SCOPES` / `McpScope` (Task 3); `protectedResourceMetadataUrl` (Task 1); `mcpOauthTokens` (Task 2); `users` from `@/db/schema/auth`.
- Produces — **PR C imports exactly these, do not rename**:
  - `interface McpActor { userId: string; email: string | null; scopes: string[]; clientId: string; tokenId: string }`
  - `async function verifyMcpToken(bearer: string | null | undefined): Promise<McpActor | null>`
  - `const MCP_SCOPES` and `type McpScope` (re-exported from `@/lib/mcp/oauth/scopes`, so PR C has one import site)
  - `parseBearer(header: string | null | undefined): string | null`
  - `bearerChallenge(scope?: McpScope): string` — the `WWW-Authenticate` value for a 401
  - `insufficientScopeChallenge(scope: McpScope): string` — the `WWW-Authenticate` value for a 403

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/mcp/verify-token.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

const { select, update } = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }))

vi.mock("@/db", () => ({
  db: {
    select: (...args: unknown[]) => select(...args),
    update: (...args: unknown[]) => update(...args),
  },
}))

import {
  verifyMcpToken,
  parseBearer,
  bearerChallenge,
  insufficientScopeChallenge,
  MCP_SCOPES,
} from "@/lib/mcp/auth/verify-token"

const ISSUER = "https://marketplace.hellosugar.salon"
const TOKEN = "an-access-token"

const future = (ms: number) => new Date(Date.now() + ms)
const past = (ms: number) => new Date(Date.now() - ms)

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "tok-1",
  clientId: "claude-hosted",
  userId: "admin-1",
  scope: "marketplace:read marketplace:write",
  expiresAt: future(3_600_000),
  revokedAt: null,
  lastUsedAt: null,
  email: "parker@hellosugar.salon",
  role: "admin",
  ...overrides,
})

let updateBuilder: ChainedBuilder

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ISSUER)
  vi.stubEnv("MCP_ISSUER_URL", "")
  select.mockReturnValue(builder([row()]))
  updateBuilder = builder(undefined)
  update.mockReturnValue(updateBuilder)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("parseBearer", () => {
  it("extracts the token from a Bearer header", () => {
    expect(parseBearer("Bearer abc123")).toBe("abc123")
  })

  it("is case-insensitive about the scheme and tolerant of extra spaces", () => {
    expect(parseBearer("bearer   abc123  ")).toBe("abc123")
  })

  it("returns null for a missing, empty or non-Bearer header", () => {
    expect(parseBearer(null)).toBeNull()
    expect(parseBearer(undefined)).toBeNull()
    expect(parseBearer("")).toBeNull()
    expect(parseBearer("Basic abc123")).toBeNull()
    expect(parseBearer("Bearer")).toBeNull()
    expect(parseBearer("Bearer   ")).toBeNull()
  })
})

describe("verifyMcpToken — acceptance", () => {
  it("returns the actor for a live token owned by an admin", async () => {
    const actor = await verifyMcpToken(`Bearer ${TOKEN}`)
    expect(actor).toEqual({
      userId: "admin-1",
      email: "parker@hellosugar.salon",
      scopes: ["marketplace:read", "marketplace:write"],
      clientId: "claude-hosted",
      tokenId: "tok-1",
    })
  })

  it("splits a read-only scope into a one-element list", async () => {
    select.mockReturnValue(builder([row({ scope: "marketplace:read" })]))
    const actor = await verifyMcpToken(`Bearer ${TOKEN}`)
    expect(actor?.scopes).toEqual(["marketplace:read"])
  })

  it("tolerates a null email on the user row", async () => {
    select.mockReturnValue(builder([row({ email: null })]))
    expect((await verifyMcpToken(`Bearer ${TOKEN}`))?.email).toBeNull()
  })

  it("looks the token up by its SHA-256 hash, never in the clear", async () => {
    await verifyMcpToken(`Bearer ${TOKEN}`)
    const digest = createHash("sha256").update(TOKEN, "utf8").digest("hex")
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    // The raw value must not appear anywhere in what reached the driver.
    const b = select.mock.results[0].value as ChainedBuilder
    expect(JSON.stringify(b.calls.where ?? [])).not.toContain(TOKEN)
  })
})

describe("verifyMcpToken — rejection", () => {
  it("returns null with no header at all, without querying", async () => {
    expect(await verifyMcpToken(null)).toBeNull()
    expect(select).not.toHaveBeenCalled()
  })

  it("returns null for a non-Bearer scheme, without querying", async () => {
    expect(await verifyMcpToken("Basic abc")).toBeNull()
    expect(select).not.toHaveBeenCalled()
  })

  it("returns null when no row matches", async () => {
    select.mockReturnValue(builder([]))
    expect(await verifyMcpToken(`Bearer ${TOKEN}`)).toBeNull()
  })

  it("returns null for a revoked grant", async () => {
    select.mockReturnValue(builder([row({ revokedAt: past(1000) })]))
    expect(await verifyMcpToken(`Bearer ${TOKEN}`)).toBeNull()
  })

  it("returns null for an expired access token", async () => {
    select.mockReturnValue(builder([row({ expiresAt: past(1000) })]))
    expect(await verifyMcpToken(`Bearer ${TOKEN}`)).toBeNull()
  })

  it("returns null when the owner is no longer an admin", async () => {
    // Demotion revokes MCP access on the NEXT call, not at token expiry.
    select.mockReturnValue(builder([row({ role: "user" })]))
    expect(await verifyMcpToken(`Bearer ${TOKEN}`)).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })
})

describe("verifyMcpToken — last_used_at touch", () => {
  it("stamps last_used_at when it has never been set", async () => {
    await verifyMcpToken(`Bearer ${TOKEN}`)
    expect(update).toHaveBeenCalledTimes(1)
    expect(updateBuilder.calls.set[0][0]).toMatchObject({ lastUsedAt: expect.any(Date) })
  })

  it("stamps it again once the value is older than 60 s", async () => {
    select.mockReturnValue(builder([row({ lastUsedAt: past(61_000) })]))
    await verifyMcpToken(`Bearer ${TOKEN}`)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it("does NOT write when it was touched within the last 60 s", async () => {
    // Otherwise every MCP call becomes a write.
    select.mockReturnValue(builder([row({ lastUsedAt: past(5_000) })]))
    await verifyMcpToken(`Bearer ${TOKEN}`)
    expect(update).not.toHaveBeenCalled()
  })

  it("still returns the actor when the touch write fails", async () => {
    update.mockImplementation(() => {
      throw new Error("connection reset")
    })
    const actor = await verifyMcpToken(`Bearer ${TOKEN}`)
    expect(actor?.userId).toBe("admin-1")
  })
})

describe("WWW-Authenticate challenges", () => {
  it("points a 401 at the protected-resource metadata document", () => {
    expect(bearerChallenge()).toBe(
      `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/api/mcp", scope="marketplace:read"`,
    )
  })

  it("names the scope that was actually required", () => {
    expect(bearerChallenge("marketplace:write")).toContain('scope="marketplace:write"')
  })

  it("marks a 403 as insufficient_scope", () => {
    expect(insufficientScopeChallenge("marketplace:write")).toBe(
      `Bearer error="insufficient_scope", scope="marketplace:write", resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/api/mcp"`,
    )
  })

  it("re-exports the scope vocabulary so PR C has one import site", () => {
    expect(MCP_SCOPES).toEqual(["marketplace:read", "marketplace:write"])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run src/__tests__/mcp/verify-token.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/mcp/auth/verify-token"`.

- [ ] **Step 3: Write the verifier**

Create `src/lib/mcp/auth/verify-token.ts`:

```ts
/**
 * Bearer verification for every MCP request (spec section 4.3).
 *
 * This module is deliberately NOT a `"use server"` file. Every export of such a
 * module is reachable as an unauthenticated POST endpoint, and `verifyMcpToken`
 * takes an attacker-supplied string and answers "is this a valid admin token" —
 * exposing it as an action would publish a token-validity oracle. It is only
 * ever called server-side from the MCP route.
 *
 * Keep it that way: do not re-export this from a `"use server"` module, and do
 * not add `"use server"` to this file — either would recreate the endpoint.
 */
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { mcpOauthTokens } from "@/db/schema/mcpOauth"
import { sha256Hex } from "@/lib/mcp/oauth/tokens"
import { LAST_USED_TOUCH_INTERVAL_MS } from "@/lib/mcp/oauth/constants"
import { protectedResourceMetadataUrl } from "@/lib/mcp/oauth/urls"
import { type McpScope } from "@/lib/mcp/oauth/scopes"

// Re-exported so PR C imports the scope vocabulary from the same module as the
// verifier. The definitions live in oauth/scopes.ts, which stays DB-free.
export { MCP_SCOPES, type McpScope, isMcpScope } from "@/lib/mcp/oauth/scopes"

/** Who a verified MCP request is acting as. PR C puts this on the request context. */
export interface McpActor {
  userId: string
  email: string | null
  scopes: string[]
  clientId: string
  tokenId: string
}

/** Pull the credential out of an `Authorization` header value. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim())
  const token = match?.[1]?.trim()
  return token ? token : null
}

/**
 * Resolve a bearer credential to an actor, or null.
 *
 * The `users` row is re-read on EVERY call rather than trusted from the token:
 * demoting an admin must revoke MCP access on their next request, not thirty
 * days later when the refresh token lapses.
 */
export async function verifyMcpToken(
  bearer: string | null | undefined,
): Promise<McpActor | null> {
  const token = parseBearer(bearer)
  if (!token) return null

  const rows = await db
    .select({
      id: mcpOauthTokens.id,
      clientId: mcpOauthTokens.clientId,
      userId: mcpOauthTokens.userId,
      scope: mcpOauthTokens.scope,
      expiresAt: mcpOauthTokens.expiresAt,
      revokedAt: mcpOauthTokens.revokedAt,
      lastUsedAt: mcpOauthTokens.lastUsedAt,
      email: users.email,
      role: users.role,
    })
    .from(mcpOauthTokens)
    .innerJoin(users, eq(users.id, mcpOauthTokens.userId))
    .where(eq(mcpOauthTokens.tokenHash, sha256Hex(token)))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (row.revokedAt) return null

  const now = Date.now()
  if (row.expiresAt.getTime() <= now) return null
  if (row.role !== "admin") return null

  // At most one write per minute per grant — otherwise every MCP call becomes
  // a write, for a column the UI only ever shows to the minute.
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() >= LAST_USED_TOUCH_INTERVAL_MS) {
    try {
      await db
        .update(mcpOauthTokens)
        .set({ lastUsedAt: new Date(now) })
        .where(eq(mcpOauthTokens.id, row.id))
    } catch (err) {
      // Bookkeeping must never fail an authenticated request.
      console.warn("[mcp] last_used_at touch failed (non-fatal):", err)
    }
  }

  return {
    userId: row.userId,
    email: row.email,
    scopes: row.scope.split(" ").filter(Boolean),
    clientId: row.clientId,
    tokenId: row.id,
  }
}

/**
 * `WWW-Authenticate` for a 401. The `resource_metadata` pointer is what lets a
 * client discover the authorization server and start the OAuth flow by itself.
 */
export function bearerChallenge(scope: McpScope = "marketplace:read"): string {
  return `Bearer resource_metadata="${protectedResourceMetadataUrl()}", scope="${scope}"`
}

/** `WWW-Authenticate` for a 403 — authenticated, but the grant is too narrow. */
export function insufficientScopeChallenge(scope: McpScope): string {
  return `Bearer error="insufficient_scope", scope="${scope}", resource_metadata="${protectedResourceMetadataUrl()}"`
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
npx vitest run src/__tests__/mcp/verify-token.test.ts
```

Expected: PASS, 22 tests.

- [ ] **Step 5: Type-check and run the full suite**

```
npx tsc --noEmit
npm test
```

Expected: no type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/auth/verify-token.ts src/__tests__/mcp/verify-token.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): bearer verification with live admin re-check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `grants.ts` — listing and revoking connections

The data layer behind `/admin/mcp-connections` and, in PR C, behind the `list_mcp_connections` and `revoke_mcp_connection` tools. `ownOnly` exists precisely because those two callers differ: the admin UI revokes any admin's grant, while the MCP tool may only revoke the caller's own (spec §7.4) — a token must not be able to cut off a different admin.

**Files:**
- Create: `src/lib/mcp/oauth/grants.ts`
- Test: `src/__tests__/mcp/grants.test.ts`

**Interfaces:**
- Consumes: `mcpOauthTokens`, `mcpOauthClients` (Task 2); `users` from `@/db/schema/auth`.
- Produces — **PR C imports exactly these, do not rename**:
  - `interface McpConnectionRow { id: string; userId: string; userEmail: string | null; clientId: string; clientName: string; scope: string; label: string | null; createdAt: Date; lastUsedAt: Date | null; expiresAt: Date; refreshExpiresAt: Date; revokedAt: Date | null }`
  - `async function listMcpConnections(opts: { userId: string; all: boolean }): Promise<McpConnectionRow[]>`
  - `async function revokeMcpToken(opts: { tokenId: string; requesterUserId: string; ownOnly: boolean }): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/mcp/grants.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

const { select, update, findFirst } = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  findFirst: vi.fn(),
}))

vi.mock("@/db", () => ({
  db: {
    select: (...args: unknown[]) => select(...args),
    update: (...args: unknown[]) => update(...args),
    query: { mcpOauthTokens: { findFirst } },
  },
}))

import { listMcpConnections, revokeMcpToken } from "@/lib/mcp/oauth/grants"

const CONNECTION = {
  id: "tok-1",
  userId: "admin-1",
  userEmail: "parker@hellosugar.salon",
  clientId: "claude-hosted",
  clientName: "Claude (claude.ai)",
  scope: "marketplace:read marketplace:write",
  label: "Parker's laptop",
  createdAt: new Date("2026-09-14T10:00:00.000Z"),
  lastUsedAt: new Date("2026-09-14T11:00:00.000Z"),
  expiresAt: new Date("2026-09-14T12:00:00.000Z"),
  refreshExpiresAt: new Date("2026-10-14T10:00:00.000Z"),
  revokedAt: null,
}

let selectBuilder: ChainedBuilder
let updateBuilder: ChainedBuilder

beforeEach(() => {
  vi.clearAllMocks()
  selectBuilder = builder([CONNECTION])
  updateBuilder = builder(undefined)
  select.mockReturnValue(selectBuilder)
  update.mockReturnValue(updateBuilder)
  findFirst.mockResolvedValue({ id: "tok-1", userId: "admin-1", revokedAt: null })
})

describe("listMcpConnections", () => {
  it("returns the joined row shape the admin table renders", async () => {
    const rows = await listMcpConnections({ userId: "admin-1", all: false })
    expect(rows).toEqual([CONNECTION])
  })

  it("filters to the caller when all is false", async () => {
    await listMcpConnections({ userId: "admin-1", all: false })
    expect(selectBuilder.calls.where).toHaveLength(1)
  })

  it("applies no owner filter when all is true", async () => {
    await listMcpConnections({ userId: "admin-1", all: true })
    expect(selectBuilder.calls.where ?? []).toHaveLength(0)
  })

  it("orders newest first so the connection just made is on top", async () => {
    await listMcpConnections({ userId: "admin-1", all: false })
    expect(selectBuilder.calls.orderBy).toHaveLength(1)
  })

  it("joins the client so the table can show a display name", async () => {
    await listMcpConnections({ userId: "admin-1", all: true })
    expect(selectBuilder.calls.innerJoin).toHaveLength(2)
  })

  it("returns an empty array when the admin has no connections", async () => {
    select.mockReturnValue(builder([]))
    expect(await listMcpConnections({ userId: "admin-2", all: false })).toEqual([])
  })
})

describe("revokeMcpToken", () => {
  it("stamps revoked_at and reports success", async () => {
    const result = await revokeMcpToken({
      tokenId: "tok-1",
      requesterUserId: "admin-1",
      ownOnly: false,
    })
    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledTimes(1)
    expect(updateBuilder.calls.set[0][0]).toMatchObject({ revokedAt: expect.any(Date) })
  })

  it("reports a missing connection instead of throwing", async () => {
    findFirst.mockResolvedValue(undefined)
    expect(
      await revokeMcpToken({ tokenId: "ghost", requesterUserId: "admin-1", ownOnly: false }),
    ).toEqual({ ok: false, error: "Connection not found" })
    expect(update).not.toHaveBeenCalled()
  })

  it("refuses another admin's connection when ownOnly is set", async () => {
    // This is the MCP tool's path (spec section 7.4): a token must not be able
    // to cut off a different admin.
    findFirst.mockResolvedValue({ id: "tok-9", userId: "admin-2", revokedAt: null })
    expect(
      await revokeMcpToken({ tokenId: "tok-9", requesterUserId: "admin-1", ownOnly: true }),
    ).toEqual({ ok: false, error: "You can only revoke your own MCP connections" })
    expect(update).not.toHaveBeenCalled()
  })

  it("allows another admin's connection from the admin UI (ownOnly false)", async () => {
    findFirst.mockResolvedValue({ id: "tok-9", userId: "admin-2", revokedAt: null })
    expect(
      await revokeMcpToken({ tokenId: "tok-9", requesterUserId: "admin-1", ownOnly: false }),
    ).toEqual({ ok: true })
    expect(update).toHaveBeenCalledTimes(1)
  })

  it("allows the caller's own connection when ownOnly is set", async () => {
    expect(
      await revokeMcpToken({ tokenId: "tok-1", requesterUserId: "admin-1", ownOnly: true }),
    ).toEqual({ ok: true })
  })

  it("is idempotent: revoking an already-revoked connection succeeds without a second write", async () => {
    findFirst.mockResolvedValue({
      id: "tok-1",
      userId: "admin-1",
      revokedAt: new Date("2026-09-13T00:00:00.000Z"),
    })
    expect(
      await revokeMcpToken({ tokenId: "tok-1", requesterUserId: "admin-1", ownOnly: false }),
    ).toEqual({ ok: true })
    // Never move an existing revocation timestamp forward.
    expect(update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run src/__tests__/mcp/grants.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/mcp/oauth/grants"`.

- [ ] **Step 3: Write the grants module**

Create `src/lib/mcp/oauth/grants.ts`:

```ts
/**
 * Read and revoke MCP connections.
 *
 * This module is deliberately NOT a `"use server"` file. Every export of such a
 * module is a public POST endpoint, and `revokeMcpToken` takes a caller id as a
 * PARAMETER rather than reading the session — exposing it directly would let
 * anyone pass someone else's id and revoke their connection. The session is
 * resolved by the thin `"use server"` wrapper in
 * src/app/admin/mcp-connections/actions.ts, and by the bearer actor in PR C.
 *
 * Keep it that way: do not add `"use server"` to this file.
 */
import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { mcpOauthClients, mcpOauthTokens } from "@/db/schema/mcpOauth"

/** One grant, as the admin table and the MCP list tool render it. */
export interface McpConnectionRow {
  id: string
  userId: string
  userEmail: string | null
  clientId: string
  clientName: string
  scope: string
  label: string | null
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date
  refreshExpiresAt: Date
  revokedAt: Date | null
}

/**
 * Grants for one admin, or for every admin when `all` is true.
 *
 * Revoked and expired rows are INCLUDED: the table shows status, and hiding a
 * revocation would make "did that actually take effect?" unanswerable.
 */
export async function listMcpConnections(opts: {
  userId: string
  all: boolean
}): Promise<McpConnectionRow[]> {
  const query = db
    .select({
      id: mcpOauthTokens.id,
      userId: mcpOauthTokens.userId,
      userEmail: users.email,
      clientId: mcpOauthTokens.clientId,
      clientName: mcpOauthClients.name,
      scope: mcpOauthTokens.scope,
      label: mcpOauthTokens.label,
      createdAt: mcpOauthTokens.createdAt,
      lastUsedAt: mcpOauthTokens.lastUsedAt,
      expiresAt: mcpOauthTokens.expiresAt,
      refreshExpiresAt: mcpOauthTokens.refreshExpiresAt,
      revokedAt: mcpOauthTokens.revokedAt,
    })
    .from(mcpOauthTokens)
    .innerJoin(users, eq(users.id, mcpOauthTokens.userId))
    .innerJoin(mcpOauthClients, eq(mcpOauthClients.clientId, mcpOauthTokens.clientId))

  const scoped = opts.all ? query : query.where(eq(mcpOauthTokens.userId, opts.userId))

  return scoped.orderBy(desc(mcpOauthTokens.createdAt))
}

/**
 * Revoke one grant.
 *
 * `ownOnly` is the difference between the two callers: the admin UI passes
 * false (an admin may revoke any admin's connection), while PR C's
 * `revoke_mcp_connection` tool passes true, so a token can only cut off itself
 * or its owner's other connections — never another admin's (spec section 7.4).
 *
 * Returns `{ ok: false, error }` rather than throwing, because Next redacts
 * thrown server-action messages in production and the admin would otherwise see
 * only "an error occurred" (same convention as `addToAllowlist`).
 */
export async function revokeMcpToken(opts: {
  tokenId: string
  requesterUserId: string
  ownOnly: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db.query.mcpOauthTokens.findFirst({
    where: eq(mcpOauthTokens.id, opts.tokenId),
    columns: { id: true, userId: true, revokedAt: true },
  })

  if (!row) return { ok: false, error: "Connection not found" }

  if (opts.ownOnly && row.userId !== opts.requesterUserId) {
    // Same message as "not found" would be friendlier to enumeration, but this
    // surface is admin-only: a clear message is worth more than the ambiguity.
    return { ok: false, error: "You can only revoke your own MCP connections" }
  }

  // Idempotent, and never moves an existing revocation timestamp forward.
  if (row.revokedAt) return { ok: true }

  await db
    .update(mcpOauthTokens)
    .set({ revokedAt: new Date() })
    .where(eq(mcpOauthTokens.id, row.id))

  return { ok: true }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
npx vitest run src/__tests__/mcp/grants.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Type-check**

```
npx tsc --noEmit
```

Expected: no errors. If `scoped.orderBy(...)` complains, the ternary needs both branches to be the same builder type — assign the `.where(...)` result to a variable typed as the query, as written above.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/oauth/grants.ts src/__tests__/mcp/grants.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): list and revoke MCP connections

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `/admin/mcp-connections` — table, revoke action, setup instructions, nav

The admin-facing half of spec §4.4. The revoke action is wrapped in PR A's `withAudit`, so a revocation from the UI shows up in the activity feed exactly like any other admin action.

There is no test for the page or the table component — vitest runs in a node environment with a `.ts`-only glob, so React components cannot be rendered or imported. The testable parts are split out deliberately: status derivation into a pure module, and the revoke action into a `.ts` file that is unit-tested below.

**Files:**
- Create: `src/lib/mcp/oauth/connection-status.ts`
- Create: `src/app/admin/mcp-connections/page.tsx`
- Create: `src/app/admin/mcp-connections/actions.ts`
- Create: `src/components/admin/McpConnectionsTable.tsx`
- Modify: `src/lib/navigation.ts` (`ADMIN_NAV`, after the `Owners` entry)
- Test: `src/__tests__/mcp/connection-status.test.ts`
- Test: `src/__tests__/mcp/mcp-connections-action.test.ts`
- Test: `src/__tests__/navigation.test.ts` (the admin-sections assertion)

**Interfaces:**
- Consumes: `listMcpConnections`, `revokeMcpToken`, `McpConnectionRow` (Task 10); `issuerUrl`, `mcpResourceUrl` (Task 1); `requireAdmin` from `@/lib/auth-guards`; `auth` from `@/auth`; `ConfirmDialog` from `@/components/admin/ConfirmDialog`; **from PR A**: `withAudit` from `@/lib/admin/audit` and `uiActor` from `@/lib/admin/core/actor`.
- Produces:
  - `type McpConnectionStatus = "active" | "idle" | "expired" | "revoked"`
  - `mcpConnectionStatus(row: { expiresAt: Date; refreshExpiresAt: Date; revokedAt: Date | null }, now?: Date): McpConnectionStatus`
  - `MCP_CONNECTION_STATUS_LABELS: Record<McpConnectionStatus, string>`
  - `revokeMcpConnection(tokenId: string): Promise<{ ok: true } | { ok: false; error: string }>` (`"use server"`)

- [ ] **Step 0: Confirm PR A's audit helpers exist**

```bash
grep -n "export async function withAudit\|export function withAudit" src/lib/admin/audit.ts
grep -n "export function uiActor\|export type AdminActor" src/lib/admin/core/actor.ts
```

Expected: a hit in each file. If either is missing, PR A has not merged — **stop and report**. Note the exact `withAudit` signature you find; the call in Step 5 assumes `withAudit(actor, action, target, args, fn)`.

- [ ] **Step 1: Write the failing status test**

Create `src/__tests__/mcp/connection-status.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  mcpConnectionStatus,
  MCP_CONNECTION_STATUS_LABELS,
} from "@/lib/mcp/oauth/connection-status"

const NOW = new Date("2026-09-14T12:00:00.000Z")
const at = (iso: string) => new Date(iso)

const row = (overrides: Partial<{ expiresAt: Date; refreshExpiresAt: Date; revokedAt: Date | null }> = {}) => ({
  expiresAt: at("2026-09-14T13:00:00.000Z"),
  refreshExpiresAt: at("2026-10-14T12:00:00.000Z"),
  revokedAt: null as Date | null,
  ...overrides,
})

describe("mcpConnectionStatus", () => {
  it("is active while the access token is still valid", () => {
    expect(mcpConnectionStatus(row(), NOW)).toBe("active")
  })

  it("is idle when the access token lapsed but the refresh token has not", () => {
    // Normal for a connection nobody has used in over an hour: the client
    // refreshes on its next call, so this is not a problem state.
    expect(mcpConnectionStatus(row({ expiresAt: at("2026-09-14T11:00:00.000Z") }), NOW)).toBe(
      "idle",
    )
  })

  it("is expired once the refresh token lapses", () => {
    expect(
      mcpConnectionStatus(
        row({
          expiresAt: at("2026-08-14T12:00:00.000Z"),
          refreshExpiresAt: at("2026-09-13T12:00:00.000Z"),
        }),
        NOW,
      ),
    ).toBe("expired")
  })

  it("reports revoked even when the tokens would otherwise be live", () => {
    // Revocation wins: it is the state the admin acted to create.
    expect(mcpConnectionStatus(row({ revokedAt: at("2026-09-14T11:30:00.000Z") }), NOW)).toBe(
      "revoked",
    )
  })

  it("reports revoked even when the refresh token has also expired", () => {
    expect(
      mcpConnectionStatus(
        row({
          expiresAt: at("2026-08-14T12:00:00.000Z"),
          refreshExpiresAt: at("2026-09-13T12:00:00.000Z"),
          revokedAt: at("2026-09-01T12:00:00.000Z"),
        }),
        NOW,
      ),
    ).toBe("revoked")
  })

  it("treats an expiry exactly at now as lapsed", () => {
    expect(mcpConnectionStatus(row({ expiresAt: NOW }), NOW)).toBe("idle")
  })

  it("has a human label for every status", () => {
    expect(MCP_CONNECTION_STATUS_LABELS).toEqual({
      active: "Active",
      idle: "Idle",
      expired: "Expired",
      revoked: "Revoked",
    })
  })
})
```

- [ ] **Step 2: Write the failing revoke-action test**

Create `src/__tests__/mcp/mcp-connections-action.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Tests the REAL `revokeMcpConnection` server action: its admin guard, its
 * audit wrapping (PR A), and that it delegates with ownOnly=false — the admin
 * UI may revoke any admin's connection, unlike PR C's MCP tool.
 */

const { requireAdmin, revokeMcpToken, withAudit, uiActor, revalidatePath } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  revokeMcpToken: vi.fn(),
  // Pass-through that records its arguments and runs fn, like the real writer.
  withAudit: vi.fn(
    async (
      _actor: unknown,
      _action: string,
      _target: unknown,
      _args: unknown,
      fn: () => Promise<unknown>,
    ) => fn(),
  ),
  uiActor: vi.fn((userId: string) => ({ userId, source: "ui" })),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/auth-guards", () => ({ requireAdmin }))
vi.mock("@/lib/mcp/oauth/grants", () => ({ revokeMcpToken }))
vi.mock("@/lib/admin/audit", () => ({ withAudit }))
vi.mock("@/lib/admin/core/actor", () => ({ uiActor }))
vi.mock("next/cache", () => ({ revalidatePath }))

import { revokeMcpConnection } from "@/app/admin/mcp-connections/actions"

beforeEach(() => {
  vi.clearAllMocks()
  requireAdmin.mockResolvedValue({ id: "admin-1", role: "admin" })
  revokeMcpToken.mockResolvedValue({ ok: true })
})

describe("revokeMcpConnection", () => {
  it("revokes through the grants module and returns its result", async () => {
    expect(await revokeMcpConnection("tok-1")).toEqual({ ok: true })
    expect(revokeMcpToken).toHaveBeenCalledWith({
      tokenId: "tok-1",
      requesterUserId: "admin-1",
      // The admin UI may revoke ANY admin's connection; PR C's tool passes true.
      ownOnly: false,
    })
  })

  it("wraps the revocation in an audit entry", async () => {
    await revokeMcpConnection("tok-1")
    expect(uiActor).toHaveBeenCalledWith("admin-1")
    const [actor, action, target, args] = withAudit.mock.calls[0]
    expect(actor).toEqual({ userId: "admin-1", source: "ui" })
    expect(action).toBe("mcp_token.revoke")
    expect(target).toEqual({ type: "mcp_token", id: "tok-1" })
    expect(args).toEqual({ tokenId: "tok-1" })
  })

  it("refuses a non-admin caller before touching anything", async () => {
    requireAdmin.mockRejectedValue(new Error("Unauthorized: Admin access required"))
    await expect(revokeMcpConnection("tok-1")).rejects.toThrow("Unauthorized")
    expect(withAudit).not.toHaveBeenCalled()
    expect(revokeMcpToken).not.toHaveBeenCalled()
  })

  it("passes a failure back to the caller instead of throwing", async () => {
    revokeMcpToken.mockResolvedValue({ ok: false, error: "Connection not found" })
    expect(await revokeMcpConnection("ghost")).toEqual({
      ok: false,
      error: "Connection not found",
    })
  })

  it("revalidates the page so the table reflects the new status", async () => {
    await revokeMcpConnection("tok-1")
    expect(revalidatePath).toHaveBeenCalledWith("/admin/mcp-connections")
  })
})
```

- [ ] **Step 3: Run both tests to verify they fail**

```
npx vitest run src/__tests__/mcp/connection-status.test.ts src/__tests__/mcp/mcp-connections-action.test.ts
```

Expected: FAIL — neither `@/lib/mcp/oauth/connection-status` nor `@/app/admin/mcp-connections/actions` resolves.

- [ ] **Step 4: Write the status helper**

Create `src/lib/mcp/oauth/connection-status.ts`:

```ts
/**
 * Display status for one MCP connection.
 *
 * NOT a `"use server"` module, and DB-free — it lives here rather than inside
 * the table component because this repo's vitest cannot import React
 * components (node env, `.ts`-only glob), so logic in a `.tsx` file is untested
 * logic.
 */
export type McpConnectionStatus = "active" | "idle" | "expired" | "revoked"

export const MCP_CONNECTION_STATUS_LABELS: Record<McpConnectionStatus, string> = {
  active: "Active",
  idle: "Idle",
  expired: "Expired",
  revoked: "Revoked",
}

export function mcpConnectionStatus(
  row: { expiresAt: Date; refreshExpiresAt: Date; revokedAt: Date | null },
  now: Date = new Date(),
): McpConnectionStatus {
  // Revocation wins over every clock: it is the state an admin acted to create.
  if (row.revokedAt) return "revoked"
  const t = now.getTime()
  if (row.refreshExpiresAt.getTime() <= t) return "expired"
  // Access token lapsed but the refresh token has not — the client renews on
  // its next call, so this is idle, not broken.
  if (row.expiresAt.getTime() <= t) return "idle"
  return "active"
}
```

- [ ] **Step 5: Write the server action**

Create `src/app/admin/mcp-connections/actions.ts`:

```ts
"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth-guards"
import { withAudit } from "@/lib/admin/audit"
import { uiActor } from "@/lib/admin/core/actor"
import { revokeMcpToken } from "@/lib/mcp/oauth/grants"

/**
 * Revoke one MCP connection from the admin UI.
 *
 * Thin by design: this is a `"use server"` export, i.e. a public POST endpoint,
 * so its only jobs are to resolve the session (never trust a caller-supplied
 * user id) and to hand the work to the plain module in
 * src/lib/mcp/oauth/grants.ts.
 *
 * `ownOnly: false` — an admin may revoke ANY admin's connection from this page
 * (spec section 4.4's "All admins" toggle). PR C's `revoke_mcp_connection` tool
 * passes true instead, so a bearer token can never cut off a different admin.
 */
export async function revokeMcpConnection(
  tokenId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin()
  if (!admin.id) throw new Error("Unauthorized: Admin access required")

  const result = await withAudit(
    uiActor(admin.id),
    "mcp_token.revoke",
    { type: "mcp_token", id: tokenId },
    { tokenId },
    () => revokeMcpToken({ tokenId, requesterUserId: admin.id!, ownOnly: false }),
  )

  revalidatePath("/admin/mcp-connections")
  return result
}
```

- [ ] **Step 6: Run both tests to verify they pass**

```
npx vitest run src/__tests__/mcp/connection-status.test.ts src/__tests__/mcp/mcp-connections-action.test.ts
```

Expected: PASS — 7 status tests, 5 action tests.

- [ ] **Step 7: Write the table component**

Create `src/components/admin/McpConnectionsTable.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import {
  mcpConnectionStatus,
  MCP_CONNECTION_STATUS_LABELS,
  type McpConnectionStatus,
} from '@/lib/mcp/oauth/connection-status'
import { revokeMcpConnection } from '@/app/admin/mcp-connections/actions'

/**
 * Admin MCP connection table — mirrors BrandRequestsTable.tsx (client table,
 * same cell/typography scale) plus a row action, using the shared
 * ConfirmDialog the way UsersManager does.
 */

export interface McpConnectionTableRow {
  id: string
  userEmail: string | null
  clientId: string
  clientName: string
  scope: string
  label: string | null
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date
  refreshExpiresAt: Date
  revokedAt: Date | null
}

interface McpConnectionsTableProps {
  connections: McpConnectionTableRow[]
  showAll: boolean
}

const STATUS_CLASSES: Record<McpConnectionStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  idle: 'bg-gray-100 text-gray-600',
  expired: 'bg-amber-50 text-amber-700',
  revoked: 'bg-hs-red-50 text-hs-red-700',
}

const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Denver',
  }).format(new Date(date))

function scopeLabel(scope: string): string {
  return scope.includes('marketplace:write') ? 'Read and write' : 'Read only'
}

export function McpConnectionsTable({ connections, showAll }: McpConnectionsTableProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [target, setTarget] = useState<McpConnectionTableRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  function confirmRevoke() {
    if (!target) return
    const tokenId = target.id
    startTransition(async () => {
      const result = await revokeMcpConnection(tokenId)
      setTarget(null)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError(null)
      router.refresh()
    })
  }

  if (connections.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
        {showAll
          ? 'No admin has connected an MCP client yet.'
          : 'You have not connected an MCP client yet.'}
      </div>
    )
  }

  return (
    <>
      {error && (
        <p className="rounded-lg bg-hs-red-50 px-4 py-3 text-sm text-hs-red-700">{error}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Connection
                </th>
                {showAll && (
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Admin
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Client
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Access
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Created
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Last used
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {connections.map((connection) => {
                const status = mcpConnectionStatus(connection)
                return (
                  <tr key={connection.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4 font-medium text-gray-900">
                      {connection.label ?? '—'}
                    </td>
                    {showAll && (
                      <td className="px-4 py-4 text-sm text-gray-500">
                        {connection.userEmail ?? '—'}
                      </td>
                    )}
                    <td className="px-4 py-4 text-sm text-gray-500">
                      {connection.clientName}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-500">
                      {scopeLabel(connection.scope)}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${STATUS_CLASSES[status]}`}
                      >
                        {MCP_CONNECTION_STATUS_LABELS[status]}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-500">
                      {formatDateTime(connection.createdAt)}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-500">
                      {connection.lastUsedAt ? formatDateTime(connection.lastUsedAt) : 'Never'}
                    </td>
                    <td className="px-4 py-4 text-right">
                      {status === 'revoked' ? (
                        <span className="text-sm text-gray-400">Revoked</span>
                      ) : (
                        <button
                          onClick={() => setTarget(connection)}
                          disabled={pending}
                          className="text-sm font-semibold text-hs-red-600 hover:text-hs-red-700 disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        isOpen={target !== null}
        title="Revoke this connection?"
        message={`${
          target?.label ?? target?.clientName ?? 'This connection'
        } will stop working immediately, and the client will have to authorize again.`}
        confirmLabel="Revoke"
        variant="danger"
        isProcessing={pending}
        onConfirm={confirmRevoke}
        onCancel={() => setTarget(null)}
      />
    </>
  )
}
```

- [ ] **Step 8: Write the page**

Create `src/app/admin/mcp-connections/page.tsx`:

```tsx
import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listMcpConnections } from "@/lib/mcp/oauth/grants"
import { mcpResourceUrl } from "@/lib/mcp/oauth/urls"
import { McpConnectionsTable } from "@/components/admin/McpConnectionsTable"

/**
 * Spec section 4.4. Shows the caller's own grants by default with an
 * "All admins" toggle, plus the copy-paste setup instructions for both
 * pre-registered clients.
 */
export const dynamic = "force-dynamic"

interface McpConnectionsPageProps {
  searchParams: Promise<{ all?: string }>
}

export default async function AdminMcpConnectionsPage({
  searchParams,
}: McpConnectionsPageProps) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    redirect("/")
  }

  const { all } = await searchParams
  const showAll = all === "1"

  const connections = await listMcpConnections({
    userId: session.user.id,
    all: showAll,
  })

  const endpoint = mcpResourceUrl()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-gray-900">MCP connections</h1>
        <Link
          href={showAll ? "/admin/mcp-connections" : "/admin/mcp-connections?all=1"}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {showAll ? "Show only mine" : "Show all admins"}
        </Link>
      </div>

      <McpConnectionsTable connections={connections} showAll={showAll} />

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="font-semibold text-gray-900">Connect a client</h2>
        <p className="text-sm text-gray-500">
          Both clients are pre-registered — there is no client secret, and sign-in happens
          in your browser with your own admin account. You choose read-only or read-and-write
          on the consent screen.
        </p>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Claude.ai (custom connector)</h3>
          <dl className="space-y-1 text-sm text-gray-600">
            <div className="flex flex-wrap gap-2">
              <dt className="font-medium text-gray-700">Server URL</dt>
              <dd>
                <code className="rounded bg-gray-100 px-2 py-1">{endpoint}</code>
              </dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="font-medium text-gray-700">Client ID</dt>
              <dd>
                <code className="rounded bg-gray-100 px-2 py-1">claude-hosted</code>
              </dd>
            </div>
          </dl>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Claude Code</h3>
          <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs text-gray-100">
            <code>{`claude mcp add --transport http hs-marketplace ${endpoint} --client-id claude-code`}</code>
          </pre>
        </div>

        <p className="text-xs text-gray-400">
          The endpoint itself ships with the MCP tools release; authorizing now is harmless
          and the connection below will start working the moment it lands.
        </p>
      </section>
    </div>
  )
}
```

- [ ] **Step 9: Add the nav entry and update its test**

In `src/lib/navigation.ts`, append to `ADMIN_NAV` after the `Owners` entry:

```ts
  { label: "MCP", href: "/admin/mcp-connections" },
```

Then in `src/__tests__/navigation.test.ts`, change the admin-sections test (line 64) from:

```ts
  it("returns all eight admin sections regardless of caps", () => {
```

to:

```ts
  it("returns all nine admin sections regardless of caps", () => {
```

and add `"MCP"` to the end of the expected label array, after `"Owners"`:

```ts
    expect(labels).toEqual([
      "Queue",
      "Listings",
      "Inquiries",
      "Brand Requests",
      "Users",
      "Analytics",
      "Data",
      "Owners",
      "MCP",
    ])
```

- [ ] **Step 10: Type-check and run the full suite**

```
npx tsc --noEmit
npm test
```

Expected: no type errors; all tests pass. A failure in `navigation.test.ts` means the label array was not updated to match `ADMIN_NAV`.

- [ ] **Step 11: Verify the page in a browser**

Ask the user to start the dev server. Signed in as an admin, open `/admin/mcp-connections` and confirm:

- The grant created in Task 7 is listed, with its label, `Claude (claude.ai)`, `Read and write`, and a **Last used** of `Never` (nothing has presented the token yet — PR C is what touches it).
- The one you revoked in Task 8 shows **Revoked** with no Revoke button.
- "Show all admins" flips to `?all=1` and back.
- Clicking **Revoke** on a live row opens the confirm dialog; confirming turns the row's status to **Revoked**.
- Both setup snippets show the real endpoint (`http://localhost:3000/api/mcp` locally).
- The **MCP** tab appears in the admin nav and is highlighted on this page.

Then confirm the revocation was audited — PR A's page is `/admin/activity`: a `mcp_token.revoke` row should appear with your account as the actor and the token id as the target.

- [ ] **Step 12: Commit**

```bash
git add src/lib/mcp/oauth/connection-status.ts src/app/admin/mcp-connections src/components/admin/McpConnectionsTable.tsx src/lib/navigation.ts src/__tests__/mcp/connection-status.test.ts src/__tests__/mcp/mcp-connections-action.test.ts src/__tests__/navigation.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): MCP connections page with audited revoke and setup instructions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `scripts/seed-mcp-clients.ts` — the two pre-registered clients

There is no Dynamic Client Registration in v1, so the `mcp_oauth_clients` table is populated by this script and nothing else. The client definitions live in a plain module so they can be unit-tested against the real redirect matcher — a typo in `https://claude.ai/api/mcp/auth_callback` would otherwise only surface as a mystifying error page during a live connection attempt.

`tsx` runs outside Next's bundler, where `server-only` is unresolvable: any transitive `import "server-only"` makes the script crash on startup, and the unit tests cannot catch it because vitest aliases `server-only` to a stub. Step 6 adds the script to the static import-graph gate that does catch it.

**Files:**
- Create: `src/lib/mcp/oauth/seed-clients.ts`
- Create: `scripts/seed-mcp-clients.ts`
- Modify: `src/__tests__/scripts/script-import-graph.test.ts` (add to `SCRIPTS`)
- Modify: `README.md` (Scripts table)
- Test: `src/__tests__/mcp/seed-clients.test.ts`

**Interfaces:**
- Consumes: `redirectUriMatches` (Task 3) in the test; `mcpOauthClients` (Task 2) in the script.
- Produces:
  - `interface McpSeedClient { clientId: string; name: string; redirectUris: string[]; isPublic: boolean }`
  - `const MCP_SEED_CLIENTS: McpSeedClient[]`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/mcp/seed-clients.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { MCP_SEED_CLIENTS } from "@/lib/mcp/oauth/seed-clients"
import { redirectUriMatches } from "@/lib/mcp/oauth/tokens"

const byId = (id: string) => MCP_SEED_CLIENTS.find((c) => c.clientId === id)!

describe("MCP_SEED_CLIENTS", () => {
  it("defines exactly the two pre-registered clients", () => {
    expect(MCP_SEED_CLIENTS.map((c) => c.clientId)).toEqual([
      "claude-hosted",
      "claude-code",
    ])
  })

  it("registers both as public clients (PKCE only, no secret)", () => {
    expect(MCP_SEED_CLIENTS.every((c) => c.isPublic)).toBe(true)
  })

  it("gives every client a display name for the consent screen", () => {
    expect(MCP_SEED_CLIENTS.every((c) => c.name.trim().length > 0)).toBe(true)
  })

  it("registers Claude.ai's exact callback URL", () => {
    // A typo here only surfaces as a mystifying error page mid-connection.
    expect(byId("claude-hosted").redirectUris).toEqual([
      "https://claude.ai/api/mcp/auth_callback",
    ])
  })

  it("accepts the real Claude.ai callback and rejects a lookalike", () => {
    const uris = byId("claude-hosted").redirectUris
    expect(redirectUriMatches(uris, "https://claude.ai/api/mcp/auth_callback")).toBe(true)
    expect(redirectUriMatches(uris, "https://claude.ai.evil.com/api/mcp/auth_callback")).toBe(
      false,
    )
  })

  it("registers both loopback spellings for Claude Code", () => {
    expect(byId("claude-code").redirectUris).toEqual([
      "http://localhost/callback",
      "http://127.0.0.1/callback",
    ])
  })

  it("accepts Claude Code's ephemeral port on either loopback host", () => {
    const uris = byId("claude-code").redirectUris
    expect(redirectUriMatches(uris, "http://localhost:49512/callback")).toBe(true)
    expect(redirectUriMatches(uris, "http://127.0.0.1:49512/callback")).toBe(true)
    expect(redirectUriMatches(uris, "http://localhost:49512/not-the-callback")).toBe(false)
  })

  it("registers no https redirect for Claude Code and no loopback for Claude.ai", () => {
    expect(byId("claude-code").redirectUris.every((u) => u.startsWith("http://"))).toBe(true)
    expect(
      byId("claude-hosted").redirectUris.every((u) => u.startsWith("https://")),
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run src/__tests__/mcp/seed-clients.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/mcp/oauth/seed-clients"`.

- [ ] **Step 3: Write the client definitions**

Create `src/lib/mcp/oauth/seed-clients.ts`:

```ts
/**
 * The pre-registered OAuth clients (spec section 4.1).
 *
 * NOT a `"use server"` module, and deliberately free of any `@/db`,
 * `@/lib/env` or `server-only` import: scripts/seed-mcp-clients.ts runs under
 * `tsx`, outside Next's bundler, where `server-only` is unresolvable and would
 * crash the script on startup.
 *
 * There is no Dynamic Client Registration in v1, so this list IS the client
 * registry. Adding an entry means running the seed script again.
 */
export interface McpSeedClient {
  clientId: string
  name: string
  redirectUris: string[]
  isPublic: boolean
}

export const MCP_SEED_CLIENTS: McpSeedClient[] = [
  {
    clientId: "claude-hosted",
    name: "Claude (claude.ai)",
    // Claude.ai's fixed callback. Exact match — no loopback exemption applies.
    redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    isPublic: true,
  },
  {
    clientId: "claude-code",
    name: "Claude Code",
    // Both loopback spellings. The PORT IS IGNORED when matching these
    // (RFC 8252 section 7.3) because Claude Code binds an ephemeral port it
    // cannot register ahead of time — see redirectUriMatches.
    redirectUris: ["http://localhost/callback", "http://127.0.0.1/callback"],
    isPublic: true,
  },
]
```

- [ ] **Step 4: Run the test to verify it passes**

```
npx vitest run src/__tests__/mcp/seed-clients.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Write the seed script**

Create `scripts/seed-mcp-clients.ts`:

```ts
/**
 * Seed the pre-registered OAuth clients for the admin MCP server.
 *
 * Run:  npx tsx --env-file=.env.local scripts/seed-mcp-clients.ts
 *
 * Requires DATABASE_URL in .env.local, and migration 0012 applied first —
 * without the table this fails with a Postgres "relation does not exist".
 *
 * Safe to re-run: every write is an upsert keyed on client_id, so an
 * interrupted run can simply be run again, and editing MCP_SEED_CLIENTS then
 * re-running is how a redirect URI is changed. Existing grants are untouched —
 * the tokens table references client_id, which never changes here.
 *
 * Imports only `../src/db` and the DB-free definitions module: a standalone
 * tsx script crashes on any transitive `import "server-only"`, which
 * src/__tests__/scripts/script-import-graph.test.ts checks statically.
 */
import { db } from "../src/db"
import { mcpOauthClients } from "../src/db/schema/mcpOauth"
import { MCP_SEED_CLIENTS } from "../src/lib/mcp/oauth/seed-clients"

async function main() {
  for (const client of MCP_SEED_CLIENTS) {
    await db
      .insert(mcpOauthClients)
      .values({
        clientId: client.clientId,
        name: client.name,
        redirectUris: client.redirectUris,
        isPublic: client.isPublic,
      })
      .onConflictDoUpdate({
        target: mcpOauthClients.clientId,
        set: {
          name: client.name,
          redirectUris: client.redirectUris,
          isPublic: client.isPublic,
        },
      })
    console.log(`seeded ${client.clientId} -> ${client.redirectUris.join(", ")}`)
  }
  console.log(`done: ${MCP_SEED_CLIENTS.length} clients`)
  process.exit(0)
}

main().catch((err) => {
  console.error("seed-mcp-clients failed:", err)
  process.exit(1)
})
```

- [ ] **Step 6: Add the script to the import-graph gate**

In `src/__tests__/scripts/script-import-graph.test.ts`, change the `SCRIPTS` array from:

```ts
const SCRIPTS = ["scripts/backfill-user-owner-links.ts"]
```

to:

```ts
const SCRIPTS = [
  "scripts/backfill-user-owner-links.ts",
  "scripts/seed-mcp-clients.ts",
]
```

- [ ] **Step 7: Run the gate and the script**

```
npx vitest run src/__tests__/scripts/script-import-graph.test.ts
```

Expected: PASS — both scripts report zero `server-only` offenders. A failure here names the offending module: move whatever constant the script needed into a `server-only`-free file rather than deleting the guard.

Then seed for real (this replaces the throwaway row from Task 6 Step 8, dropping the dev-only `/dev-callback` URI):

```
npx tsx --env-file=.env.local scripts/seed-mcp-clients.ts
```

Expected output:

```
seeded claude-hosted -> https://claude.ai/api/mcp/auth_callback
seeded claude-code -> http://localhost/callback, http://127.0.0.1/callback
done: 2 clients
```

Run it a second time and confirm identical output and no error — the upsert is what makes it re-runnable.

- [ ] **Step 8: Document the script**

In `README.md`, add a row to the Scripts table after the `npm run db:studio` row:

```
| `npx tsx --env-file=.env.local scripts/seed-mcp-clients.ts` | Seed the pre-registered MCP OAuth clients (re-runnable upsert) |
```

- [ ] **Step 9: Type-check and run the full suite**

```
npx tsc --noEmit
npm test
```

Expected: no type errors; all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/mcp/oauth/seed-clients.ts scripts/seed-mcp-clients.ts src/__tests__/mcp/seed-clients.test.ts src/__tests__/scripts/script-import-graph.test.ts README.md
git commit -m "$(cat <<'EOF'
feat(mcp): seed script for the pre-registered OAuth clients

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Full gates, prod prerequisites, and the PR

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-admin-mcp-server-design.md` (§9 rollout note)

- [ ] **Step 1: Run every gate**

```
npx tsc --noEmit
npx eslint .
npm test
```

Expected: no type errors, no lint errors, all tests pass. These are the three gates spec §8 names per PR.

If `eslint` flags an unused import in a route file, delete the import rather than disabling the rule — lint is enforced in CI here.

Do **not** run `next build` while a dev server is running (Windows `.next` lock). If you want a build check, ask the user to stop the dev server first.

- [ ] **Step 2: Confirm the prod prerequisites are in place**

Spec §9: "Prod env gains `MCP_CONFIRM_SECRET` and `MCP_ISSUER_URL` before PR B deploys." `MCP_CONFIRM_SECRET` is a **required** var, so a deploy without it fails `next build` outright — this is a merge blocker, not a follow-up.

Ask the user to confirm:

1. `MCP_CONFIRM_SECRET` is set in the Vercel project for **Production and Preview**.
2. `MCP_ISSUER_URL` is left unset (the app's canonical URL is the issuer) — or set deliberately if the MCP issuer is meant to differ.
3. Migration `0012` has been applied to production with `npm run db:migrate` against `DATABASE_URL_DIRECT`, and `scripts/seed-mcp-clients.ts` has been run against production.

Migrations are not applied automatically on deploy in this repo, so (3) must happen before the deploy, not after.

- [ ] **Step 3: Record the resolved ambiguities in the spec**

In `docs/superpowers/specs/2026-09-14-admin-mcp-server-design.md`, append to the end of section 9:

```
**PR B implementation notes (2026-09-14).** Four points the design left open,
resolved during planning:

- **PR B is cut from `origin/main` after PR A merges**, not in parallel: it
  imports `withAudit`/`uiActor` from PR A and its migration number assumes
  `0011` is already journalled.
- **`/login` now honours `?callbackUrl`** (relative paths only, via
  `safeCallbackUrl`). It previously ignored the parameter and always landed on
  `/browse`, which would have stranded every authorization mid-flow.
- **A non-admin at `/mcp/authorize` sees the access-denied copy rendered in
  place**, rather than being redirected to `/access-denied`, so the OAuth
  request stays on screen and survives a re-sign-in.
- **`revokeMcpToken` takes an `ownOnly` flag.** The admin UI passes `false` (an
  admin may revoke any admin's connection, per the "All admins" toggle); PR C's
  `revoke_mcp_connection` tool passes `true`, per section 7.4.
- **`/mcp/token` throttling returns `429` with `error: "invalid_request"`.**
  RFC 6749 section 5.2 defines no code for throttling; the detail is in
  `Retry-After`.
```

- [ ] **Step 4: Commit the spec note**

```bash
git add docs/superpowers/specs/2026-09-14-admin-mcp-server-design.md
git commit -m "$(cat <<'EOF'
docs(spec): record PR B implementation decisions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Push**

```bash
git push -u origin feature/admin-mcp-server-oauth
```

If the push 403s, switch accounts — only `sugarparker` can push to this repo:

```bash
gh auth switch
```

- [ ] **Step 6: Open the PR against `origin/main`**

```bash
gh pr create --base main --title "feat(mcp): OAuth 2.1 authorization server for the admin MCP endpoint" --body "$(cat <<'EOF'
PR B of three from `docs/superpowers/specs/2026-09-14-admin-mcp-server-design.md`
(sections 4.1-4.5). Stands up a hand-rolled OAuth 2.1 authorization server so
PR C's `POST /api/mcp` has something to authenticate against. **No MCP endpoint
or tools yet** — nothing in this PR changes existing behaviour for anyone who
does not visit `/mcp/authorize`.

### What ships

- **Migration `0012`** — `mcp_oauth_clients`, `mcp_oauth_codes`,
  `mcp_oauth_tokens`. Codes and both token halves are stored as SHA-256 hex
  only; a database read never yields a usable credential.
- **Discovery** — `/.well-known/oauth-authorization-server` (RFC 8414) and
  `/.well-known/oauth-protected-resource`, plus the path-suffixed
  `/.well-known/oauth-protected-resource/api/mcp` that Claude probes first. All
  GET + OPTIONS with open CORS. No `registration_endpoint` (no DCR in v1).
- **`/mcp/authorize`** — admin consent screen: read-only vs read-and-write, an
  optional 60-char label, Approve/Deny. Validation order is the security
  property: an unverified `client_id` or `redirect_uri` gets an error PAGE,
  never a redirect.
- **`/mcp/token`** — `authorization_code` with mandatory PKCE S256 and
  `resource` checking, and `refresh_token` with rotation of BOTH hashes plus a
  live `users.role` re-check. Form-encoded only (JSON -> 415), RFC 6749 error
  JSON, `Cache-Control: no-store`, 20 req/min/IP (best-effort, DEBT-028).
- **`/mcp/revoke`** — RFC 7009, always 200 for an unknown token.
- **`verifyMcpToken`** — the bearer gate PR C imports. Re-reads `users.role`
  every call, so **demoting an admin kills MCP access on their next request**,
  not thirty days later. Touches `last_used_at` at most once per 60 s.
- **`/admin/mcp-connections`** — grants table (label, client, access, status,
  created, last used) with Revoke, an "All admins" toggle, and copy-paste setup
  for Claude.ai and Claude Code. Revoke is wrapped in PR A's `withAudit`, so it
  appears on `/admin/activity`.
- **`scripts/seed-mcp-clients.ts`** — the two pre-registered clients
  (`claude-hosted`, `claude-code`). Re-runnable upsert; no DCR.

### Deploy prerequisites (blocking)

1. `MCP_CONFIRM_SECRET` (>= 32 chars) must be set in Vercel for Production and
   Preview **before merge** — it is a required env var, so a deploy without it
   fails `next build`. It is unused in this PR; PR C's confirmation tokens need
   it, and the spec puts it here so prod carries it first.
2. Apply migration `0012` (`npm run db:migrate`) and run
   `scripts/seed-mcp-clients.ts` against production before the deploy —
   migrations are not automatic in this repo.

### Notes

- `/login` now honours `?callbackUrl`, restricted to same-origin relative paths
  by `safeCallbackUrl`. It previously ignored the parameter, which would have
  stranded every authorization mid-flow.
- `/.well-known/*` and the three `/mcp/*` routes are added to `PUBLIC_PATHS`;
  each authenticates itself (session, PKCE code, bearer token). The bare `/mcp`
  segment stays gated.
- Code exchange marks the code used and inserts the token row in one `db.batch`
  — neon-http has no transactions, and a half-applied exchange would leave a
  replayable code.
- No component tests: vitest runs in a node env with a `.ts`-only glob, so
  status derivation and the revoke action are unit-tested in plain modules and
  the page/table were checked in a browser.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage** — every requirement in sections 4.1-4.5, the OAuth slice of 8, and the PR B row of 9 maps to a task:

| Spec requirement | Task |
| --- | --- |
| 4.1 `mcp_oauth_clients` / `_codes` / `_tokens`, hashes at rest, indexes, migration 0012 | 2 |
| 4.1 refresh rotates both hashes in place | 7 |
| 4.2 `/.well-known/oauth-authorization-server` (exact key set, no DCR/CIMD) | 4 |
| 4.2 `/.well-known/oauth-protected-resource` + path-suffixed variant, GET + OPTIONS, CORS | 4 |
| 4.2 `/mcp/authorize` validation order, error page vs error redirect | 5 (logic), 6 (page) |
| 4.2 `/mcp/authorize` login redirect | 5 (`safeCallbackUrl` + `/login`), 6 (the redirect) |
| 4.2 `/mcp/authorize` non-admin denial | 6 |
| 4.2 consent form: client name, read/read-write radio, optional label, Approve/Deny | 6 |
| 4.2 `approveMcpConsent` mints the code, redirects with `code`/`state`/`iss` | 6 |
| 4.2 `/mcp/token`: form-encoded only -> 415, both grants, RFC 6749 errors, `no-store` | 7 |
| 4.2 `/mcp/revoke`, always 200 | 8 |
| 4.3 `verifyMcpToken`, live admin re-check, 60 s `last_used_at` touch, `WWW-Authenticate` | 9 |
| 4.4 `/admin/mcp-connections` table, Revoke, "All admins" toggle, setup copy, nav entry | 11 |
| 4.5 `MCP_ISSUER_URL`, `MCP_CONFIRM_SECRET`, issuer defaulting | 1 |
| 8 OAuth primitives tests (PKCE, hashing, redirect matching incl. loopback) | 3 |
| 8 OAuth route tests (mocked DB, happy path + every rejection, 415, metadata shapes) | 4, 6, 7, 8, 9 |
| 8 per-PR gates `tsc` / `eslint` / `npm test` | every task; final gate in 13 |
| 9 PR B scope, migration 0012, seed script, env vars in prod first | 2, 12, 13 |
| 7.5 confirmation tokens, 7.x tools, MCP endpoint | **not in this PR** — PR C, correctly absent |

**Type consistency** — the PR C contract is declared once and used unchanged: `McpActor`, `verifyMcpToken`, `MCP_SCOPES`, `McpScope` (Task 9); `issuerUrl`, `mcpResourceUrl`, `protectedResourceMetadataUrl` (Task 1); `generateOpaqueToken`, `sha256Hex`, `verifyPkceS256`, `redirectUriMatches` (Task 3); `listMcpConnections`, `revokeMcpToken`, `McpConnectionRow` (Task 10). `MCP_SCOPES`/`McpScope` are defined in `oauth/scopes.ts` and **re-exported** from `auth/verify-token.ts`, so the contract's import path holds while the definitions stay DB-free for the pure tests and the `tsx` script. `mcpOauthClients`/`mcpOauthCodes`/`mcpOauthTokens` and their camelCase fields (Task 2) are used verbatim in Tasks 6-11.

**Ordering constraints** — Task 2 applies the migration (Steps 5-6) before declaring the schema (Step 7); reversing it breaks any path that selects every declared column. Tasks 6, 7, 8, 9, 10 all depend on Tasks 2 and 3. Task 6's browser walkthrough produces the `code` that Task 7 Step 6 exchanges, and Task 7 produces the tokens Tasks 8 and 11 use. Task 11 depends on Task 10 **and on PR A** (`withAudit`, `uiActor`) — Step 0 is a hard gate. Task 12 can run any time after Task 2 but is placed last so the throwaway dev client from Task 6 is replaced by the real seed. Tasks 1, 3, 4 and 5 are independent of each other.

**Known deviation from the spec, recorded in Task 13 Step 3:** `/login` gains `callbackUrl` support, which the spec assumes but does not call out; a non-admin sees the denial rendered in place rather than a redirect to `/access-denied`; `revokeMcpToken` carries an `ownOnly` flag so one function serves both the UI (false) and PR C's tool (true); and the token endpoint's 429 reuses `invalid_request` because RFC 6749 section 5.2 defines no throttling code.
