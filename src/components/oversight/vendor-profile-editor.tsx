"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateForInput } from "@/lib/utils";

type Props = {
  vendor: string;
  contractStatus: string;
  contractOwner: string | null;
  contractRenewalDate: string | null;
  securityReviewStatus: string;
  dataResidency: string[];
  approvedUseCases: string[];
  subprocessors: string[];
  notes: string | null;
};

export function VendorProfileEditor({
  vendor,
  contractStatus,
  contractOwner,
  contractRenewalDate,
  securityReviewStatus,
  dataResidency,
  approvedUseCases,
  subprocessors,
  notes,
}: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setSaving(true);
    setResult(null);

    const payload = {
      vendor,
      contractStatus: String(formData.get("contractStatus") ?? "UNKNOWN"),
      contractOwner: String(formData.get("contractOwner") ?? ""),
      contractRenewalDate: String(formData.get("contractRenewalDate") ?? ""),
      securityReviewStatus: String(
        formData.get("securityReviewStatus") ?? "NOT_REVIEWED"
      ),
      dataResidency: String(formData.get("dataResidency") ?? ""),
      approvedUseCases: String(formData.get("approvedUseCases") ?? ""),
      subprocessors: String(formData.get("subprocessors") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    };

    try {
      const res = await fetch("/api/vendor-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save vendor profile");
      }

      setResult("Vendor profile saved.");
      router.refresh();
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Failed to save vendor profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="rounded-lg border border-[var(--border-subtle)] p-3">
      <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]">
        Edit vendor profile
      </summary>
      <form action={handleSubmit} className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="space-y-2">
          <Label>Contract Status</Label>
          <select
            name="contractStatus"
            defaultValue={contractStatus}
            className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
          >
            {["UNKNOWN", "IN_REVIEW", "ACTIVE", "EXPIRED", "TERMINATED"].map((value) => (
              <option key={value} value={value}>{value.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label>Security Review Status</Label>
          <select
            name="securityReviewStatus"
            defaultValue={securityReviewStatus}
            className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
          >
            {["NOT_REVIEWED", "IN_PROGRESS", "APPROVED", "CONDITIONAL", "REJECTED"].map((value) => (
              <option key={value} value={value}>{value.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label>Contract Owner</Label>
          <Input name="contractOwner" defaultValue={contractOwner ?? ""} placeholder="Legal or procurement owner" />
        </div>
        <div className="space-y-2">
          <Label>Contract Renewal Date</Label>
          <Input
            type="date"
            name="contractRenewalDate"
            defaultValue={formatDateForInput(contractRenewalDate)}
          />
        </div>
        <div className="space-y-2 xl:col-span-2">
          <Label>Data Residency</Label>
          <Input name="dataResidency" defaultValue={dataResidency.join(", ")} placeholder="US, EU, Canada" />
        </div>
        <div className="space-y-2 xl:col-span-2">
          <Label>Subprocessors</Label>
          <Input name="subprocessors" defaultValue={subprocessors.join(", ")} placeholder="AWS, Azure, Cloudflare" />
        </div>
        <div className="space-y-2 xl:col-span-2">
          <Label>Approved Use Cases</Label>
          <Textarea
            name="approvedUseCases"
            defaultValue={approvedUseCases.join(", ")}
            rows={2}
            placeholder="Code generation, internal knowledge search, contract drafting"
          />
        </div>
        <div className="space-y-2 xl:col-span-2">
          <Label>Notes</Label>
          <Textarea
            name="notes"
            defaultValue={notes ?? ""}
            rows={3}
            placeholder="Contract carve-outs, data-processing notes, regional restrictions, approval conditions"
          />
        </div>
        <div className="xl:col-span-2 flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Vendor Profile"}
          </Button>
          {result ? (
            <p className="text-sm text-[var(--text-muted)]">{result}</p>
          ) : null}
        </div>
      </form>
    </details>
  );
}
