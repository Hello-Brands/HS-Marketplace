import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import journal from "../../../drizzle/meta/_journal.json"

const DRIZZLE = path.resolve(import.meta.dirname, "../../../drizzle")

describe("hand-authored migration artifacts", () => {
  it("has a .sql file for every journal entry", () => {
    for (const entry of journal.entries) {
      expect(existsSync(path.join(DRIZZLE, `${entry.tag}.sql`)), `${entry.tag}.sql`).toBe(true)
    }
  })

  it("has strictly increasing idx and when (the migrator keys off when)", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      expect(journal.entries[i].idx).toBe(journal.entries[i - 1].idx + 1)
      expect(journal.entries[i].when).toBeGreaterThan(journal.entries[i - 1].when)
    }
  })

  it("chains snapshot prevId to the previous snapshot id", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      const prev = JSON.parse(
        readFileSync(path.join(DRIZZLE, "meta", `${String(i - 1).padStart(4, "0")}_snapshot.json`), "utf8")
      )
      const cur = JSON.parse(
        readFileSync(path.join(DRIZZLE, "meta", `${String(i).padStart(4, "0")}_snapshot.json`), "utf8")
      )
      expect(cur.prevId).toBe(prev.id)
      expect(cur.id).not.toBe(prev.id)
    }
  })

  it("records user_owner_links in the latest snapshot", () => {
    const latest = journal.entries.length - 1
    const snap = JSON.parse(
      readFileSync(path.join(DRIZZLE, "meta", `${String(latest).padStart(4, "0")}_snapshot.json`), "utf8")
    )
    const table = snap.tables["public.user_owner_links"]
    expect(table).toBeDefined()
    expect(Object.keys(table.columns).sort()).toEqual([
      "actor_user_id", "created_at", "id", "owner_identifier", "source", "updated_at", "user_id",
    ])
    expect(table.indexes["user_owner_links_user_owner_idx"].isUnique).toBe(true)
  })

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
})
