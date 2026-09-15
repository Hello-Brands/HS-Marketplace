import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { issuerUrl } from "@/lib/mcp/oauth/urls"
import { CONSENT_LABEL_MAX_LENGTH } from "@/lib/mcp/oauth/constants"
import { loadAndValidateAuthorizeRequest } from "@/lib/mcp/oauth/authorize-request"
import { buildAuthorizeErrorRedirect } from "@/lib/mcp/oauth/authorize-validation"
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
 * The lookup-and-validate step is shared with `approveMcpConsent` via
 * `loadAndValidateAuthorizeRequest`: the consent form is not a trust boundary,
 * so the action redoes exactly this, and two copies would drift.
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-12">
      <div className="w-full max-w-md space-y-6">{children}</div>
    </main>
  )
}

export default async function McpAuthorizePage({ searchParams }: McpAuthorizePageProps) {
  const raw = await searchParams

  const validation = await loadAndValidateAuthorizeRequest(raw)

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
        {/* Plain <img>, as on /login and /access-denied: a small static PNG
            that does not need next/image's optimizer round trip. */}
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
              // Least privilege: "Read only" is preselected whenever both
              // options are offered, and it is the only option (so it stays
              // selected) when the client didn't request write access.
              defaultChecked
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
