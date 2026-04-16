import { generateAIResponse } from "./ai-provider";
import { getSetting } from "./settings";

export type ClassifiedSystemFields = {
  description?: string;
  useCase?: string;
  vendor?: string;
  modelType?: string;
  dataInputs?: string;
  dataOutputs?: string;
  riskLevel?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "MINIMAL";
  dataSensitivity?: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  reasoning?: string;
};

export type DiscoveredToolInput = {
  toolName: string;
  vendor: string | null;
  detectedDomain: string | null;
  department: string | null;
  notes: string | null;
};

const SYSTEM_PROMPT = `You are an AI governance analyst helping to classify AI systems discovered in an enterprise. Given the name, vendor, domain, and usage context of a discovered AI tool, infer its characteristics using your knowledge of publicly known AI products.

Return STRICT JSON matching this schema (no markdown, no code fences):
{
  "description": string,         // 1-2 sentence plain-English summary of what the tool is
  "useCase": string,             // typical enterprise use cases (1-2 sentences)
  "vendor": string,              // the company or organization that publishes the tool (e.g. "OpenAI", "Anthropic", "Google"). Omit if unknown.
  "modelType": string,           // e.g. "LLM", "Image generation", "Code completion", "Speech-to-text", "Agentic workflow", "RAG platform", "Computer vision"
  "dataInputs": string,          // what data users typically send to it (1-2 sentences)
  "dataOutputs": string,         // what the tool produces (1-2 sentences)
  "riskLevel": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "MINIMAL",
  "dataSensitivity": "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED",
  "reasoning": string            // brief explanation of the risk and sensitivity choices (<=2 sentences)
}

Guidelines for risk level:
- CRITICAL: safety-of-life, regulated decisions (healthcare triage, autonomous vehicles).
- HIGH: broadly agentic tools with code/data write access, customer-facing decisions, potential for bias at scale.
- MEDIUM: general-purpose assistants (ChatGPT, Claude, Gemini) where users paste arbitrary data; code assistants with repo access.
- LOW: narrow-scope tools (transcription, image upscaling, grammar).
- MINIMAL: static utilities with no sensitive data exposure.

Guidelines for data sensitivity:
- RESTRICTED: customer PII, healthcare data, payment information.
- CONFIDENTIAL: source code, internal documents, product roadmaps, employee records.
- INTERNAL: general workplace communication, brainstorming, non-sensitive operations.
- PUBLIC: marketing copy, public documentation.

If you are uncertain about a field, choose the most conservative sensible value. Keep each string under 300 characters.`;

function buildUserPrompt(tool: DiscoveredToolInput): string {
  const lines = [
    `Tool name: ${tool.toolName}`,
    `Vendor: ${tool.vendor ?? "Unknown"}`,
    `Detected domain: ${tool.detectedDomain ?? "Unknown"}`,
    `Department using it: ${tool.department ?? "Unknown"}`,
  ];
  if (tool.notes) lines.push(`Discovery notes: ${tool.notes}`);
  return lines.join("\n");
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(stripCodeFences(text));
  } catch {
    // Second attempt: extract the first {...} block from a noisy response.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

const VALID_RISK = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW", "MINIMAL"]);
const VALID_SENS = new Set(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]);

function sanitize(obj: Record<string, unknown>): ClassifiedSystemFields {
  const out: ClassifiedSystemFields = {};
  const str = (k: string, max: number): string | undefined => {
    const v = obj[k];
    if (typeof v !== "string") return undefined;
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
  };

  out.description = str("description", 500);
  out.useCase = str("useCase", 500);
  out.vendor = str("vendor", 200);
  out.modelType = str("modelType", 100);
  out.dataInputs = str("dataInputs", 500);
  out.dataOutputs = str("dataOutputs", 500);
  out.reasoning = str("reasoning", 500);

  const risk = obj.riskLevel;
  if (typeof risk === "string" && VALID_RISK.has(risk)) {
    out.riskLevel = risk as ClassifiedSystemFields["riskLevel"];
  }
  const sens = obj.dataSensitivity;
  if (typeof sens === "string" && VALID_SENS.has(sens)) {
    out.dataSensitivity = sens as ClassifiedSystemFields["dataSensitivity"];
  }

  return out;
}

async function hasAIProvider(): Promise<boolean> {
  // Match the config-resolution logic in generateAIResponse: check the DB
  // setting first, then fall back to env vars. Avoids making an expensive
  // API call when nothing is configured.
  const apiKey =
    (await getSetting("ai_api_key")) ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENAI_API_KEY;
  return !!apiKey;
}

/**
 * Classify a discovered AI tool by inferring governance-relevant fields
 * (useCase, modelType, data inputs/outputs, riskLevel, dataSensitivity) from
 * the tool's name, vendor, and domain. Uses the configured AI provider.
 *
 * Returns null (never throws) when:
 *   - the AI provider is not configured
 *   - the upstream call fails or times out
 *   - the response cannot be parsed as JSON
 *
 * Callers should merge the returned partial object on top of their default
 * values — any field the model could not confidently fill will be absent.
 */
export async function classifyDiscoveredTool(
  tool: DiscoveredToolInput,
  { timeoutMs = 12_000 }: { timeoutMs?: number } = {}
): Promise<ClassifiedSystemFields | null> {
  try {
    if (!(await hasAIProvider())) return null;

    const userPrompt = buildUserPrompt(tool);
    const response = await Promise.race([
      generateAIResponse(SYSTEM_PROMPT, userPrompt),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("ai-classification timeout")), timeoutMs)
      ),
    ]);

    const parsed = parseJson(response);
    if (!parsed) return null;
    return sanitize(parsed);
  } catch (err) {
    console.warn("[ai-classification] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
