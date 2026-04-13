"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HelpHint } from "@/components/help/help-hint";
import { formatDateForInput } from "@/lib/utils";

interface AISystemFormProps {
  initialData?: {
    discoveredToolId?: string | null;
    id?: string;
    name: string;
    description: string | null;
    version: string | null;
    department: string;
    riskLevel: string;
    status: string;
    useCase: string | null;
    dataSensitivity: string;
    vendor: string | null;
    modelType: string | null;
    dataInputs: string | null;
    dataOutputs: string | null;
    reviewIntervalDays: number;
    nextReviewDate: string | Date | null;
    requireOwnerApproval: boolean;
    requireSecurityApproval: boolean;
    requireLegalApproval: boolean;
    requireComplianceApproval: boolean;
  };
}

export function AISystemForm({ initialData }: AISystemFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!initialData?.id;
  const requiredApprovalStages: Array<{
    name:
      | "requireOwnerApproval"
      | "requireSecurityApproval"
      | "requireLegalApproval"
      | "requireComplianceApproval";
    label: string;
    checked: boolean;
  }> = [
    { name: "requireOwnerApproval", label: "Owner review", checked: initialData?.requireOwnerApproval ?? true },
    { name: "requireSecurityApproval", label: "Security review", checked: initialData?.requireSecurityApproval ?? true },
    { name: "requireLegalApproval", label: "Legal review", checked: initialData?.requireLegalApproval ?? false },
    { name: "requireComplianceApproval", label: "Compliance review", checked: initialData?.requireComplianceApproval ?? true },
  ];

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const val = (key: string) => {
      const v = (formData.get(key) as string)?.trim();
      return v || undefined;
    };
    const data = {
      name: val("name"),
      description: val("description"),
      version: val("version"),
      department: val("department"),
      riskLevel: val("riskLevel") ?? "MEDIUM",
      status: val("status") ?? "DRAFT",
      useCase: val("useCase"),
      dataSensitivity: val("dataSensitivity") ?? "INTERNAL",
      vendor: val("vendor"),
      modelType: val("modelType"),
      dataInputs: val("dataInputs"),
      dataOutputs: val("dataOutputs"),
      reviewIntervalDays: Number(formData.get("reviewIntervalDays") ?? 365),
      nextReviewDate: val("nextReviewDate"),
      requireOwnerApproval: formData.get("requireOwnerApproval") === "on",
      requireSecurityApproval: formData.get("requireSecurityApproval") === "on",
      requireLegalApproval: formData.get("requireLegalApproval") === "on",
      requireComplianceApproval: formData.get("requireComplianceApproval") === "on",
      discoveredToolId: val("discoveredToolId"),
    };

    try {
      const url = isEditing
        ? `/api/ai-systems/${initialData.id}`
        : "/api/ai-systems";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to save");
      }

      const system = await res.json();
      router.push(`/registry/${system.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <input type="hidden" name="discoveredToolId" value={initialData?.discoveredToolId ?? ""} />
      {error && (
        <div className="rounded-md bg-[var(--critical)]/10 p-3 text-sm text-[var(--critical)]">
          {error}
        </div>
      )}

      <Tabs defaultValue="basic">
        <TabsList>
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="technical">Technical Details</TabsTrigger>
          <TabsTrigger value="data">Data Classification</TabsTrigger>
          <TabsTrigger value="governance">Governance Controls</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" forceMount className="data-[state=inactive]:hidden">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">System Name *</Label>
                  <Input
                    id="name"
                    name="name"
                    defaultValue={initialData?.name ?? ""}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="department">Department *</Label>
                  <Input
                    id="department"
                    name="department"
                    defaultValue={initialData?.department ?? ""}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  defaultValue={initialData?.description ?? ""}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="useCase">Use Case</Label>
                <Textarea
                  id="useCase"
                  name="useCase"
                  defaultValue={initialData?.useCase ?? ""}
                  rows={2}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Risk Level</Label>
                  <select
                    name="riskLevel"
                    defaultValue={initialData?.riskLevel ?? "MEDIUM"}
                    className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
                  >
                    <option value="MINIMAL">Minimal</option>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <select
                    name="status"
                    defaultValue={initialData?.status ?? "DRAFT"}
                    className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="UNDER_REVIEW">Under Review</option>
                    {initialData?.status === "APPROVED" && (
                      <option value="APPROVED">Approved</option>
                    )}
                    <option value="DEPLOYED">Deployed</option>
                    <option value="DEPRECATED">Deprecated</option>
                    <option value="RETIRED">Retired</option>
                  </select>
                  <p className="text-xs text-[var(--text-muted)]">
                    Approved status is recorded through the registry approval review.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="version">Version</Label>
                  <Input
                    id="version"
                    name="version"
                    defaultValue={initialData?.version ?? ""}
                    placeholder="e.g. 1.0"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="technical" forceMount className="data-[state=inactive]:hidden">
          <Card>
            <CardHeader>
              <CardTitle>Technical Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="vendor">Vendor / Provider</Label>
                  <Input
                    id="vendor"
                    name="vendor"
                    defaultValue={initialData?.vendor ?? ""}
                    placeholder="e.g. Anthropic, OpenAI, Internal"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="modelType">Model Type</Label>
                  <Input
                    id="modelType"
                    name="modelType"
                    defaultValue={initialData?.modelType ?? ""}
                    placeholder="e.g. LLM, Classification, Computer Vision"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" forceMount className="data-[state=inactive]:hidden">
          <Card>
            <CardHeader>
              <CardTitle>Data Classification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  Data Sensitivity Level
                  <HelpHint hint="data_sensitivity" />
                </Label>
                <select
                  name="dataSensitivity"
                  defaultValue={initialData?.dataSensitivity ?? "INTERNAL"}
                  className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
                >
                  <option value="PUBLIC">Public</option>
                  <option value="INTERNAL">Internal</option>
                  <option value="CONFIDENTIAL">Confidential</option>
                  <option value="RESTRICTED">Restricted</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dataInputs">Data Inputs</Label>
                <Textarea
                  id="dataInputs"
                  name="dataInputs"
                  defaultValue={initialData?.dataInputs ?? ""}
                  placeholder="Describe what data this system ingests"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dataOutputs">Data Outputs</Label>
                <Textarea
                  id="dataOutputs"
                  name="dataOutputs"
                  defaultValue={initialData?.dataOutputs ?? ""}
                  placeholder="Describe what data this system produces"
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="governance" forceMount className="data-[state=inactive]:hidden">
          <Card>
            <CardHeader>
              <CardTitle>Governance Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="reviewIntervalDays" className="flex items-center gap-1.5">
                    Review Interval (Days)
                    <HelpHint hint="review_interval" />
                  </Label>
                  <Input
                    id="reviewIntervalDays"
                    name="reviewIntervalDays"
                    type="number"
                    min={1}
                    max={730}
                    defaultValue={initialData?.reviewIntervalDays ?? 365}
                  />
                  <p className="text-xs text-[var(--text-muted)]">
                    Sets the standard renewal cadence for this system.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nextReviewDate">Next Review Date</Label>
                  <Input
                    id="nextReviewDate"
                    name="nextReviewDate"
                    type="date"
                    defaultValue={formatDateForInput(initialData?.nextReviewDate)}
                  />
                  <p className="text-xs text-[var(--text-muted)]">
                    Leave blank to calculate from today using the review interval.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <Label className="flex items-center gap-1.5">
                  Required Approval Stages
                  <HelpHint hint="approval_stages" />
                </Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {requiredApprovalStages.map(({ name, label, checked }) => (
                    <label
                      key={name}
                      className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-sm text-[var(--text-primary)]"
                    >
                      <input
                        type="checkbox"
                        name={name}
                        defaultChecked={Boolean(checked)}
                        className="h-4 w-4 rounded border-[var(--border-default)] bg-[var(--bg-elevated)]"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={loading}
          className="bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110"
        >
          {loading ? "Saving..." : isEditing ? "Update System" : "Register System"}
        </Button>
      </div>
    </form>
  );
}
