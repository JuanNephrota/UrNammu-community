"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { normalizePolicyRules } from "@/lib/policy-rules";

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
      rules: normalizePolicyRules({
        allowedVendors: formData.get("allowedVendors") as string,
        blockedVendors: formData.get("blockedVendors") as string,
        blockedDataSensitivities: formData.getAll("blockedDataSensitivities") as string[],
        maxDataSensitivity: formData.get("maxDataSensitivity") as string,
        requiredStages: formData.getAll("requiredStages") as string[],
        maxReviewIntervalDays: Number(formData.get("maxReviewIntervalDays") || 0),
        minimumRiskLevel: formData.get("minimumRiskLevel") as string,
        allowedDepartments: formData.get("allowedDepartments") as string,
        blockedDepartments: formData.get("blockedDepartments") as string,
        allowedModelPatterns: formData.get("allowedModelPatterns") as string,
        blockedModelPatterns: formData.get("blockedModelPatterns") as string,
        allowedStatuses: formData.getAll("allowedStatuses") as string[],
        enforcement: formData.get("enforcement") as string,
        allowException: formData.get("allowException") === "on",
        recommendedComplianceStatus: formData.get("recommendedComplianceStatus") as string,
      }),
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
        <Card>
          <CardHeader><CardTitle>Machine-Readable Rules</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="allowedVendors">Allowed Vendors</Label>
              <Input id="allowedVendors" name="allowedVendors" placeholder="OpenAI, Anthropic, Internal" />
              <p className="text-xs text-[var(--text-muted)]">Comma-separated approved vendors for this policy.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="blockedVendors">Blocked Vendors</Label>
              <Input id="blockedVendors" name="blockedVendors" placeholder="Unapproved Vendor, Personal Tool" />
              <p className="text-xs text-[var(--text-muted)]">Comma-separated vendors that should be blocked by this policy.</p>
            </div>
            <div className="space-y-2">
              <Label>Blocked Data Sensitivities</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"].map((value) => (
                  <label key={value} className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 text-sm">
                    <input type="checkbox" name="blockedDataSensitivities" value={value} />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Maximum Data Sensitivity</Label>
              <select name="maxDataSensitivity" defaultValue="" className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
                <option value="">No maximum</option>
                <option value="PUBLIC">Public</option>
                <option value="INTERNAL">Internal</option>
                <option value="CONFIDENTIAL">Confidential</option>
                <option value="RESTRICTED">Restricted</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Required Governance Stages</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {["OWNER", "SECURITY", "LEGAL", "COMPLIANCE"].map((value) => (
                  <label key={value} className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 text-sm">
                    <input type="checkbox" name="requiredStages" value={value} />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="allowedDepartments">Allowed Departments</Label>
                <Input id="allowedDepartments" name="allowedDepartments" placeholder="Engineering, Legal" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="blockedDepartments">Blocked Departments</Label>
                <Input id="blockedDepartments" name="blockedDepartments" placeholder="Interns, Vendors" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="allowedModelPatterns">Allowed Model Patterns</Label>
                <Input id="allowedModelPatterns" name="allowedModelPatterns" placeholder="gpt-4, claude-sonnet" />
                <p className="text-xs text-[var(--text-muted)]">Comma-separated substrings matched against the system model type.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="blockedModelPatterns">Blocked Model Patterns</Label>
                <Input id="blockedModelPatterns" name="blockedModelPatterns" placeholder="preview, beta" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Allowed System Statuses</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {["DRAFT", "UNDER_REVIEW", "APPROVED", "DEPLOYED", "DEPRECATED", "RETIRED"].map((value) => (
                  <label key={value} className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 text-sm">
                    <input type="checkbox" name="allowedStatuses" value={value} />
                    <span>{value.replace(/_/g, " ")}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="maxReviewIntervalDays">Max Review Interval (Days)</Label>
                <Input id="maxReviewIntervalDays" name="maxReviewIntervalDays" type="number" min={0} placeholder="365" />
              </div>
              <div className="space-y-2">
                <Label>Minimum Risk Level</Label>
                <select name="minimumRiskLevel" defaultValue="" className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
                  <option value="">No minimum</option>
                  <option value="MINIMAL">Minimal</option>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Enforcement</Label>
                <select name="enforcement" defaultValue="BLOCK" className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
                  <option value="BLOCK">Blocking</option>
                  <option value="ADVISORY">Advisory</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Recommended Compliance Status</Label>
                <select name="recommendedComplianceStatus" defaultValue="NON_COMPLIANT" className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
                  <option value="NON_COMPLIANT">Non-Compliant</option>
                  <option value="PARTIALLY_COMPLIANT">Partially Compliant</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label className="opacity-0">Exceptions</Label>
                <label className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm text-[var(--text-primary)]">
                  <input type="checkbox" name="allowException" />
                  <span>Allow active governance exceptions to waive blocking findings</span>
                </label>
              </div>
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
