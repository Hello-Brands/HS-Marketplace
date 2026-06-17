import 'server-only'
import { z } from "zod"

export const kpiMonthSchema = z.object({
  month: z.string(),
  value: z.number(),
})

export const kpiMetricSchema = z.object({
  lastMonth: z.number(),
  momChange: z.number(),
  trend: z.array(kpiMonthSchema),
  updatedAt: z.string(),
  source: z.enum(["boulevard", "sample"]).optional(),
})

export const kpiResponseSchema = z.object({
  revenue: kpiMetricSchema.optional(),
  newClients: kpiMetricSchema.optional(),
  bookings: kpiMetricSchema.optional(),
  membershipConversion: kpiMetricSchema.optional(),
})

export type KpiMonth = z.infer<typeof kpiMonthSchema>
export type KpiMetric = z.infer<typeof kpiMetricSchema>
export type KpiData = z.infer<typeof kpiResponseSchema>
