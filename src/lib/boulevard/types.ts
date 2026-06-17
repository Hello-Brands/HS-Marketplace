import { z } from "zod"

export const monthlySalesResponse = z.object({
  data: z.object({
    location: z.object({
      monthlySales: z.array(z.object({ month: z.string(), salesCents: z.number() })),
    }).nullable(),
  }),
})

export const locationsResponse = z.object({
  data: z.object({
    locations: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
})

export type MonthlySales = { month: string; sales: number }
