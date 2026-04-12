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
import { formatDate, formatDateTime } from "@/lib/utils";

type GovernanceException = {
  id: string;
  title: string;
  rationale: string;
  expiresAt: string | Date;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  createdAt: string | Date;
  approvedByUser: {
    name: string | null;
    email: string;
  };
};

export function GovernanceExceptionsCard({
  systemId,
  exceptions,
}: {
  systemId: string;
  exceptions: GovernanceException[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai-systems/${systemId}/exceptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, rationale, expiresAt }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Failed to save governance exception.");
      setTitle("");
      setRationale("");
      setExpiresAt("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save governance exception.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Governance Exceptions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Use exceptions for time-boxed governance waivers with a clear rationale and expiry date.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Exception Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Temporary legal review waiver" />
          </div>
          <div className="space-y-2">
            <Label>Expires On</Label>
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Rationale</Label>
          <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={submitting || !title.trim() || !rationale.trim() || !expiresAt}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? "Saving..." : "Create Exception"}
          </Button>
          {error && <span className="text-sm text-[var(--critical)]">{error}</span>}
        </div>
        <div className="space-y-3">
          {exceptions.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No governance exceptions recorded.</p>
          ) : (
            exceptions.map((exception) => (
              <div key={exception.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{exception.title}</p>
                    <Badge variant={exception.status === "ACTIVE" ? "warning" : "outline"}>{exception.status}</Badge>
                  </div>
                  <span className="text-xs text-[var(--text-faint)]">Expires {formatDate(exception.expiresAt)}</span>
                </div>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">{exception.rationale}</p>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  {exception.approvedByUser.name ?? exception.approvedByUser.email} · {formatDateTime(exception.createdAt)}
                </p>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
