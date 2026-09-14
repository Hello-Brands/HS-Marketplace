"use server"

import { requireAdmin } from "@/lib/auth-guards"
import * as core from "@/lib/admin/core/inquiries"

export async function getInquiries() {
  await requireAdmin()
  return core.getInquiries()
}
