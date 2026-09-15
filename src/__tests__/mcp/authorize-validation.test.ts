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
