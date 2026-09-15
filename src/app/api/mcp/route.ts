import { preloadSchemas } from "@modelcontextprotocol/server"
import {
  bearerChallenge,
  insufficientScopeChallenge,
  verifyMcpToken,
  type McpScope,
} from "@/lib/mcp/auth/verify-token"
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
      "www-authenticate": bearerChallenge(),
    },
  })
}

function insufficientScope(required: McpScope): Response {
  return new Response(JSON.stringify({ error: "insufficient_scope", scope: required }), {
    status: 403,
    headers: {
      ...NO_STORE,
      "content-type": "application/json",
      "www-authenticate": insufficientScopeChallenge(required),
    },
  })
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
  // McpServer whose tool set is already filtered to this token's scopes. Building it
  // per request is what keeps the actor out of module scope, where a warm instance
  // would serve every later caller as whoever hit it first.
  const handler = createMcpRequestHandler(actor)
  try {
    return await handler.fetch(request, { parsedBody })
  } finally {
    // `responseMode: "json"` never streams a request exchange, so the response body is
    // complete by the time fetch resolves and close() only drops the spent instance.
    await handler.close()
  }
}

export async function GET(): Promise<Response> {
  // Stateless Streamable HTTP: there is no session to resume over a GET SSE stream.
  return methodNotAllowed()
}

export async function DELETE(): Promise<Response> {
  // Stateless Streamable HTTP: there is no session to terminate.
  return methodNotAllowed()
}
