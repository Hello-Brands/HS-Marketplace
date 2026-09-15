import {
  metadataPreflightResponse,
  metadataResponse,
  protectedResourceMetadata,
} from "@/lib/mcp/oauth/metadata"

export const runtime = "nodejs"

export async function GET(): Promise<Response> {
  return metadataResponse(protectedResourceMetadata())
}

export async function OPTIONS(): Promise<Response> {
  return metadataPreflightResponse()
}
