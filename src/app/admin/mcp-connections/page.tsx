import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listMcpConnections } from "@/lib/mcp/oauth/grants"
import { mcpResourceUrl } from "@/lib/mcp/oauth/urls"
import { McpConnectionsTable } from "@/components/admin/McpConnectionsTable"

/**
 * Spec section 4.4. Shows the caller's own grants by default with an
 * "All admins" toggle, plus the copy-paste setup instructions for both
 * pre-registered clients.
 */
export const metadata = { title: "MCP connections - Admin" }

// Grants change out of band (a client may authorize at any moment); never cache.
export const dynamic = "force-dynamic"

interface McpConnectionsPageProps {
  searchParams: Promise<{ all?: string }>
}

export default async function AdminMcpConnectionsPage({
  searchParams,
}: McpConnectionsPageProps) {
  // The admin role is enforced by src/app/admin/layout.tsx; this page reads the
  // session only for the caller's own id, which scopes the default listing.
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login")
  }

  const { all } = await searchParams
  const showAll = all === "1"

  const connections = await listMcpConnections({
    userId: session.user.id,
    all: showAll,
  })

  const endpoint = mcpResourceUrl()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-gray-900">MCP connections</h1>
        <Link
          href={showAll ? "/admin/mcp-connections" : "/admin/mcp-connections?all=1"}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {showAll ? "Show only mine" : "Show all admins"}
        </Link>
      </div>

      <McpConnectionsTable connections={connections} showAll={showAll} />

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="font-semibold text-gray-900">Connect a client</h2>
        <p className="text-sm text-gray-500">
          Both clients are pre-registered — there is no client secret, and sign-in happens
          in your browser with your own admin account. You choose read-only or read-and-write
          on the consent screen.
        </p>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Claude.ai (custom connector)</h3>
          <dl className="space-y-1 text-sm text-gray-600">
            <div className="flex flex-wrap gap-2">
              <dt className="font-medium text-gray-700">Server URL</dt>
              <dd>
                <code className="rounded bg-gray-100 px-2 py-1">{endpoint}</code>
              </dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="font-medium text-gray-700">Client ID</dt>
              <dd>
                <code className="rounded bg-gray-100 px-2 py-1">claude-hosted</code>
              </dd>
            </div>
          </dl>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Claude Code</h3>
          <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs text-gray-100">
            <code>{`claude mcp add --transport http hs-marketplace ${endpoint} --client-id claude-code`}</code>
          </pre>
        </div>

        <p className="text-xs text-gray-400">
          The endpoint itself ships with the MCP tools release; authorizing now is harmless
          and the connection below will start working the moment it lands.
        </p>
      </section>
    </div>
  )
}
