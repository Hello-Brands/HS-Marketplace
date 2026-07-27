/**
 * A thenable stand-in for a Drizzle query builder: every chained method
 * returns the same object, and awaiting it resolves to `result`. Lets a test
 * stub `db.select()` without modelling the builder's real types.
 *
 * Add to CHAINED_METHODS when a test needs a builder method not listed here.
 */
const CHAINED_METHODS = [
  "from",
  "where",
  "orderBy",
  "leftJoin",
  "limit",
  "values",
  "set",
  "onConflictDoUpdate",
] as const

export function builder(result: unknown) {
  const b: Record<string, unknown> = {}
  for (const method of CHAINED_METHODS) b[method] = () => b
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return b
}
