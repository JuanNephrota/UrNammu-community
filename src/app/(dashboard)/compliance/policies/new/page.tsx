"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NewPolicyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get("name") as string,
      description: formData.get("description") as string,
      framework: formData.get("framework") as string,
      version: formData.get("version") as string || "1.0",
      content: formData.get("content") as string,
      status: formData.get("status") as string,
    };

    try {
      const res = await fetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create");
      const policy = await res.json();
      router.push(`/compliance/policies/${policy.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Create Policy" description="Define a new compliance policy" />
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <div className="rounded-md bg-red-500/10 p-3 text-sm text-[var(--critical)]">{error}</div>}
        <Card>
          <CardHeader><CardTitle>Policy Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Policy Name *</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-2">
                <Label>Framework *</Label>
                <select name="framework" required className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
                  <option value="EU_AI_ACT">EU AI Act</option>
                  <option value="NIST_AI_RMF">NIST AI RMF</option>
                  <option value="ISO_42001">ISO 42001</option>
                  <option value="SOC2">SOC 2</option>
                  <option value="CUSTOM">Custom</option>
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="version">Version</Label>
                <Input id="version" name="version" defaultValue="1.0" />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <select name="status" defaultValue="DRAFT" className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
                  <option value="DRAFT">Draft</option>
                  <option value="ACTIVE">Active</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={2} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="content">Policy Content *</Label>
              <Textarea id="content" name="content" rows={10} required placeholder="Enter the full policy text..." />
            </div>
          </CardContent>
        </Card>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" disabled={loading} className="bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110">
            {loading ? "Creating..." : "Create Policy"}
          </Button>
        </div>
      </form>
    </div>
  );
}
