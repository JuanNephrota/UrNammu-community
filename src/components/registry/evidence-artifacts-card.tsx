"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/utils";

type Artifact = {
  id: string;
  title: string;
  category: string;
  content: string | null;
  linkUrl: string | null;
  createdAt: string | Date;
  uploadedByUser: {
    name: string | null;
    email: string;
  };
};

export function EvidenceArtifactsCard({
  systemId,
  artifacts,
}: {
  systemId: string;
  artifacts: Artifact[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [content, setContent] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai-systems/${systemId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, content, linkUrl }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Failed to save evidence.");
      setTitle("");
      setCategory("");
      setContent("");
      setLinkUrl("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save evidence.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence Artifacts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-[var(--text-secondary)]">
            Attach supporting evidence so reviewers can verify compliance at approval time. Each artifact
            should document a specific control, assessment, or decision — not summarize the whole system.
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Common categories: Security Review, Privacy / DPIA, Legal Review, Model Card,
            Data Use Agreement, Bias Evaluation, Performance Evaluation, Architecture / Design,
            Change Management, Vendor Assessment.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vendor security review — Acme, 2026-02" />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Security Review"
              list="evidence-category-suggestions"
            />
            <datalist id="evidence-category-suggestions">
              <option value="Security Review" />
              <option value="Privacy / DPIA" />
              <option value="Legal Review" />
              <option value="Model Card" />
              <option value="Data Use Agreement" />
              <option value="Bias Evaluation" />
              <option value="Performance Evaluation" />
              <option value="Architecture / Design" />
              <option value="Change Management" />
              <option value="Vendor Assessment" />
            </datalist>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Reference Link</Label>
          <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." />
        </div>
        <div className="space-y-2">
          <Label>Notes / Contents</Label>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving || !title.trim() || !category.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving..." : "Add Evidence"}
          </Button>
          {error && <span className="text-sm text-[var(--critical)]">{error}</span>}
        </div>
        <div className="space-y-3">
          {artifacts.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No evidence artifacts attached yet.</p>
          ) : (
            artifacts.map((artifact) => (
              <div key={artifact.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{artifact.title}</p>
                    <p className="text-xs text-[var(--text-muted)]">{artifact.category}</p>
                  </div>
                  <span className="text-xs text-[var(--text-faint)]">{formatDateTime(artifact.createdAt)}</span>
                </div>
                {artifact.linkUrl && (
                  <a href={artifact.linkUrl} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-[var(--accent)] hover:underline">
                    {artifact.linkUrl}
                  </a>
                )}
                {artifact.content && <p className="mt-2 text-sm text-[var(--text-secondary)]">{artifact.content}</p>}
                <p className="mt-2 text-xs text-[var(--text-faint)]">
                  Added by {artifact.uploadedByUser.name ?? artifact.uploadedByUser.email}
                </p>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
