import {
  authorizationServerMetadata,
  metadataPreflightResponse,
  metadataResponse,
} from "@/lib/mcp/oauth/metadata"

// Node runtime: the metadata builders read process.env through @/lib/env.
export const runtime = "nodejs"

export async function GET(): Promise<Response> {
  return metadataResponse(authorizationServerMetadata())
}

export async function OPTIONS(): Promise<Response> {
  return metadataPreflightResponse()
}
