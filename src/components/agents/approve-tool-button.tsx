"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Adds an observed server/tool to the agent's MCP allowlist. */
export function ApproveToolButton({
  agentId,
  serverName,
  toolName,
}: {
  agentId: string;
  serverName: string | null;
  toolName: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/mcp-allowlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverName, toolName }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={approve} disabled={loading} title="Add to allowlist">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        Approve
      </Button>
      {error && <span className="text-[10px] text-[var(--critical)]">{error}</span>}
    </span>
  );
}
