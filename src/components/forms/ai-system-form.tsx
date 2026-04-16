"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

  // Fields that can be autofilled by the AI assistant are tracked in
  // controlled state so the button's result can flow back into the inputs.
  // The untracked fields (name, department, version, status, review dates,
  // approval checkboxes) stay uncontrolled with defaultValue.
  const [name, setName] = useState<string>(initialData?.name ?? "");
  const [description, setDescription] = useState<string>(initialData?.description ?? "");
  const [useCase, setUseCase] = useState<string>(initialData?.useCase ?? "");
  const [vendor, setVendor] = useState<string>(initialData?.vendor ?? "");
  const [modelType, setModelType] = useState<string>(initialData?.modelType ?? "");
  const [dataInputs, setDataInputs] = useState<string>(initialData?.dataInputs ?? "");
  const [dataOutputs, setDataOutputs] = useState<string>(initialData?.dataOutputs ?? "");
  const [riskLevel, setRiskLevel] = useState<string>(initialData?.riskLevel ?? "MEDIUM");
  const [dataSensitivity, setDataSensitivity] = useState<string>(
    initialData?.dataSensitivity ?? "INTERNAL"
  );

  const [autofillLoading, setAutofillLoading] = useState(false);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [autofillReasoning, setAutofillReasoning] = useState<string | null>(null);
  const [autofillFilledFields, setAutofillFilledFields] = useState<string[] | null>(null);

  async function handleAutofill() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setAutofillError("Enter a system name first so the AI knows what to look up.");
      return;
    }

    setAutofillLoading(true);
    setAutofillError(null);
    setAutofillReasoning(null);
    setAutofillFilledFields(null);

    try {
      const res = await fetch("/api/ai-systems/classify-by-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          vendor: vendor.trim() || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "Couldn't autofill — the AI service didn't return a classification."
        );
      }

      const result = await res.json();
      const filled: string[] = [];
      if (typeof result.description === "string") {
        setDescription(result.description);
        filled.push("description");
      }
      if (typeof result.useCase === "string") {
        setUseCase(result.useCase);
        filled.push("use case");
      }
      if (typeof result.modelType === "string") {
        setModelType(result.modelType);
        filled.push("model type");
      }
      if (typeof result.dataInputs === "string") {
        setDataInputs(result.dataInputs);
        filled.push("data inputs");
      }
      if (typeof result.dataOutputs === "string") {
        setDataOutputs(result.dataOutputs);
        filled.push("data outputs");
      }
      if (typeof result.riskLevel === "string") {
        setRiskLevel(result.riskLevel);
        filled.push("risk level");
      }
      if (typeof result.dataSensitivity === "string") {
        setDataSensitivity(result.dataSensitivity);
        filled.push("data sensitivity");
      }
      // Only fill vendor if empty — don't overwrite an explicit user entry.
      if (typeof result.vendor === "string" && !vendor.trim()) {
        setVendor(result.vendor);
        filled.push("vendor");
      }

      setAutofillFilledFields(filled);
      if (typeof result.reasoning === "string") {
        setAutofillReasoning(result.reasoning);
      }
    } catch (err) {
      setAutofillError(err instanceof Error ? err.message : "Autofill failed");
    } finally {
      setAutofillLoading(false);
    }
  }

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
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="name">System Name *</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAutofill}
                      disabled={autofillLoading || !name.trim()}
                      className="gap-1.5 text-xs"
                      title="Use the AI assistant to look up this tool and fill in the details below"
                    >
                      {autofillLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                      )}
                      {autofillLoading ? "Analyzing..." : "Autofill with AI"}
                    </Button>
                  </div>
                  <Input
                    id="name"
                    name="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
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
              {(autofillError || autofillFilledFields) && (
                <div
                  className={
                    autofillError
                      ? "rounded-md border border-[var(--critical)]/30 bg-[var(--critical)]/5 p-3 text-xs text-[var(--critical)]"
                      : "rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3 text-xs"
                  }
                >
                  {autofillError ? (
                    autofillError
                  ) : (
                    <div className="space-y-1">
                      <p className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
                        <Badge variant="info">AI-filled</Badge>
                        Auto-filled {autofillFilledFields?.length ?? 0} field
                        {autofillFilledFields && autofillFilledFields.length === 1 ? "" : "s"}
                        {autofillFilledFields && autofillFilledFields.length > 0
                          ? `: ${autofillFilledFields.join(", ")}`
                          : ""}
                      </p>
                      {autofillReasoning && (
                        <p className="text-[var(--text-muted)]">{autofillReasoning}</p>
                      )}
                      <p className="text-[var(--text-faint)]">
                        Review each value before saving.
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="useCase">Use Case</Label>
                <Textarea
                  id="useCase"
                  name="useCase"
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Risk Level</Label>
                  <select
                    name="riskLevel"
                    value={riskLevel}
                    onChange={(e) => setRiskLevel(e.target.value)}
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
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    placeholder="e.g. Anthropic, OpenAI, Internal"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="modelType">Model Type</Label>
                  <Input
                    id="modelType"
                    name="modelType"
                    value={modelType}
                    onChange={(e) => setModelType(e.target.value)}
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
                  value={dataSensitivity}
                  onChange={(e) => setDataSensitivity(e.target.value)}
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
                  value={dataInputs}
                  onChange={(e) => setDataInputs(e.target.value)}
                  placeholder="Describe what data this system ingests"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dataOutputs">Data Outputs</Label>
                <Textarea
                  id="dataOutputs"
                  name="dataOutputs"
                  value={dataOutputs}
                  onChange={(e) => setDataOutputs(e.target.value)}
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
