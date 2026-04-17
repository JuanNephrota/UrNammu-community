"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  configured: boolean;
}

export function SyncButton({ configured }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/registry/skills/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(`Sync failed: ${body.errorMessage ?? body.error ?? res.statusText}`);
      } else {
        const parts = [
          `Synced ${body.skillsFetched}`,
          `${body.skillsCreated} new`,
          `${body.skillsUpdated} updated`,
        ];
        if ((body.agentsLinked ?? 0) > 0) parts.push(`${body.agentsLinked} agent(s) created`);
        if ((body.systemsLinked ?? 0) > 0) parts.push(`${body.systemsLinked} system(s) created`);
        setMessage(parts.join(" · ") + ".");
        start(() => router.refresh());
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {message ? (
        <span
          className={`text-xs font-medium ${
            message.startsWith("Synced")
              ? "text-[var(--success)]"
              : "text-[var(--critical)]"
          }`}
        >
          {message}
        </span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        onClick={handleSync}
        disabled={saving || pending || !configured}
        title={configured ? undefined : "Configure the Forge API key in Settings → General"}
      >
        {saving ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        {saving ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}
