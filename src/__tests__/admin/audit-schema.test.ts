import { describe, it, expect } from "vitest"
import { getTableColumns, getTableName } from "drizzle-orm"
import { adminAuditLog, AUDIT_TARGET_TYPES } from "@/db/schema/adminAuditLog"

describe("admin_audit_log schema", () => {
  it("is named admin_audit_log with the spec'd columns", () => {
    expect(getTableName(adminAuditLog)).toBe("admin_audit_log")
    expect(Object.keys(getTableColumns(adminAuditLog)).sort()).toEqual(
      [
        "action",
        "actorUserId",
        "args",
        "createdAt",
        "durationMs",
        "error",
        "id",
        "mcpClientId",
        "mcpTokenId",
        "outcome",
        "source",
        "targetId",
        "targetType",
      ].sort(),
    )
  })

  it("exports the target types the core modules will use", () => {
    expect(AUDIT_TARGET_TYPES).toEqual([
      "listing",
      "user",
      "allowlist",
      "brand_request",
      "owner_link",
      "listing_location",
      "owner_directory",
      "mcp_token",
    ])
  })
})
