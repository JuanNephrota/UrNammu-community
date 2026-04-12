"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SearchCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  summary?: string | null;
  aiSystemId?: string | null;
  alertId?: string | null;
  governanceIncidentId?: string | null;
  existingInvestigationId?: string | null;
};

export function InvestigationButton({
  title,
  summary,
  aiSystemId,
  alertId,
  governanceIncidentId,
  existingInvestigationId,
}: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function handleClick() {
    if (existingInvestigationId) {
      router.push("/oversight/investigations");
      return;
    }

    setCreating(true);
    try {
      await fetch("/api/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          summary,
          aiSystemId,
          alertId,
          governanceIncidentId,
        }),
      });
      router.push("/oversight/investigations");
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={creating}>
      <SearchCheck className="mr-1.5 h-3.5 w-3.5" />
      {existingInvestigationId ? "Open Investigation" : creating ? "Creating..." : "Investigate"}
    </Button>
  );
}
