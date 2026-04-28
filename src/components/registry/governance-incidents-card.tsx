"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/utils";

type Incident = {
  id: string;
  title: string;
  summary: string | null;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";
  openedAt: string | Date;
  openedByUser: {
    name: string | null;
    email: string;
  };
};

export function GovernanceIncidentsCard({
  systemId,
  incidents,
}: {
  systemId: string;
  incidents: Incident[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [severity, setSeverity] = useState<Incident["severity"]>("MEDIUM");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai-systems/${systemId}/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, summary, severity }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Failed to create incident.");
      setTitle("");
      setSummary("");
      setSeverity("MEDIUM");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create incident.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Governance Incidents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Link misuse, policy breaches, or other governance events directly to the system record.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Incident Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Restricted data sent to external model" />
          </div>
          <div className="space-y-2">
            <Label>Severity</Label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Incident["severity"])}
              className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
            >
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
              <option value="INFO">Info</option>
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Summary</Label>
          <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving || !title.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving..." : "Log Incident"}
          </Button>
          {error && <span className="text-sm text-[var(--critical)]">{error}</span>}
        </div>
        <div className="space-y-3">
          {incidents.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No governance incidents linked yet.</p>
          ) : (
            incidents.map((incident) => (
              <div key={incident.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{incident.title}</p>
                    <Badge variant={incident.status === "OPEN" ? "critical" : "outline"}>{incident.status}</Badge>
                  </div>
                  <span className="text-xs text-[var(--text-faint)]">{formatDateTime(incident.openedAt)}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{incident.severity}</p>
                {incident.summary && <p className="mt-2 text-sm text-[var(--text-secondary)]">{incident.summary}</p>}
                <p className="mt-2 text-xs text-[var(--text-faint)]">
                  Opened by {incident.openedByUser.name ?? incident.openedByUser.email}
                </p>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
