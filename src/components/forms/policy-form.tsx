"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { normalizePolicyRules } from "@/lib/policy-rules";
import type { PolicyRuleSet } from "@/lib/policy-rules";

export interface PolicyFormInitialData {
  id: string;
  name: string;
  description: string | null;
  framework: string;
  version: string;
  content: string;
  status: string;
  rules: PolicyRuleSet | null;
}

interface PolicyFormProps {
  initialData?: PolicyFormInitialData;
}

const FRAMEWORK_OPTIONS = [
  { value: "EU_AI_ACT", label: "EU AI Act" },
  { value: "NIST_AI_RMF", label: "NIST AI RMF" },
  { value: "ISO_42001", label: "ISO 42001" },
  { value: "SOC2", label: "SOC 2" },
  { value: "CUSTOM", label: "Custom" },
];

const SENSITIVITY_OPTIONS = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"];
const STAGE_OPTIONS = ["OWNER", "SECURITY", "LEGAL", "COMPLIANCE"];
const STATUS_OPTIONS = ["DRAFT", "UNDER_REVIEW", "APPROVED", "DEPLOYED", "DEPRECATED", "RETIRED"];

function arrayToCsv(arr: string[] | undefined): string {
  return (arr ?? []).join(", ");
}

export function PolicyForm({ initialData }: PolicyFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!initialData?.id;
  const rules = initialData?.rules ?? null;
  const actions = rules?.actions ?? {};

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get("name") as string,
      description: formData.get("description") as string,
      framework: formData.get("framework") as string,
      version: (formData.get("version") as string) || "1.0",
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
      const url = isEditing ? `/api/policies/${initialData!.id}` : "/api/policies";
      const method = isEditing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? (isEditing ? "Failed to update" : "Failed to create"));
      }
      const policy = await res.json();
      router.push(`/compliance/policies/${policy.id ?? initialData!.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-[var(--critical)]/10 p-3 text-sm text-[var(--critical)]">
          {error}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Policy Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Policy Name *</Label>
              <Input id="name" name="name" defaultValue={initialData?.name ?? ""} required />
            </div>
            <div className="space-y-2">
              <Label>Framework *</Label>
              <select
                name="framework"
                required
                defaultValue={initialData?.framework ?? "EU_AI_ACT"}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                {FRAMEWORK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="version">Version</Label>
              <Input id="version" name="version" defaultValue={initialData?.version ?? "1.0"} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <select
                name="status"
                defaultValue={initialData?.status ?? "DRAFT"}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={2}
              defaultValue={initialData?.description ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content">Policy Content *</Label>
            <Textarea
              id="content"
              name="content"
              rows={10}
              required
              placeholder="Enter the full policy text..."
              defaultValue={initialData?.content ?? ""}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Machine-Readable Rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="allowedVendors">Allowed Vendors</Label>
            <Input
              id="allowedVendors"
              name="allowedVendors"
              placeholder="OpenAI, Anthropic, Internal"
              defaultValue={arrayToCsv(rules?.allowedVendors)}
            />
            <p className="text-xs text-[var(--text-muted)]">
              Comma-separated approved vendors for this policy.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="blockedVendors">Blocked Vendors</Label>
            <Input
              id="blockedVendors"
              name="blockedVendors"
              placeholder="Unapproved Vendor, Personal Tool"
              defaultValue={arrayToCsv(rules?.blockedVendors)}
            />
            <p className="text-xs text-[var(--text-muted)]">
              Comma-separated vendors that should be blocked by this policy.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Blocked Data Sensitivities</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {SENSITIVITY_OPTIONS.map((value) => (
                <label
                  key={value}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="blockedDataSensitivities"
                    value={value}
                    defaultChecked={rules?.blockedDataSensitivities?.includes(value as never) ?? false}
                  />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Maximum Data Sensitivity</Label>
            <select
              name="maxDataSensitivity"
              defaultValue={rules?.maxDataSensitivity ?? ""}
              className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
            >
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
              {STAGE_OPTIONS.map((value) => (
                <label
                  key={value}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="requiredStages"
                    value={value}
                    defaultChecked={rules?.requiredStages?.includes(value as never) ?? false}
                  />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="allowedDepartments">Allowed Departments</Label>
              <Input
                id="allowedDepartments"
                name="allowedDepartments"
                placeholder="Engineering, Legal"
                defaultValue={arrayToCsv(rules?.allowedDepartments)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="blockedDepartments">Blocked Departments</Label>
              <Input
                id="blockedDepartments"
                name="blockedDepartments"
                placeholder="Interns, Vendors"
                defaultValue={arrayToCsv(rules?.blockedDepartments)}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="allowedModelPatterns">Allowed Model Patterns</Label>
              <Input
                id="allowedModelPatterns"
                name="allowedModelPatterns"
                placeholder="gpt-4, claude-sonnet"
                defaultValue={arrayToCsv(rules?.allowedModelPatterns)}
              />
              <p className="text-xs text-[var(--text-muted)]">
                Comma-separated substrings matched against the system model type.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="blockedModelPatterns">Blocked Model Patterns</Label>
              <Input
                id="blockedModelPatterns"
                name="blockedModelPatterns"
                placeholder="preview, beta"
                defaultValue={arrayToCsv(rules?.blockedModelPatterns)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Allowed System Statuses</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {STATUS_OPTIONS.map((value) => (
                <label
                  key={value}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="allowedStatuses"
                    value={value}
                    defaultChecked={rules?.allowedStatuses?.includes(value as never) ?? false}
                  />
                  <span>{value.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="maxReviewIntervalDays">Max Review Interval (Days)</Label>
              <Input
                id="maxReviewIntervalDays"
                name="maxReviewIntervalDays"
                type="number"
                min={0}
                placeholder="365"
                defaultValue={rules?.maxReviewIntervalDays ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label>Minimum Risk Level</Label>
              <select
                name="minimumRiskLevel"
                defaultValue={rules?.minimumRiskLevel ?? ""}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
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
              <select
                name="enforcement"
                defaultValue={actions.enforcement ?? "BLOCK"}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="BLOCK">Blocking</option>
                <option value="ADVISORY">Advisory</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Recommended Compliance Status</Label>
              <select
                name="recommendedComplianceStatus"
                defaultValue={actions.recommendedComplianceStatus ?? "NON_COMPLIANT"}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="NON_COMPLIANT">Non-Compliant</option>
                <option value="PARTIALLY_COMPLIANT">Partially Compliant</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label className="opacity-0">Exceptions</Label>
              <label className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  name="allowException"
                  defaultChecked={actions.allowException ?? false}
                />
                <span>Allow active governance exceptions to waive blocking findings</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={loading}
          className="bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110"
        >
          {loading
            ? isEditing ? "Saving..." : "Creating..."
            : isEditing ? "Save Changes" : "Create Policy"}
        </Button>
      </div>
    </form>
  );
}
