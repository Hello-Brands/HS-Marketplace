/**
 * A thenable stand-in for a Drizzle query builder: every chained method
 * returns the same object, and awaiting it resolves to `result`. Lets a test
 * stub `db.select()` without modelling the builder's real types.
 *
 * Each chained method also records the arguments it was called with, keyed
 * by method name, in `.calls` — e.g. `b.calls.values` is an array of argument
 * lists, one per call to `.values(...)`. This lets a test assert on the exact
 * payload a write method received (a wrong field name, a missing `source`,
 * etc.) rather than only on call counts.
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
  "onConflictDoNothing",
] as const

export type ChainedBuilder = Record<string, unknown> & {
  calls: Record<string, unknown[][]>
}

export function builder(result: unknown): ChainedBuilder {
  const calls: Record<string, unknown[][]> = {}
  const b = { calls } as ChainedBuilder
  for (const method of CHAINED_METHODS) {
    b[method] = (...args: unknown[]) => {
      (calls[method] ??= []).push(args)
      return b
    }
  }
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return b
}
