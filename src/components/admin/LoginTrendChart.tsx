"use client"

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"
import type { LoginTrendPoint } from "@/app/admin/analytics/actions"

export function LoginTrendChart({ data }: { data: LoginTrendPoint[] }) {
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="loginFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ED1845" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#ED1845" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8DED7" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#8F7067" }}
            tickFormatter={(d: string) => d.slice(5)}
            interval={4}
            axisLine={false}
            tickLine={false}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#8F7067" }} axisLine={false} tickLine={false} width={28} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E8DED7" }}
            labelStyle={{ color: "#8F7067" }}
          />
          <Area type="monotone" dataKey="count" name="Logins" stroke="#ED1845" strokeWidth={2} fill="url(#loginFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
