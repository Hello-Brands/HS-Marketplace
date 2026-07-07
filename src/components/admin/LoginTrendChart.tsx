"use client"

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"
import type { LoginTrendPoint } from "@/app/admin/analytics/actions"
import { BRAND } from "@/lib/brand-colors"

export function LoginTrendChart({ data }: { data: LoginTrendPoint[] }) {
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="loginFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND.crimson} stopOpacity={0.25} />
              <stop offset="100%" stopColor={BRAND.crimson} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={BRAND.border} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: BRAND.taupe }}
            tickFormatter={(d: string) => d.slice(5)}
            interval={4}
            axisLine={false}
            tickLine={false}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: BRAND.taupe }} axisLine={false} tickLine={false} width={28} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${BRAND.border}` }}
            labelStyle={{ color: BRAND.taupe }}
          />
          <Area type="monotone" dataKey="count" name="Logins" stroke={BRAND.crimson} strokeWidth={2} fill="url(#loginFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
