"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FalsePositiveDialog } from "./false-positive-dialog";

type PromptRiskMeta = {
  categories?: string[];
  ruleKeys?: string[];
  [key: string]: unknown;
};

export function AlertActions({
  alertId,
  promptRiskMetadata,
}: {
  alertId: string;
  promptRiskMetadata?: PromptRiskMeta | null;
}) {
  const router = useRouter();
  const [fpOpen, setFpOpen] = useState(false);

  async function updateStatus(status: string) {
    await fetch(`/api/alerts/${alertId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  const ruleKeys = promptRiskMetadata?.ruleKeys ?? [];
  const categories = promptRiskMetadata?.categories ?? [];

  return (
    <>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => updateStatus("ACKNOWLEDGED")}>
          Acknowledge
        </Button>
        <Button size="sm" variant="outline" onClick={() => updateStatus("RESOLVED")}>
          Resolve
        </Button>
        {promptRiskMetadata && ruleKeys.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setFpOpen(true)}>
            False Positive
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => updateStatus("DISMISSED")}>
            Dismiss
          </Button>
        )}
      </div>
      {promptRiskMetadata && (
        <FalsePositiveDialog
          alertId={alertId}
          ruleKeys={ruleKeys}
          categories={categories}
          open={fpOpen}
          onOpenChange={setFpOpen}
        />
      )}
    </>
  );
}
