import { describe, it, expect } from "vitest"
import {
  mcpConnectionStatus,
  MCP_CONNECTION_STATUS_LABELS,
} from "@/lib/mcp/oauth/connection-status"

const NOW = new Date("2026-09-14T12:00:00.000Z")
const at = (iso: string) => new Date(iso)

const row = (
  overrides: Partial<{ expiresAt: Date; refreshExpiresAt: Date; revokedAt: Date | null }> = {},
) => ({
  expiresAt: at("2026-09-14T13:00:00.000Z"),
  refreshExpiresAt: at("2026-10-14T12:00:00.000Z"),
  revokedAt: null as Date | null,
  ...overrides,
})

describe("mcpConnectionStatus", () => {
  it("is active while the access token is still valid", () => {
    expect(mcpConnectionStatus(row(), NOW)).toBe("active")
  })

  it("is idle when the access token lapsed but the refresh token has not", () => {
    // Normal for a connection nobody has used in over an hour: the client
    // refreshes on its next call, so this is not a problem state.
    expect(mcpConnectionStatus(row({ expiresAt: at("2026-09-14T11:00:00.000Z") }), NOW)).toBe(
      "idle",
    )
  })

  it("is expired once the refresh token lapses", () => {
    expect(
      mcpConnectionStatus(
        row({
          expiresAt: at("2026-08-14T12:00:00.000Z"),
          refreshExpiresAt: at("2026-09-13T12:00:00.000Z"),
        }),
        NOW,
      ),
    ).toBe("expired")
  })

  it("reports revoked even when the tokens would otherwise be live", () => {
    // Revocation wins: it is the state the admin acted to create.
    expect(mcpConnectionStatus(row({ revokedAt: at("2026-09-14T11:30:00.000Z") }), NOW)).toBe(
      "revoked",
    )
  })

  it("reports revoked even when the refresh token has also expired", () => {
    expect(
      mcpConnectionStatus(
        row({
          expiresAt: at("2026-08-14T12:00:00.000Z"),
          refreshExpiresAt: at("2026-09-13T12:00:00.000Z"),
          revokedAt: at("2026-09-01T12:00:00.000Z"),
        }),
        NOW,
      ),
    ).toBe("revoked")
  })

  it("treats an expiry exactly at now as lapsed", () => {
    expect(mcpConnectionStatus(row({ expiresAt: NOW }), NOW)).toBe("idle")
  })

  it("defaults to the current clock when no `now` is given", () => {
    expect(
      mcpConnectionStatus(
        row({
          expiresAt: new Date(Date.now() + 60_000),
          refreshExpiresAt: new Date(Date.now() + 3_600_000),
        }),
      ),
    ).toBe("active")
    expect(
      mcpConnectionStatus(
        row({
          expiresAt: new Date(Date.now() - 3_600_000),
          refreshExpiresAt: new Date(Date.now() - 60_000),
        }),
      ),
    ).toBe("expired")
  })

  it("has a human label for every status", () => {
    expect(MCP_CONNECTION_STATUS_LABELS).toEqual({
      active: "Active",
      idle: "Idle",
      expired: "Expired",
      revoked: "Revoked",
    })
  })
})
