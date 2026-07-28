import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

/**
 * Standalone `tsx` scripts run OUTSIDE Next's bundler, where `server-only` is
 * not resolvable — importing it anywhere in a script's graph makes the script
 * crash on startup with MODULE_NOT_FOUND.
 *
 * The unit tests cannot catch this: vitest aliases `server-only` to a stub
 * (test/stubs/server-only.ts), so a server-only module imports fine under test
 * and fails only when the script is actually run. That is exactly how
 * backfill-user-owner-links.ts shipped unrunnable — it reached the BigQuery
 * -backed query.ts through backfill.ts just to read the UNKNOWN_OWNER string.
 *
 * So walk each script's first-party import graph statically and assert the
 * whole thing is server-only-free.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..")

/** Scripts that must stay runnable via `npx tsx`. */
const SCRIPTS = ["scripts/backfill-user-owner-links.ts"]

const IMPORT_RE = /(?:from|import)\s+["']([^"']+)["']/g
const SERVER_ONLY_RE = /import\s+["']server-only["']/

/**
 * Drop comments before matching, so prose ABOUT an import never reads as one —
 * constants.ts documents why it avoids `import "server-only"` and must not be
 * flagged for saying so.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith("//") && !trimmed.startsWith("*")
    })
    .join("\n")
}

function code(file: string): string {
  return stripComments(readFileSync(file, "utf8"))
}

/** Resolve a first-party specifier to a file on disk, or null if it isn't one. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(ROOT, "src", specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : null // bare specifier: node_modules, not ours to walk
  if (!base) return null

  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Every first-party file reachable from `entry`, including `entry` itself. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)

    for (const match of code(file).matchAll(IMPORT_RE)) {
      const resolved = resolveLocal(match[1], file)
      if (resolved && !seen.has(resolved)) queue.push(resolved)
    }
  }

  return [...seen]
}

describe("standalone script import graphs", () => {
  it.each(SCRIPTS)("%s imports no server-only module", (script) => {
    const entry = path.join(ROOT, script)
    expect(existsSync(entry), `${script} exists`).toBe(true)

    const offenders = importGraph(entry).filter((file) => SERVER_ONLY_RE.test(code(file)))

    expect(offenders.map((f) => path.relative(ROOT, f).replace(/\\/g, "/"))).toEqual([])
  })

  it("detects a server-only import when one is present (the check really works)", () => {
    // Guard against the walker silently resolving nothing and passing vacuously.
    const serverOnlyModule = path.join(ROOT, "src/lib/owner-directory/query.ts")
    expect(existsSync(serverOnlyModule)).toBe(true)
    expect(SERVER_ONLY_RE.test(code(serverOnlyModule))).toBe(true)

    const graph = importGraph(path.join(ROOT, SCRIPTS[0]))
    // The walker must actually be following imports, not returning just the entry.
    expect(graph.length).toBeGreaterThan(1)
    expect(graph).toContain(path.join(ROOT, "src/lib/owner-directory/backfill.ts"))
  })
})
