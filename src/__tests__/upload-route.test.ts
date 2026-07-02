import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Tests the REAL POST handler in src/app/api/upload/route.ts.
 * @vercel/blob/client handleUpload is mocked so that it invokes the route's
 * onBeforeGenerateToken callback exactly like the real library would — the
 * auth gate and token options under test are the production code.
 */

const { mockAuth, mockHandleUpload } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHandleUpload: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("@vercel/blob/client", () => ({ handleUpload: mockHandleUpload }))

import { POST } from "@/app/api/upload/route"

// Captured result of the route's onBeforeGenerateToken, when it does not throw.
let capturedTokenOptions: Record<string, unknown> | null = null

function makeRequest(): Request {
  return new Request("http://localhost/api/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "blob.generate-client-token", payload: {} }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  capturedTokenOptions = null
  // Drive the route's callback the way the real handleUpload does; propagate throws.
  mockHandleUpload.mockImplementation(
    async ({ onBeforeGenerateToken }: {
      onBeforeGenerateToken: (pathname: string) => Promise<Record<string, unknown>>
    }) => {
      capturedTokenOptions = await onBeforeGenerateToken("listings/photo.jpg")
      return { type: "blob.generate-client-token", clientToken: "test-client-token" }
    }
  )
})

describe("upload route auth gate", () => {
  it("returns 400 Unauthorized when there is no session", async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
    expect(capturedTokenOptions).toBeNull()
  })

  it("returns 400 when the user has neither sellerAccess nor admin role", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", role: "user", sellerAccess: false },
    })
    const res = await POST(makeRequest())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Seller access required")
    expect(capturedTokenOptions).toBeNull()
  })

  it("allows a user with sellerAccess", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "seller-1", role: "user", sellerAccess: true },
    })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(capturedTokenOptions).not.toBeNull()
  })

  it("allows an admin without sellerAccess", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "admin-1", role: "admin", sellerAccess: false },
    })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(capturedTokenOptions).not.toBeNull()
  })
})

describe("upload route token constraints", () => {
  it("restricts uploads to jpeg/png/webp with a 10MB cap and tags the uploader", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "seller-1", role: "user", sellerAccess: true },
    })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    expect(capturedTokenOptions).not.toBeNull()
    const opts = capturedTokenOptions as Record<string, unknown>
    expect(opts.allowedContentTypes).toEqual(["image/jpeg", "image/png", "image/webp"])
    expect(opts.maximumSizeInBytes).toBe(10 * 1024 * 1024)
    expect(opts.addRandomSuffix).toBe(true)
    expect(JSON.parse(opts.tokenPayload as string)).toEqual({ userId: "seller-1" })
  })

  it("returns the handleUpload json response on success", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "seller-1", role: "user", sellerAccess: true },
    })
    const res = await POST(makeRequest())
    const body = await res.json()
    expect(body).toEqual({ type: "blob.generate-client-token", clientToken: "test-client-token" })
  })
})
