import "server-only"
import { BigQuery } from "@google-cloud/bigquery"

let cached: BigQuery | null | undefined

/**
 * Lazily build a BigQuery client.
 * Prefers BIGQUERY_CREDENTIALS (JSON string, for Vercel); falls back to
 * GOOGLE_APPLICATION_CREDENTIALS (file path, local dev) which the SDK reads
 * automatically. Returns null when no project / creds are configured so callers
 * can degrade to "not connected".
 */
export function getBigQueryClient(): BigQuery | null {
  if (cached !== undefined) return cached

  const projectId = process.env.BIGQUERY_PROJECT_ID
  if (!projectId) {
    cached = null
    return cached
  }

  const inlineJson = process.env.BIGQUERY_CREDENTIALS
  if (inlineJson) {
    try {
      cached = new BigQuery({ projectId, credentials: JSON.parse(inlineJson) })
    } catch (err) {
      console.warn("[bigquery] BIGQUERY_CREDENTIALS is not valid JSON:", err)
      cached = null
    }
    return cached
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    cached = new BigQuery({ projectId }) // SDK reads the key file from the env path
    return cached
  }

  cached = null
  return cached
}

/** Run a SQL string and return typed rows, or null on missing creds / any error. */
export async function runQuery<T>(sql: string): Promise<T[] | null> {
  const client = getBigQueryClient()
  if (!client) return null
  try {
    const [rows] = await client.query({ query: sql })
    return rows as T[]
  } catch (err) {
    console.warn("[bigquery] query failed:", err)
    return null
  }
}
