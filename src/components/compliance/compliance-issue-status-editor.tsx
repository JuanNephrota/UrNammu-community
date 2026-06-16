"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";

const statusOptions = ["OPEN", "IN_PROGRESS", "RESOLVED", "ACCEPTED"] as const;

export function ComplianceIssueStatusEditor({
  issueId,
  currentStatus,
}: {
  issueId: string;
  currentStatus: (typeof statusOptions)[number];
}) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [saving, setSaving] = useState(false);

  async function handleChange(nextStatus: (typeof statusOptions)[number]) {
    setStatus(nextStatus);
    setSaving(true);
    try {
      const res = await fetch(`/api/compliance-issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error("Failed to update issue");
      router.refresh();
    } catch {
      setStatus(currentStatus);
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex items-center gap-2 text-xs">
      <Badge variant={statusBadgeVariant(status)}>{status.replace(/_/g, " ")}</Badge>
      <select
        value={status}
        onChange={(e) => handleChange(e.target.value as (typeof statusOptions)[number])}
        disabled={saving}
        className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--text-primary)]"
      >
        {statusOptions.map((option) => (
          <option key={option} value={option}>
            {option.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
