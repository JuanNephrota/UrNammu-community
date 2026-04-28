"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export function ExecutivePostureChart({
  data,
}: {
  data: { period: string; approved: number; ungoverned: number }[];
}) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-[var(--text-muted)]">No posture trend data yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.08)" />
        <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#64748b" }} stroke="rgba(148, 163, 184, 0.1)" />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} stroke="rgba(148, 163, 184, 0.1)" />
        <Tooltip
          contentStyle={{
            backgroundColor: "#111827",
            border: "1px solid rgba(148, 163, 184, 0.12)",
            borderRadius: "8px",
            color: "#e2e8f0",
            fontSize: "12px",
          }}
        />
        <Legend wrapperStyle={{ fontSize: "11px" }} />
        <Area type="monotone" dataKey="approved" stroke="#34d399" fill="#34d399" fillOpacity={0.25} />
        <Area type="monotone" dataKey="ungoverned" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.22} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
