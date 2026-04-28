"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Check, Loader2, KeyRound, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models — Sonnet, Opus, Haiku",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    ],
    keyPlaceholder: "sk-ant-...",
    color: "var(--accent)",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o, o1, and other ChatGPT models",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "o1", name: "o1" },
      { id: "o1-mini", name: "o1 Mini" },
    ],
    keyPlaceholder: "sk-...",
    color: "var(--success)",
  },
];

interface Props {
  currentProvider: string;
  currentModel: string;
  hasApiKey: boolean;
}

export function AIProviderSettings({ currentProvider, currentModel, hasApiKey }: Props) {
  const router = useRouter();
  const [provider, setProvider] = useState(currentProvider);
  const [model, setModel] = useState(currentModel);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  const selectedProvider = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

  // Reset model when provider changes
  function handleProviderChange(newProvider: string) {
    setProvider(newProvider);
    const p = PROVIDERS.find((pr) => pr.id === newProvider);
    if (p) setModel(p.models[0].id);
    setSaveResult(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);

    const updates: Record<string, string | null> = {
      ai_provider: provider,
      ai_model: model,
    };
    if (apiKey.trim()) {
      updates.ai_api_key = apiKey.trim();
    }

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setSaveResult("AI provider settings saved.");
        setApiKey("");
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent)]" />
          AI Provider
        </CardTitle>
        <CardDescription>
          Choose which AI provider powers risk assessments, compliance analysis, and other AI features.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Provider selection */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Cpu className="h-3.5 w-3.5" />
            Provider
          </Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {PROVIDERS.map((p) => {
              const isSelected = provider === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleProviderChange(p.id)}
                  className="flex items-center gap-3 rounded-lg border p-3 text-left transition-all"
                  style={{
                    borderColor: isSelected ? p.color : "var(--border-subtle)",
                    backgroundColor: isSelected ? `color-mix(in srgb, ${p.color} 6%, var(--bg-base))` : "var(--bg-base)",
                  }}
                >
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-md"
                    style={{
                      backgroundColor: isSelected ? `color-mix(in srgb, ${p.color} 15%, transparent)` : "var(--bg-elevated)",
                    }}
                  >
                    <Sparkles className="h-4 w-4" style={{ color: isSelected ? p.color : "var(--text-muted)" }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: isSelected ? p.color : "var(--text-primary)" }}>
                      {p.name}
                    </p>
                    <p className="text-[11px] text-[var(--text-faint)]">{p.description}</p>
                  </div>
                  {isSelected && (
                    <Check className="ml-auto h-4 w-4 shrink-0" style={{ color: p.color }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Model selection */}
        <div className="space-y-2">
          <Label>Model</Label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
          >
            {selectedProvider.models.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        {/* API Key */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5" />
            API Key
          </Label>
          {hasApiKey ? (
            <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3">
              <Check className="h-4 w-4 text-[var(--success)]" />
              <span className="text-sm text-[var(--text-muted)] flex-1">API key is configured</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const el = document.getElementById("ai-key-replace");
                  if (el) el.classList.toggle("hidden");
                }}
              >
                Replace
              </Button>
            </div>
          ) : null}
          <div id="ai-key-replace" className={hasApiKey ? "hidden" : ""}>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={selectedProvider.keyPlaceholder}
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-[var(--text-faint)] mt-1">
              Stored securely. Never exposed in the UI after saving.
            </p>
          </div>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving..." : "Save AI Settings"}
          </Button>
          {saveResult && (
            <p className={`text-sm font-medium ${saveResult.includes("saved") ? "text-[var(--success)]" : "text-[var(--critical)]"}`}>
              {saveResult}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
