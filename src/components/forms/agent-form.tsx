"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AutonomyHelpTooltip } from "@/components/ui/autonomy-tooltip";
import { HelpHint } from "@/components/help/help-hint";

interface AgentFormProps {
  initialData?: {
    id?: string;
    name: string;
    description: string | null;
    aiSystemId: string | null;
    capabilities: string[];
    accessLevel: string;
    autonomyLevel: string;
    connectedSystems: string[];
    humanReviewRequired: boolean;
    riskLevel: string;
    status: string;
    department: string | null;
  };
  systems: { id: string; name: string }[];
}

export function AgentForm({ initialData, systems }: AgentFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>(
    initialData?.capabilities ?? []
  );
  const [connectedSystems, setConnectedSystems] = useState<string[]>(
    initialData?.connectedSystems ?? []
  );
  const [capInput, setCapInput] = useState("");
  const [sysInput, setSysInput] = useState("");

  const isEditing = !!initialData?.id;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get("name") as string,
      description: formData.get("description") as string,
      aiSystemId: (formData.get("aiSystemId") as string) || undefined,
      capabilities,
      accessLevel: formData.get("accessLevel") as string,
      autonomyLevel: formData.get("autonomyLevel") as string,
      connectedSystems,
      humanReviewRequired: formData.get("humanReviewRequired") === "true",
      riskLevel: formData.get("riskLevel") as string,
      status: formData.get("status") as string,
      department: formData.get("department") as string,
    };

    try {
      const url = isEditing ? `/api/agents/${initialData.id}` : "/api/agents";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      const agent = await res.json();
      router.push(`/agents/${agent.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function addChip(value: string, list: string[], setter: (v: string[]) => void, inputSetter: (v: string) => void) {
    const trimmed = value.trim();
    if (trimmed && !list.includes(trimmed)) {
      setter([...list, trimmed]);
    }
    inputSetter("");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-[var(--critical)]/10 p-3 text-sm text-[var(--critical)]">{error}</div>
      )}

      <Card>
        <CardHeader><CardTitle>Agent Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Agent Name *</Label>
              <Input id="name" name="name" defaultValue={initialData?.name ?? ""} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Input id="department" name="department" defaultValue={initialData?.department ?? ""} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" defaultValue={initialData?.description ?? ""} rows={2} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Parent AI System</Label>
              <select name="aiSystemId" defaultValue={initialData?.aiSystemId ?? ""} className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
                <option value="">None</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Access Level</Label>
              <select name="accessLevel" defaultValue={initialData?.accessLevel ?? "read-only"} className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
                <option value="read-only">Read Only</option>
                <option value="read-write">Read Write</option>
                <option value="admin">Admin</option>
                <option value="restricted">Restricted</option>
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                Autonomy Level
                <AutonomyHelpTooltip />
              </Label>
              <select name="autonomyLevel" defaultValue={initialData?.autonomyLevel ?? "HUMAN_IN_THE_LOOP"} className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
                <option value="MANUAL">Manual</option>
                <option value="HUMAN_IN_THE_LOOP">Human in the Loop</option>
                <option value="HUMAN_ON_THE_LOOP">Human on the Loop</option>
                <option value="SUPERVISED">Supervised</option>
                <option value="FULL_AUTONOMY">Full Autonomy</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Risk Level</Label>
              <select name="riskLevel" defaultValue={initialData?.riskLevel ?? "MEDIUM"} className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
                <option value="MINIMAL">Minimal</option>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <select name="status" defaultValue={initialData?.status ?? "DRAFT"} className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
                <option value="DRAFT">Draft</option>
                <option value="UNDER_REVIEW">Under Review</option>
                <option value="APPROVED">Approved</option>
                <option value="DEPLOYED">Deployed</option>
                <option value="DEPRECATED">Deprecated</option>
                <option value="RETIRED">Retired</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              Human Review Required
              <HelpHint hint="human_review_triggers" />
            </Label>
            <select name="humanReviewRequired" defaultValue={initialData?.humanReviewRequired ? "true" : "false"} className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Capabilities</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Add capability..." value={capInput} onChange={(e) => setCapInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChip(capInput, capabilities, setCapabilities, setCapInput); }}} />
            <Button type="button" variant="outline" onClick={() => addChip(capInput, capabilities, setCapabilities, setCapInput)}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {capabilities.map((cap) => (
              <span key={cap} className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-dim)] px-3 py-1 text-xs font-medium text-[var(--accent)]">
                {cap}
                <button type="button" onClick={() => setCapabilities(capabilities.filter((c) => c !== cap))} className="ml-1 hover:text-[var(--critical)]">&times;</button>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Connected Systems
            <HelpHint hint="connected_systems" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Add connected system..." value={sysInput} onChange={(e) => setSysInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChip(sysInput, connectedSystems, setConnectedSystems, setSysInput); }}} />
            <Button type="button" variant="outline" onClick={() => addChip(sysInput, connectedSystems, setConnectedSystems, setSysInput)}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {connectedSystems.map((sys) => (
              <span key={sys} className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-xs font-medium text-[var(--text-primary)]">
                {sys}
                <button type="button" onClick={() => setConnectedSystems(connectedSystems.filter((s) => s !== sys))} className="ml-1 hover:text-[var(--critical)]">&times;</button>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" disabled={loading} className="bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110">
          {loading ? "Saving..." : isEditing ? "Update Agent" : "Register Agent"}
        </Button>
      </div>
    </form>
  );
}
