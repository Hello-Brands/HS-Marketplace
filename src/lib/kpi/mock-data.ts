import 'server-only'
import type { KpiData, KpiMetric } from "./schema"

/**
 * Generate realistic 12-month trend data for a KPI metric.
 * Creates a believable growth pattern with some variance.
 */
function generateTrend(baseValue: number, variance: number = 0.15): { month: string; value: number }[] {
  const months = [
    "Apr 2025", "May 2025", "Jun 2025", "Jul 2025",
    "Aug 2025", "Sep 2025", "Oct 2025", "Nov 2025",
    "Dec 2025", "Jan 2026", "Feb 2026", "Mar 2026",
  ]

  // Start lower and trend upward with realistic variance
  const startMultiplier = 0.75
  let currentValue = baseValue * startMultiplier

  return months.map((month, i) => {
    // Gradual growth with random variance
    const growthFactor = 1 + (i * 0.02) // ~2% growth per month
    const randomVariance = 1 + (Math.random() - 0.5) * variance
    currentValue = baseValue * startMultiplier * growthFactor * randomVariance

    return {
      month,
      value: Math.round(currentValue),
    }
  })
}

/**
 * Create a complete KPI metric with last month value, MoM change, and trend.
 */
function createMetric(lastMonth: number, momChange: number, variance?: number): KpiMetric {
  return {
    lastMonth,
    momChange,
    trend: generateTrend(lastMonth, variance),
    updatedAt: new Date(Date.now() - 1000 * 60 * 23).toISOString(), // 23 minutes ago
  }
}

/**
 * Mock KPI data for a single Hello Sugar location.
 * Represents a well-performing salon with realistic metrics.
 */
export const mockLocationKpi: KpiData = {
  revenue: createMetric(45230, 12.4, 0.12),
  newClients: createMetric(127, 8.2, 0.2),
  bookings: createMetric(892, 5.7, 0.15),
  membershipConversion: createMetric(34.2, -2.1, 0.1),
}

/**
 * Alternative mock data representing a newer/smaller location.
 */
export const mockLocationKpiSmall: KpiData = {
  revenue: createMetric(28500, 18.3, 0.15),
  newClients: createMetric(84, 15.6, 0.25),
  bookings: createMetric(456, 9.2, 0.18),
  membershipConversion: createMetric(28.5, 4.3, 0.12),
}


