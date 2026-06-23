import { NextResponse } from "next/server"
import { syncOwnerLocations } from "@/lib/owner-directory/sync"

// Owner directory is mirrored from BigQuery on a daily schedule (see vercel.json).
export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized invocations
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await syncOwnerLocations()
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error("[cron] owner-directory sync failed:", err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 }
    )
  }
}
