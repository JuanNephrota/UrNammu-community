"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VENDOR_QUESTION_SECTIONS } from "@/lib/vendor-questionnaire";

export function StartVendorAssessment({ profileId, vendor }: { profileId: string; vendor: string }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/vendor-assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorProfileId: profileId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not start the questionnaire");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the questionnaire");
      setStarting(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Assess {vendor}</CardTitle>
        <p className="text-sm text-[var(--text-muted)]">
          Work through each section with the vendor&rsquo;s trust documentation (SOC 2 report, DPA, security page) to
          hand. Answers save as you go, so you can stop and resume. At the end you record a security review decision.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-2">
          {VENDOR_QUESTION_SECTIONS.map((section, index) => (
            <li key={section.id} className="flex gap-3 text-sm">
              <span className="w-5 text-right tabular-nums text-[var(--text-faint)]">{index + 1}.</span>
              <span>
                <span className="font-medium text-[var(--text-primary)]">{section.title}</span>
                <span className="text-[var(--text-muted)]"> · {section.description}</span>
              </span>
            </li>
          ))}
        </ol>
        {error && (
          <p role="alert" className="text-sm text-[var(--critical-strong)]">
            {error}
          </p>
        )}
        <Button onClick={start} disabled={starting}>
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
          Start questionnaire
        </Button>
      </CardContent>
    </Card>
  );
}
