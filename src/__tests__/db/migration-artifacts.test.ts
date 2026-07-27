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
})
