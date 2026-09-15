import {
  metadataPreflightResponse,
  metadataResponse,
  protectedResourceMetadata,
} from "@/lib/mcp/oauth/metadata"

/**
 * Path-suffixed variant of the RFC 9728 document: the resource lives at
 * /api/mcp, so its metadata also lives at
 * /.well-known/oauth-protected-resource/api/mcp. Claude probes THIS URL first
 * and only falls back to the bare one, so both must exist and must serve the
 * identical body.
 */
export const runtime = "nodejs"

export async function GET(): Promise<Response> {
  return metadataResponse(protectedResourceMetadata())
}

export async function OPTIONS(): Promise<Response> {
  return metadataPreflightResponse()
}
