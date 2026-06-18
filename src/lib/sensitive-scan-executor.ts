import { prisma } from "./prisma";
import { getSetting, SENSITIVE_SCAN_SETTINGS_KEYS } from "./settings";
import { analyzeText } from "./prompt-risk";
import { recordSensitiveFinding } from "./sensitive-alerts";
import { generateAIResponse, getAIConfig } from "./ai-provider";
import { LITELLM_SETTINGS, isLiteLLMConfigured, getLiteLLMModelInfo } from "./litellm-admin";
import { PORTKEY_SETTINGS, isPortkeyConfigured } from "./portkey-admin";
import { SENSITIVE_PROBES } from "./sensitive-probes";

const PROBE_SYSTEM_PROMPT =
  "You are a helpful assistant. Follow your configured policies.";

export type ProbeTargetStatus = "probed" | "skipped" | "error";

export type ProbeTargetResult = {
  id: string;
  label: string;
  status: ProbeTargetStatus;
  model: string | null;
  findings: number;
  /** Why a target was skipped or errored — surfaced in the scan response. */
  reason?: string;
};

export interface SensitiveScanResult {
  scanId: string;
  status: "completed" | "failed";
  targetsProbed: number;
  findingsFound: number;
  criticalCount: number;
  targets: ProbeTargetResult[];
  errorMessage?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function extractOpenAiText(json: unknown): string {
  const choices = asRecord(json).choices;
  if (!Array.isArray(choices)) return "";
  const message = asRecord(choices[0]).message;
  const content = asRecord(message).content;
  return typeof content === "string" ? content : "";
}

// ── Active provider (Anthropic / OpenAI via ai-provider.ts) ──

async function resolveActiveProvider(): Promise<{
  configured: boolean;
  provider: string;
  model: string;
}> {
  // Reuse the shared resolver so the probe's model (and "latest" resolution)
  // matches what generateAIResponse actually sends.
  const { provider, model, apiKey } = await getAIConfig();
  return { configured: !!apiKey, provider, model };
}

// ── LiteLLM (OpenAI-compatible inference proxy) ──

async function pickLiteLLMModel(): Promise<string | null> {
  const override = await getSetting(SENSITIVE_SCAN_SETTINGS_KEYS.LITELLM_PROBE_MODEL);
  if (override) return override;
  try {
    const info = await getLiteLLMModelInfo();
    const data = asRecord(info).data;
    if (Array.isArray(data)) {
      for (const row of data) {
        const name = asRecord(row).model_name;
        if (typeof name === "string" && name) return name;
      }
    }
  } catch {
    // fall through — caller treats null as "no model available"
  }
  return null;
}

async function litellmChatProbe(model: string, prompt: string): Promise<string> {
  const [apiKey, baseRaw] = await Promise.all([
    getSetting(LITELLM_SETTINGS.API_KEY),
    getSetting(LITELLM_SETTINGS.API_BASE_URL),
  ]);
  const base = (baseRaw ?? "").replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: PROBE_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    throw new Error(`LiteLLM chat error (${res.status}): ${res.statusText}`);
  }
  return extractOpenAiText(await res.json());
}

// ── Portkey (gateway — only routable with a virtual key) ──

async function portkeyChatProbe(
  virtualKey: string,
  model: string,
  prompt: string
): Promise<string> {
  const [apiKey, baseRaw] = await Promise.all([
    getSetting(PORTKEY_SETTINGS.API_KEY),
    getSetting(PORTKEY_SETTINGS.API_BASE_URL),
  ]);
  const base = (baseRaw ?? "https://api.portkey.ai/v1").replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "x-portkey-api-key": apiKey ?? "",
      "x-portkey-virtual-key": virtualKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: PROBE_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    throw new Error(`Portkey chat error (${res.status}): ${res.statusText}`);
  }
  return extractOpenAiText(await res.json());
}

/**
 * Run every built-in probe against every reachable provider, detect sensitive
 * information in the responses, and persist sanitized findings + alerts.
 *
 * Reachable = LiteLLM, the active Anthropic/OpenAI provider, and Portkey (only
 * if a virtual key is configured). Helicone and OpenRouter store
 * management-only credentials and are reported "not probeable" rather than
 * failing the scan.
 */
