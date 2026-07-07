import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'
import { auth } from '@/auth'

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname) => {
        // Verify user is authenticated with seller access
        const session = await auth()
        if (!session?.user) {
          throw new Error('Unauthorized')
        }
        if (!session.user.sellerAccess && session.user.role !== 'admin') {
          throw new Error('Seller access required')
        }

        return {
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
          maximumSizeInBytes: 10 * 1024 * 1024, // 10MB
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: session.user.id }),
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const { userId } = JSON.parse(tokenPayload || '{}')
        // Photo is stored in form state until listing is saved
      },
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    )
  }
}
