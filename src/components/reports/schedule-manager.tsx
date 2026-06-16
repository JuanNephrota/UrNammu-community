"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Clock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Schedule {
  id: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  hourUtc: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  format: "PDF" | "CSV" | "JSON";
  recipients: string[];
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function cadenceLabel(s: Schedule): string {
  const at = `${String(s.hourUtc).padStart(2, "0")}:00 UTC`;
  if (s.frequency === "DAILY") return `Daily at ${at}`;
  if (s.frequency === "WEEKLY") return `Weekly on ${DOW[s.dayOfWeek ?? 1]} at ${at}`;
  return `Monthly on day ${s.dayOfMonth ?? 1} at ${at}`;
}

export function ScheduleManager({
  reportId,
  initialSchedules,
}: {
  reportId: string;
  initialSchedules: Schedule[];
}) {
  const router = useRouter();
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [frequency, setFrequency] = useState<"DAILY" | "WEEKLY" | "MONTHLY">("WEEKLY");
  const [hourUtc, setHourUtc] = useState(8);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [format, setFormat] = useState<"PDF" | "CSV" | "JSON">("PDF");
  const [recipients, setRecipients] = useState("");

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        frequency,
        hourUtc,
        dayOfWeek: frequency === "WEEKLY" ? dayOfWeek : null,
        dayOfMonth: frequency === "MONTHLY" ? dayOfMonth : null,
        format,
        recipients: recipients
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
        enabled: true,
      };
      const res = await fetch(`/api/reports/${reportId}/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not create schedule");
      setSchedules((prev) => [data, ...prev]);
      setShowForm(false);
      setRecipients("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create schedule");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(s: Schedule) {
    const res = await fetch(`/api/reports/${reportId}/schedules/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSchedules((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/reports/${reportId}/schedules/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSchedules((prev) => prev.filter((x) => x.id !== id));
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      {schedules.length === 0 && !showForm && (
        <p className="text-sm text-[var(--text-muted)]">
          No schedules yet. Add one to run this report automatically and email it to recipients.
        </p>
      )}

      {schedules.map((s) => (
        <div
          key={s.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 text-[var(--accent)]" />
            <div>
              <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                {cadenceLabel(s)}
                <Badge variant="outline">{s.format}</Badge>
                {!s.enabled && <Badge variant="warning">Paused</Badge>}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                {s.recipients.length > 0 ? (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3" /> {s.recipients.join(", ")}
                  </span>
                ) : (
                  <span>In-app only</span>
                )}
                <span>· next {new Date(s.nextRunAt).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => toggle(s)}>
              {s.enabled ? "Pause" : "Resume"}
            </Button>
            <button
              type="button"
              onClick={() => remove(s.id)}
              className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--critical-strong)]"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}

      {showForm ? (
        <div className="space-y-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Frequency</label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as typeof frequency)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">Daily</SelectItem>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Hour (UTC)</label>
              <Input
                type="number"
                min={0}
                max={23}
                value={hourUtc}
                onChange={(e) => setHourUtc(Math.min(23, Math.max(0, Number(e.target.value))))}
              />
            </div>
            {frequency === "WEEKLY" && (
              <div>
                <label className="mb-1 block text-xs text-[var(--text-muted)]">Day</label>
                <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOW.map((d, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {frequency === "MONTHLY" && (
              <div>
                <label className="mb-1 block text-xs text-[var(--text-muted)]">Day of month</label>
                <Input
                  type="number"
                  min={1}
                  max={28}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Math.min(28, Math.max(1, Number(e.target.value))))}
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Format</label>
              <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PDF">PDF</SelectItem>
                  <SelectItem value="CSV">CSV</SelectItem>
                  <SelectItem value="JSON">JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-muted)]">
              Recipients (comma-separated emails — leave blank for in-app only)
            </label>
            <Input
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="alice@acme.com, bob@acme.com"
            />
          </div>
          {error && <p className="text-xs text-[var(--critical-strong)]">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={create} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create schedule
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5" /> Add schedule
        </Button>
      )}
    </div>
  );
}
