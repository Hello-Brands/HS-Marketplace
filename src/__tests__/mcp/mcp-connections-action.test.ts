import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Tests the REAL `revokeMcpConnection` server action: its admin guard, the
 * actor it builds from the session, and that it delegates with ownOnly=false —
 * the admin UI may revoke any admin's connection, unlike PR C's MCP tool.
 *
 * `@/lib/admin/audit` is deliberately NOT mocked: `revokeMcpToken` already
 * wraps itself in `withAudit` and returns the audit id, so the action must not
 * import the audit writer at all. A double wrap would write two rows per
 * revocation into the activity feed.
 */

const { requireAdmin, revokeMcpToken, revalidatePath } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  revokeMcpToken: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/auth-guards", () => ({ requireAdmin }))
vi.mock("@/lib/mcp/oauth/grants", () => ({ revokeMcpToken }))
vi.mock("next/cache", () => ({ revalidatePath }))

import { revokeMcpConnection } from "@/app/admin/mcp-connections/actions"

beforeEach(() => {
  vi.clearAllMocks()
  requireAdmin.mockResolvedValue({ id: "admin-1", role: "admin" })
  revokeMcpToken.mockResolvedValue({ ok: true, auditId: "audit-1" })
})

describe("revokeMcpConnection", () => {
  it("revokes through the grants module as the session's admin", async () => {
    await revokeMcpConnection("tok-1")
    expect(revokeMcpToken).toHaveBeenCalledWith(
      // Never a caller-supplied id: the actor comes from the session.
      { userId: "admin-1", source: "ui" },
      {
        tokenId: "tok-1",
        // The admin UI may revoke ANY admin's connection; PR C's tool passes true.
        ownOnly: false,
      },
    )
  })

  it("returns the grant module's result, audit id included", async () => {
    expect(await revokeMcpConnection("tok-1")).toEqual({ ok: true, auditId: "audit-1" })
  })

  it("awaits the admin guard before touching the grants module", async () => {
    let admit: (user: unknown) => void = () => {}
    requireAdmin.mockReturnValue(
      new Promise((resolve) => {
        admit = resolve
      }),
    )

    const pending = revokeMcpConnection("tok-1")
    await Promise.resolve()
    expect(revokeMcpToken).not.toHaveBeenCalled()

    admit({ id: "admin-1", role: "admin" })
    await pending
    expect(revokeMcpToken).toHaveBeenCalledTimes(1)
  })

  it("refuses a non-admin caller before touching anything", async () => {
    requireAdmin.mockRejectedValue(new Error("Unauthorized: Admin access required"))
    await expect(revokeMcpConnection("tok-1")).rejects.toThrow("Unauthorized")
    expect(revokeMcpToken).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("passes a failure back to the caller instead of throwing", async () => {
    revokeMcpToken.mockResolvedValue({
      ok: false,
      error: "Connection not found",
      auditId: "audit-2",
    })
    expect(await revokeMcpConnection("ghost")).toEqual({
      ok: false,
      error: "Connection not found",
      auditId: "audit-2",
    })
  })

  it("revalidates the page so the table reflects the new status", async () => {
    await revokeMcpConnection("tok-1")
    expect(revalidatePath).toHaveBeenCalledWith("/admin/mcp-connections")
  })
})
