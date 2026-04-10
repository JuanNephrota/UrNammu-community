"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AISystemFormProps {
  initialData?: {
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
  };
}

export function AISystemForm({ initialData }: AISystemFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!initialData?.id;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get("name") as string,
      description: formData.get("description") as string,
      version: formData.get("version") as string,
      department: formData.get("department") as string,
      riskLevel: formData.get("riskLevel") as string,
      status: formData.get("status") as string,
      useCase: formData.get("useCase") as string,
      dataSensitivity: formData.get("dataSensitivity") as string,
      vendor: formData.get("vendor") as string,
      modelType: formData.get("modelType") as string,
      dataInputs: formData.get("dataInputs") as string,
      dataOutputs: formData.get("dataOutputs") as string,
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
      {error && (
        <div className="rounded-md bg-red-500/10 p-3 text-sm text-[var(--critical)]">
          {error}
        </div>
      )}

      <Tabs defaultValue="basic">
        <TabsList>
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="technical">Technical Details</TabsTrigger>
          <TabsTrigger value="data">Data Classification</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
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
                    <option value="APPROVED">Approved</option>
                    <option value="DEPLOYED">Deployed</option>
                    <option value="DEPRECATED">Deprecated</option>
                    <option value="RETIRED">Retired</option>
                  </select>
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

        <TabsContent value="technical">
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

        <TabsContent value="data">
          <Card>
            <CardHeader>
              <CardTitle>Data Classification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Data Sensitivity Level</Label>
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