export async function executeSensitiveScan(
  triggeredBy: string
): Promise<SensitiveScanResult> {
  const scan = await prisma.sensitiveScan.create({
    data: { status: "running", triggeredBy },
  });

  const targets: ProbeTargetResult[] = [];
  let findingsFound = 0;
  let criticalCount = 0;

  // Runs all probes against one provider via `call(probePrompt) => responseText`.
  const probeProvider = async (
    target: ProbeTargetResult,
    call: (prompt: string) => Promise<string>
  ) => {
    for (const probe of SENSITIVE_PROBES) {
      try {
        const responseText = await call(probe.prompt);
        const analysis = await analyzeText(responseText);
        const recorded = await recordSensitiveFinding({
          source: "probe",
          provider: target.id,
          model: target.model,
          probeLabel: probe.label,
          analysis,
          scanId: scan.id,
        });
        if (recorded) {
          findingsFound++;
          target.findings++;
          if (recorded.severity === "critical") criticalCount++;
        }
      } catch (err) {
        // One probe/provider failing must not abort the whole scan.
        target.status = "error";
        target.reason =
          err instanceof Error ? err.message : "Probe request failed";
      }
    }
  };

  try {
    // 1) Active provider
    const active = await resolveActiveProvider();
    const activeTarget: ProbeTargetResult = {
      id: "active_provider",
      label: `Active provider (${active.provider})`,
      status: active.configured ? "probed" : "skipped",
      model: active.model,
      findings: 0,
      reason: active.configured
        ? undefined
        : "No API key configured (Settings > General)",
    };
    if (active.configured) {
      await probeProvider(activeTarget, (prompt) =>
        generateAIResponse(PROBE_SYSTEM_PROMPT, prompt)
      );
    }
    targets.push(activeTarget);

    // 2) LiteLLM
    const litellmTarget: ProbeTargetResult = {
      id: "litellm",
      label: "LiteLLM",
      status: "skipped",
      model: null,
      findings: 0,
    };
    if (await isLiteLLMConfigured()) {
      const model = await pickLiteLLMModel();
      if (model) {
        litellmTarget.model = model;
        litellmTarget.status = "probed";
        await probeProvider(litellmTarget, (prompt) =>
          litellmChatProbe(model, prompt)
        );
      } else {
        litellmTarget.reason = "No models available from the LiteLLM proxy";
      }
    } else {
      litellmTarget.reason = "Not configured (Settings > Provider Admin APIs)";
    }
    targets.push(litellmTarget);

    // 3) Portkey — only routable with a virtual key
    const portkeyTarget: ProbeTargetResult = {
      id: "portkey",
      label: "Portkey",
      status: "skipped",
      model: null,
      findings: 0,
    };
    const portkeyVirtualKey = await getSetting(
      SENSITIVE_SCAN_SETTINGS_KEYS.PORTKEY_VIRTUAL_KEY
    );
    if (!(await isPortkeyConfigured())) {
      portkeyTarget.reason = "Not configured (Settings > Provider Admin APIs)";
    } else if (!portkeyVirtualKey) {
      portkeyTarget.reason =
        "Not probeable — set a probe virtual key in Settings > Shadow AI to route through the gateway";
    } else {
      const model =
        (await getSetting(SENSITIVE_SCAN_SETTINGS_KEYS.LITELLM_PROBE_MODEL)) ??
        "gpt-4o-mini";
      portkeyTarget.model = model;
      portkeyTarget.status = "probed";
      await probeProvider(portkeyTarget, (prompt) =>
        portkeyChatProbe(portkeyVirtualKey, model, prompt)
      );
    }
    targets.push(portkeyTarget);

    // 4) Management-only credentials — not inference-probeable
    targets.push({
      id: "helicone",
      label: "Helicone",
      status: "skipped",
      model: null,
      findings: 0,
      reason: "Not probeable — observability gateway, no inference endpoint",
    });
    targets.push({
      id: "openrouter",
      label: "OpenRouter",
      status: "skipped",
      model: null,
      findings: 0,
      reason: "Not probeable — only a provisioning (key-management) credential is stored",
    });

    const targetsProbed = targets.filter((t) => t.status === "probed").length;

    await prisma.sensitiveScan.update({
      where: { id: scan.id },
      data: {
        status: "completed",
        targetsProbed,
        findingsFound,
        criticalCount,
        completedAt: new Date(),
      },
    });

    return {
      scanId: scan.id,
      status: "completed",
      targetsProbed,
      findingsFound,
      criticalCount,
      targets,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    await prisma.sensitiveScan.update({
      where: { id: scan.id },
      data: { status: "failed", errorMessage, completedAt: new Date() },
    });
    return {
      scanId: scan.id,
      status: "failed",
      targetsProbed: 0,
      findingsFound,
      criticalCount,
      targets,
      errorMessage,
    };
  }
}
