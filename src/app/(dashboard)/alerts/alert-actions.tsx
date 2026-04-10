"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function AlertActions({ alertId }: { alertId: string }) {
  const router = useRouter();

  async function updateStatus(status: string) {
    await fetch(`/api/alerts/${alertId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={() => updateStatus("ACKNOWLEDGED")}>
        Acknowledge
      </Button>
      <Button size="sm" variant="outline" onClick={() => updateStatus("RESOLVED")}>
        Resolve
      </Button>
      <Button size="sm" variant="ghost" onClick={() => updateStatus("DISMISSED")}>
        Dismiss
      </Button>
    </div>
  );
}
