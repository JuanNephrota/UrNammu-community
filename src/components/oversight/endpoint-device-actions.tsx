"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Revoke / re-activate a device.
 *
 * Revocation is destructive in the way that matters: it invalidates the
 * device's token, and re-running the installer will not bring it back — the
 * server refuses to re-enroll a revoked machineId. So it confirms first, and
 * the re-activate path says plainly that the machine must re-enroll.
 */
export function EndpointDeviceActions({
  deviceId,
  status,
}: {
  deviceId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoked = status === "REVOKED";

  async function setStatus(next: "ACTIVE" | "REVOKED") {
    const message = revoked
      ? "Re-activate this device? The agent must re-enroll before it can report again — its previous token cannot be recovered."
      : "Revoke this device? Its token stops working immediately, and reinstalling the agent will not re-enroll it.";
    if (!window.confirm(message)) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/endpoint-agent/devices/${deviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: next,
          statusReason:
            next === "REVOKED" ? "Revoked from the console." : "Re-activated from the console.",
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${response.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={revoked ? "outline" : "destructive"}
        disabled={busy}
        onClick={() => setStatus(revoked ? "ACTIVE" : "REVOKED")}
      >
        {busy ? "Working…" : revoked ? "Re-activate device" : "Revoke device"}
      </Button>
      {error && <span className="text-xs text-[var(--critical)]">{error}</span>}
    </div>
  );
}
