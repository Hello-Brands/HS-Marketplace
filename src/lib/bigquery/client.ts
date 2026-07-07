import "server-only"
import { BigQuery } from "@google-cloud/bigquery"
import { env } from "@/lib/env"

let cached: BigQuery | null | undefined

/**
 * Lazily build a BigQuery client.
 * Prefers an inline service-account JSON string (GCP_SERVICE_ACCOUNT_JSON, or
 * the older BIGQUERY_CREDENTIALS) — required on Vercel/serverless where there is
 * no key file. Falls back to GOOGLE_APPLICATION_CREDENTIALS (file path, local
 * dev) which the SDK reads automatically. Returns null when no project / creds
 * are configured so callers can degrade to "not connected".
 */
export function getBigQueryClient(): BigQuery | null {
  if (cached !== undefined) return cached

  const projectId = env.BIGQUERY_PROJECT_ID
  if (!projectId) {
    cached = null
    return cached
  }

  // Inline JSON credential (parsed from env, never a file path — serverless safe).
  const inlineJson =
    env.GCP_SERVICE_ACCOUNT_JSON || env.BIGQUERY_CREDENTIALS
  if (inlineJson) {
    try {
      cached = new BigQuery({ projectId, credentials: JSON.parse(inlineJson) })
    } catch (err) {
      console.warn(
        "[bigquery] GCP_SERVICE_ACCOUNT_JSON/BIGQUERY_CREDENTIALS is not valid JSON:",
        err
      )
      cached = null
    }
    return cached
  }

  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
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
