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
import { HumanReviewTriggersEditor } from "@/components/agents/human-review-triggers-editor";
import { normalizeHumanReviewTriggers, type HumanReviewTrigger } from "@/lib/human-review-triggers";

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
    mcpServerAllowlist?: string[];
    mcpToolAllowlist?: string[];
    mcpEnforcement?: string;
    purpose?: string | null;
    inScopeActions?: string[];
    outOfScopeActions?: string[];
    decisionBoundaries?: string | null;
    successCriteria?: string | null;
    requireOwnerApproval?: boolean;
    requireSecurityApproval?: boolean;
    requireLegalApproval?: boolean;
    requireComplianceApproval?: boolean;
    reviewIntervalDays?: number;
    humanReviewTriggers?: unknown;
    humanReviewEnforcement?: string;
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
  const [mcpServers, setMcpServers] = useState<string[]>(initialData?.mcpServerAllowlist ?? []);
  const [mcpTools, setMcpTools] = useState<string[]>(initialData?.mcpToolAllowlist ?? []);
  const [mcpServerInput, setMcpServerInput] = useState("");
  const [mcpToolInput, setMcpToolInput] = useState("");
  const [inScope, setInScope] = useState<string[]>(initialData?.inScopeActions ?? []);
  const [outOfScope, setOutOfScope] = useState<string[]>(initialData?.outOfScopeActions ?? []);
  const [inScopeInput, setInScopeInput] = useState("");
  const [outOfScopeInput, setOutOfScopeInput] = useState("");
  const [reviewTriggers, setReviewTriggers] = useState<HumanReviewTrigger[]>(() =>
    normalizeHumanReviewTriggers(initialData?.humanReviewTriggers)
  );
  const [reviewEnforcement, setReviewEnforcement] = useState<"monitor" | "enforce">(
    initialData?.humanReviewEnforcement === "enforce" ? "enforce" : "monitor"
  );

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
      mcpServerAllowlist: mcpServers,
      mcpToolAllowlist: mcpTools,
      mcpEnforcement: (formData.get("mcpEnforcement") as string) || "monitor",
      // Charter. Empty strings are sent as-is; the API normalises them to null.
      purpose: formData.get("purpose") as string,
      inScopeActions: inScope,
      outOfScopeActions: outOfScope,
      decisionBoundaries: formData.get("decisionBoundaries") as string,
      successCriteria: formData.get("successCriteria") as string,
      requireOwnerApproval: formData.get("requireOwnerApproval") === "on",
      requireSecurityApproval: formData.get("requireSecurityApproval") === "on",
      requireLegalApproval: formData.get("requireLegalApproval") === "on",
      requireComplianceApproval: formData.get("requireComplianceApproval") === "on",
      reviewIntervalDays: Number(formData.get("reviewIntervalDays") || 365),
      humanReviewTriggers: reviewTriggers,
      humanReviewEnforcement: reviewEnforcement,
    };

    try {
      const url = isEditing ? `/api/agents/${initialData.id}` : "/api/agents";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const detail = Array.isArray(payload.blockers) && payload.blockers.length
          ? `\n• ${payload.blockers.map((b: { message: string }) => b.message).join("\n• ")}`
          : "";
        throw new Error(`${payload.error ?? "Failed to save"}${detail}`);
      }
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
        <div className="whitespace-pre-line rounded-md bg-[var(--critical)]/10 p-3 text-sm text-[var(--critical)]">{error}</div>
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

      <Card id="human-review" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Human Review Triggers
            <HelpHint hint="human_review_triggers" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-[var(--text-muted)]">
            Both proxies check every tool call the model makes against these triggers, using the call&apos;s
            arguments. Tool patterns accept <code className="rounded bg-[var(--bg-elevated)] px-1 py-0.5 text-[var(--accent)]">tool</code>,{" "}
            <code className="rounded bg-[var(--bg-elevated)] px-1 py-0.5 text-[var(--accent)]">server/tool</code>,{" "}
            <code className="rounded bg-[var(--bg-elevated)] px-1 py-0.5 text-[var(--accent)]">server/*</code> and wildcards.
          </p>
          <HumanReviewTriggersEditor
            value={reviewTriggers}
            onChange={setReviewTriggers}
            enforcement={reviewEnforcement}
            onEnforcementChange={setReviewEnforcement}
          />
        </CardContent>
      </Card>

      <Card id="charter" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Agent Charter
            <HelpHint hint="agent_charter" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-[var(--text-muted)]">
            Define what the agent is for and where it must stop before anyone approves it. Purpose, at least one
            in-scope action and the decision boundaries are required for approval; the rest is recommended.
          </p>
          <div className="space-y-2">
            <Label htmlFor="purpose">Purpose *</Label>
            <Textarea id="purpose" name="purpose" defaultValue={initialData?.purpose ?? ""} rows={2}
              placeholder="The business outcome this agent exists to produce, in one or two sentences." />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>In-scope actions *</Label>
              <div className="flex gap-2">
                <Input placeholder="e.g. issue refund ≤ $100" value={inScopeInput} onChange={(e) => setInScopeInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChip(inScopeInput, inScope, setInScope, setInScopeInput); }}} />
                <Button type="button" variant="outline" onClick={() => addChip(inScopeInput, inScope, setInScope, setInScopeInput)}>Add</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {inScope.map((a) => (
                  <span key={a} className="inline-flex items-center gap-1 rounded-full bg-[var(--success-dim)] px-3 py-1 text-xs font-medium text-[var(--success-strong)]">
                    {a}
                    <button type="button" onClick={() => setInScope(inScope.filter((x) => x !== a))} className="ml-1 hover:text-[var(--critical)]">&times;</button>
                  </span>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Out-of-scope actions</Label>
              <div className="flex gap-2">
                <Input placeholder="e.g. change a shipping address" value={outOfScopeInput} onChange={(e) => setOutOfScopeInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChip(outOfScopeInput, outOfScope, setOutOfScope, setOutOfScopeInput); }}} />
                <Button type="button" variant="outline" onClick={() => addChip(outOfScopeInput, outOfScope, setOutOfScope, setOutOfScopeInput)}>Add</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {outOfScope.map((a) => (
                  <span key={a} className="inline-flex items-center gap-1 rounded-full bg-[var(--critical-dim)] px-3 py-1 text-xs font-medium text-[var(--critical-strong)]">
                    {a}
                    <button type="button" onClick={() => setOutOfScope(outOfScope.filter((x) => x !== a))} className="ml-1 hover:text-[var(--critical)]">&times;</button>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="decisionBoundaries">Decision boundaries *</Label>
            <Textarea id="decisionBoundaries" name="decisionBoundaries" defaultValue={initialData?.decisionBoundaries ?? ""} rows={3}
              placeholder="Thresholds, data classes or situations where the agent must stop and hand off to a person." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="successCriteria">Success criteria</Label>
            <Textarea id="successCriteria" name="successCriteria" defaultValue={initialData?.successCriteria ?? ""} rows={2}
              placeholder="How you will know it is working, and what would make you retire it." />
          </div>
        </CardContent>
      </Card>

      <Card id="approval-requirements" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Approval Requirements
            <HelpHint hint="agent_approval_stages" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["requireOwnerApproval", "Owner review", initialData?.requireOwnerApproval ?? true],
              ["requireSecurityApproval", "Security review", initialData?.requireSecurityApproval ?? true],
              ["requireLegalApproval", "Legal review", initialData?.requireLegalApproval ?? false],
              ["requireComplianceApproval", "Compliance review", initialData?.requireComplianceApproval ?? true],
            ] as const).map(([name, label, checked]) => (
              <label key={name} className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-sm">
                <input type="checkbox" name={name} defaultChecked={checked} className="h-4 w-4 accent-[var(--accent)]" />
                {label}
              </label>
            ))}
          </div>
          <div className="space-y-2 sm:max-w-xs">
            <Label htmlFor="reviewIntervalDays">Review interval (days)</Label>
            <Input id="reviewIntervalDays" name="reviewIntervalDays" type="number" min={1} max={730}
              defaultValue={initialData?.reviewIntervalDays ?? 365} />
            <p className="text-xs text-[var(--text-muted)]">Each recorded approval restarts this clock.</p>
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

      <Card id="mcp" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            MCP Tool Governance
            <HelpHint hint="mcp_governance" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-[var(--text-muted)]">
            Governs the MCP servers this agent may connect to and the tools it may invoke when its model calls
            go through the proxy with <code className="rounded bg-[var(--bg-elevated)] px-1 py-0.5 text-[var(--accent)]">x-agent-id</code>.
            Leave a list empty to observe without restricting.
          </p>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              Enforcement
              <HelpHint hint="mcp_enforcement" />
            </Label>
            <select name="mcpEnforcement" defaultValue={initialData?.mcpEnforcement ?? "monitor"} className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none">
              <option value="monitor">Monitor — record and alert, never block</option>
              <option value="enforce">Enforce — block unlisted servers, narrow allowed_tools</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              Allowed MCP servers
              <HelpHint hint="mcp_allowlist" />
            </Label>
            <div className="flex gap-2">
              <Input placeholder="server name, host, or *.example.com" value={mcpServerInput} onChange={(e) => setMcpServerInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChip(mcpServerInput, mcpServers, setMcpServers, setMcpServerInput); }}} />
              <Button type="button" variant="outline" onClick={() => addChip(mcpServerInput, mcpServers, setMcpServers, setMcpServerInput)}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {mcpServers.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-full bg-[var(--success-dim)] px-3 py-1 font-mono text-xs font-medium text-[var(--success-strong)]">
                  {s}
                  <button type="button" onClick={() => setMcpServers(mcpServers.filter((x) => x !== s))} className="ml-1 hover:text-[var(--critical)]">&times;</button>
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Allowed MCP tools</Label>
            <div className="flex gap-2">
              <Input placeholder="tool, server/tool, or server/*" value={mcpToolInput} onChange={(e) => setMcpToolInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChip(mcpToolInput, mcpTools, setMcpTools, setMcpToolInput); }}} />
              <Button type="button" variant="outline" onClick={() => addChip(mcpToolInput, mcpTools, setMcpTools, setMcpToolInput)}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {mcpTools.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[var(--success-dim)] px-3 py-1 font-mono text-xs font-medium text-[var(--success-strong)]">
                  {t}
                  <button type="button" onClick={() => setMcpTools(mcpTools.filter((x) => x !== t))} className="ml-1 hover:text-[var(--critical)]">&times;</button>
                </span>
              ))}
            </div>
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
