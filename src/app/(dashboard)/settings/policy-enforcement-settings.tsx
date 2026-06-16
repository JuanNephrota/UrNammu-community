"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, ShieldCheck, ShieldAlert, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { PolicyEnforcementMode } from "@/lib/settings";

const MODES: Array<{
  id: PolicyEnforcementMode;
  name: string;
  description: string;
  iconKey: "off" | "dryrun" | "enforce";
  color: string;
}> = [
  {
    id: "off",
    name: "Off",
    description: "Proxy ignores policies. Requests always pass through. Safe default.",
    iconKey: "off",
    color: "var(--text-muted)",
  },
  {
    id: "dryrun",
    name: "Dry run",
    description:
      "Proxy evaluates policies and records denial events, but still forwards the request. Useful for tuning rules before turning on enforcement.",
    iconKey: "dryrun",
    color: "var(--warning)",
  },
  {
    id: "enforce",
    name: "Enforce",
    description:
      "Proxy returns 403 on blocking policy violations. Request never reaches the upstream provider.",
    iconKey: "enforce",
    color: "var(--critical)",
  },
];

function IconForMode({ id }: { id: PolicyEnforcementMode }) {
  if (id === "off") return <Shield className="h-4 w-4" />;
  if (id === "dryrun") return <ShieldAlert className="h-4 w-4" />;
  return <ShieldCheck className="h-4 w-4" />;
}

interface Props {
  currentMode: PolicyEnforcementMode;
}

export function PolicyEnforcementSettings({ currentMode }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<PolicyEnforcementMode>(currentMode);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy_enforcement_mode: mode }),
      });
      if (res.ok) {
        setSaveResult("Policy enforcement mode saved.");
        router.refresh();
      } else {
        const data = await res.json();
        setSaveResult(`Failed: ${data.error}`);
      }
    } catch {
      setSaveResult("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const isDirty = mode !== currentMode;
  const switchingToEnforce = isDirty && mode === "enforce";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[var(--accent)]" />
          Policy Enforcement
        </CardTitle>
        <CardDescription>
          Controls whether the proxy blocks API requests that violate assigned
          policies. Defaults to off. Per-policy rules still evaluate for UI and
          approval workflows regardless of this setting.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Mode</Label>
          <div className="grid gap-2">
            {MODES.map((m) => {
              const isSelected = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setMode(m.id);
                    setSaveResult(null);
                  }}
                  className="flex items-start gap-3 rounded-lg border p-3 text-left transition-all"
                  style={{
                    borderColor: isSelected ? m.color : "var(--border-subtle)",
                    backgroundColor: isSelected
                      ? `color-mix(in srgb, ${m.color} 6%, var(--bg-base))`
                      : "var(--bg-base)",
                  }}
                >
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-md"
                    style={{
                      backgroundColor: isSelected
                        ? `color-mix(in srgb, ${m.color} 15%, transparent)`
                        : "var(--bg-elevated)",
                      color: isSelected ? m.color : "var(--text-muted)",
                    }}
                  >
                    <IconForMode id={m.id} />
                  </div>
                  <div className="flex-1">
                    <p
                      className="text-sm font-medium"
                      style={{ color: isSelected ? m.color : "var(--text-primary)" }}
                    >
                      {m.name}
                    </p>
                    <p className="text-[11px] text-[var(--text-faint)] leading-snug mt-0.5">
                      {m.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {switchingToEnforce && (
          <div
            className="flex items-start gap-3 rounded-lg border p-3 text-sm"
            style={{
              borderColor: "var(--critical)",
              backgroundColor: "color-mix(in srgb, var(--critical) 6%, var(--bg-base))",
            }}
          >
            <AlertTriangle className="h-4 w-4 text-[var(--critical)] mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-[var(--critical)]">
                You are about to enable enforcement.
              </p>
              <p className="text-[var(--text-muted)] mt-1">
                Requests that violate any active policy with{" "}
                <code>enforcement: BLOCK</code> will be rejected with a 403
                before reaching the upstream provider. Consider running in{" "}
                <strong>Dry run</strong> first to see which requests would be
                denied.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
          <Button onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving..." : "Save Enforcement Mode"}
          </Button>
          {saveResult && (
            <p
              className={`text-sm font-medium ${
                saveResult.includes("saved")
                  ? "text-[var(--success)]"
                  : "text-[var(--critical)]"
              }`}
            >
              {saveResult}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
