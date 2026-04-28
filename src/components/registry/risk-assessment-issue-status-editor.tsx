"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";

type Props = {
  issueId: string;
  currentStatus: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "ACCEPTED";
};

const statusOptions = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "ACCEPTED", label: "Accepted" },
] as const;

function statusVariant(status: Props["currentStatus"]) {
  if (status === "RESOLVED") return "success";
  if (status === "IN_PROGRESS") return "warning";
  if (status === "ACCEPTED") return "info";
  return "critical";
}

export function RiskAssessmentIssueStatusEditor({ issueId, currentStatus }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [saving, setSaving] = useState(false);

  async function handleChange(nextStatus: Props["currentStatus"]) {
    setStatus(nextStatus);
    setSaving(true);
    try {
      const res = await fetch(`/api/risk-assessment-issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error("Failed to update");
      router.refresh();
    } catch {
      setStatus(currentStatus);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant={statusVariant(status)}>{status.replace(/_/g, " ")}</Badge>
      <select
        value={status}
        onChange={(e) => handleChange(e.target.value as Props["currentStatus"])}
        disabled={saving}
        className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--text-primary)]"
      >
        {statusOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
