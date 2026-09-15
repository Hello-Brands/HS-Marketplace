// Competitor-brand request pipeline: reads plus the three admin decisions.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import {
  APPROVED_STATUSES,
  approveBrandRequest,
  rejectBrandRequest,
  retryMonitorDispatch,
} from "@/lib/admin/core/brand-requests"
import { BRAND_REQUEST_STATUSES } from "@/db/schema/brandRequests"
import { listBrandRequests, getBrandRequestDetail } from "@/lib/mcp/queries/brand-requests"
import { requireConfirmation } from "@/lib/mcp/confirm"
import {
  DEFAULT_LIMIT,
  DESTRUCTIVE_ANNOTATIONS,
  READ_ANNOTATIONS,
  REQUIRES_USER_INTERACTION,
  WRITE_ANNOTATIONS,
  confirmationField,
  cursorField,
  limitField,
  readTool,
  searchField,
  writeTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

const requestIdField = z.string().min(1).max(64).describe("The brand request's id.")

async function loadRequestOrThrow(id: string) {
  const row = await getBrandRequestDetail(id)
  if (!row) throw new Error("Request not found")
  return row
}

export function registerBrandRequestTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_brand_requests",
    {
      title: "List competitor brand requests",
      description:
        "Franchisee requests to start monitoring a competitor brand, newest first. The " +
        "pipeline runs submitted -> recon_running -> recon_complete -> approved -> building " +
        "-> live, with needs_human and rejected as side exits. Statuses after 'approved' are " +
        "written by the external competitor-monitor repo, so this always reads live data. " +
        "Returns { items, next_cursor }.",
      inputSchema: z.object({
        status: z.enum(BRAND_REQUEST_STATUSES).optional().describe("Only requests in this status."),
        search: searchField,
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_brand_requests", args, async () =>
        listBrandRequests({
          status: args.status,
          search: args.search,
          limit: args.limit ?? DEFAULT_LIMIT,
          cursor: args.cursor,
        }),
      ),
  )

  server.registerTool(
    "get_brand_request",
    {
      title: "Get competitor brand request",
      description:
        "One brand request in full, including the `recon` payload the monitor repo wrote " +
        "(location count, cost estimate), the PR and issue links once a build starts, and " +
        "the last dispatch error if a handoff failed.",
      inputSchema: z.object({ request_id: requestIdField }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "get_brand_request", args, async () => ({
        ...(await loadRequestOrThrow(args.request_id)),
      })),
  )

  if (!ctx.canWrite) return

  server.registerTool(
    "approve_brand_request",
    {
      title: "Approve competitor brand request",
      description:
        "Approve a request whose recon has completed and hand it to the competitor-monitor " +
        "repo to build. Set without_recon only when the brand is already known to be wanted " +
        "or recon is stuck. The approval is committed even if the handoff fails; the result's " +
        "`dispatched` says whether it fired, and retry_brand_request_dispatch re-fires it.",
      inputSchema: z.object({
        request_id: requestIdField,
        without_recon: z
          .boolean()
          .optional()
          .describe("Approve from submitted/recon_running/needs_human without waiting for recon."),
      }),
      annotations: WRITE_ANNOTATIONS,
    },
    async (args) =>
      writeTool(ctx, "approve_brand_request", args, async () => {
        const result = await approveBrandRequest(ctx.actor, args.request_id, {
          withoutRecon: args.without_recon,
        })
        return {
          audit_id: result.auditId,
          dispatched: result.dispatched,
          next_step: result.dispatched
            ? "The monitor repo has the build request."
            : 'Handoff failed. Call retry_brand_request_dispatch with kind "build".',
          target: await loadRequestOrThrow(args.request_id),
        }
      }),
  )

  server.registerTool(
    "reject_brand_request",
    {
      title: "Reject competitor brand request",
      description:
        "Reject a request with a reason the franchisee will read (max 500 characters). A " +
        "request that has already been approved or built can no longer be rejected. " +
        "DESTRUCTIVE: preview first, then re-send with confirmation_token.",
      inputSchema: z.object({
        request_id: requestIdField,
        // 500, not the shared 2000: rejectBrandRequest's own cap is 500 and a longer
        // string would be refused after the round trip instead of before it.
        reason: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .describe("Reason shown to the franchisee (max 500 characters)."),
        confirmation_token: confirmationField,
      }),
      annotations: DESTRUCTIVE_ANNOTATIONS,
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "reject_brand_request", args, async () => {
        const { confirmation_token, ...rest } = args
        const row = await loadRequestOrThrow(rest.request_id)
        // The core's two status refusals, re-run on the preview path (spec §7.5) so a
        // doomed rejection never mints a token. Sentences copied verbatim from
        // rejectBrandRequest, and the status set is the core's own constant.
        // `some`, not `includes`: the row's status is a plain string on the wire.
        if (row.status === "rejected") throw new Error("Request is already rejected.")
        if (APPROVED_STATUSES.some((s) => s === row.status)) {
          throw new Error(
            "Request is already approved and being set up — it can no longer be rejected.",
          )
        }
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "reject_brand_request",
          rest,
          confirmation_token,
          `Reject the request to monitor "${row.brand_name}" (${row.website_url}, currently ${row.status}) with reason "${rest.reason}". The franchisee sees the reason and can resubmit.`,
        )
        if (prompt) return { ...prompt }
        const result = await rejectBrandRequest(ctx.actor, rest.request_id, rest.reason)
        return { audit_id: result.auditId, target: await loadRequestOrThrow(rest.request_id) }
      }),
  )

  server.registerTool(
    "retry_brand_request_dispatch",
    {
      title: "Retry monitor dispatch",
      description:
        'Re-fire a GitHub handoff to the competitor-monitor repo. Use kind "recon" for a ' +
        'request stuck in submitted or recon_running, and kind "build" for one stuck in ' +
        "approved or building. Refused from any other status so a retry cannot restart a " +
        "stage the pipeline already passed.",
      inputSchema: z.object({
        request_id: requestIdField,
        kind: z.enum(["recon", "build"]).describe("Which pipeline stage to re-dispatch."),
      }),
      annotations: WRITE_ANNOTATIONS,
    },
    async (args) =>
      writeTool(ctx, "retry_brand_request_dispatch", args, async () => {
        const result = await retryMonitorDispatch(ctx.actor, args.request_id, args.kind)
        return { audit_id: result.auditId, target: await loadRequestOrThrow(args.request_id) }
      }),
  )
}
