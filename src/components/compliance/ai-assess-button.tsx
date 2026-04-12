"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  policyId: string;
  aiSystemId: string;
  systemName: string;
}

export function AIAssessButton({ policyId, aiSystemId, systemName }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAssess() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/ai/assess-compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId, aiSystemId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Assessment failed (${res.status})`);
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assessment failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={handleAssess}
        disabled={loading}
        title={`Assess ${systemName} compliance with AI`}
      >
        {loading ? (
          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
        ) : (
          <Sparkles className="mr-1.5 h-3 w-3" />
        )}
        {loading ? "Assessing..." : "Assess with AI"}
      </Button>
      {error && (
        <p className="text-[11px] text-[var(--critical)] max-w-[200px] text-right">
          {error}
        </p>
      )}
    </div>
  );
}
