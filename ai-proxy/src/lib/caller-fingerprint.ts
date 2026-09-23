// MIRROR of src/lib/caller-fingerprint.ts — keep identical below this banner.
// Enforced by scripts/check-mirror-drift.mjs.
/**
 * Caller fingerprinting for proxied model calls — the capture half of proxy
 * agent discovery (docs/plans/agent-discovery.md, gap 1).
 *
 * From request headers alone, identify *what kind of client* made a call
 * (agent framework, vendor SDK, interactive coding assistant) and a salted,
 * non-reversible handle for *which credential* it used. The detection job in
 * `proxy-agent-detection.ts` groups usage rows on these to find agents that
 * never sent `x-agent-id`.
 *
 * Pure and dependency-free apart from node:crypto, because it is MIRRORED
 * byte-for-byte into ai-proxy/src/lib/caller-fingerprint.ts
 * (scripts/check-mirror-drift.mjs). No request content is read — headers only
 * — and the key itself never leaves this function.
 */
import { createHmac } from "node:crypto";

/** Minimal header reader satisfied by both Fetch `Headers` and NextRequest. */
export type HeaderReader = { get(name: string): string | null };

export type ClientKind = "agent_framework" | "llm_library" | "assistant" | "sdk" | "unknown";

export type ClientFingerprint = {
  /** Detected framework or assistant id, e.g. "openai_agents", "claude_code". */
  framework: string | null;
  kind: ClientKind;
  /** Vendor SDK and language, e.g. "anthropic-python 0.49.0". */
  sdk: string | null;
  /** Raw User-Agent, truncated. Header metadata, never content. */
  userAgent: string | null;
  /** HMAC of the upstream credential; null without a salt or a key. */
  keyHash: string | null;
};

type ClientPattern = { id: string; label: string; kind: Exclude<ClientKind, "sdk" | "unknown">; pattern: RegExp };

/**
 * Ordered: the first match wins, so specific patterns precede generic ones
 * (Claude Agent SDK and Claude Code share the `claude-cli` product token and
 * differ only in the entrypoint comment).
 */
export const CLIENT_PATTERNS: readonly ClientPattern[] = [
  // Claude Agent SDK drives the Claude Code runtime with an sdk-* entrypoint.
  { id: "claude_agent_sdk", label: "Claude Agent SDK", kind: "agent_framework", pattern: /claude-cli\/\S+ \([^)]*\bsdk-(?:ts|py|cli)\b/i },
  { id: "claude_code", label: "Claude Code", kind: "assistant", pattern: /claude-cli\/|claude-code\/|claude-vscode\//i },
  { id: "openai_agents", label: "OpenAI Agents SDK", kind: "agent_framework", pattern: /\bAgents\/(?:Python|JavaScript|TypeScript|JS)\b|openai-agents/i },
  { id: "pydantic_ai", label: "Pydantic AI", kind: "agent_framework", pattern: /pydantic-ai\//i },
  { id: "semantic_kernel", label: "Semantic Kernel", kind: "agent_framework", pattern: /semantic-kernel/i },
  { id: "langgraph", label: "LangGraph", kind: "agent_framework", pattern: /langgraph/i },
  { id: "crewai", label: "CrewAI", kind: "agent_framework", pattern: /crewai/i },
  { id: "autogen", label: "AutoGen", kind: "agent_framework", pattern: /autogen/i },
  { id: "mastra", label: "Mastra", kind: "agent_framework", pattern: /mastra/i },
  { id: "strands", label: "Strands Agents", kind: "agent_framework", pattern: /strands-agents/i },
  { id: "google_adk", label: "Google ADK", kind: "agent_framework", pattern: /google-adk/i },
  { id: "smolagents", label: "smolagents", kind: "agent_framework", pattern: /smolagents/i },
  { id: "langchain", label: "LangChain", kind: "llm_library", pattern: /langchain/i },
  { id: "llamaindex", label: "LlamaIndex", kind: "llm_library", pattern: /llama[-_]?index/i },
  { id: "vercel_ai_sdk", label: "Vercel AI SDK", kind: "llm_library", pattern: /\bai-sdk\//i },
  { id: "litellm", label: "LiteLLM", kind: "llm_library", pattern: /litellm/i },
  // Interactive coding assistants: governed as tools, not agents.
  { id: "cursor", label: "Cursor", kind: "assistant", pattern: /cursor/i },
  { id: "github_copilot", label: "GitHub Copilot", kind: "assistant", pattern: /copilot/i },
  { id: "codex_cli", label: "Codex CLI", kind: "assistant", pattern: /codex_cli|codex-cli/i },
  { id: "cline", label: "Cline", kind: "assistant", pattern: /\bcline\b|roo-?code/i },
  { id: "continue", label: "Continue", kind: "assistant", pattern: /continue(?:dev)?\//i },
  { id: "windsurf", label: "Windsurf", kind: "assistant", pattern: /windsurf|codeium/i },
  { id: "aider", label: "Aider", kind: "assistant", pattern: /\baider\b/i },
  { id: "zed", label: "Zed", kind: "assistant", pattern: /\bzed\//i },
];

export const CLIENT_LABELS: Record<string, string> = Object.fromEntries(
  CLIENT_PATTERNS.map((p) => [p.id, p.label])
);

export const USER_AGENT_MAX_CHARS = 160;
export const KEY_HASH_LENGTH = 16;

/** Vendor SDK product tokens, e.g. "Anthropic/Python 0.49.0", "OpenAI/JS 4.8". */
const SDK_UA = /\b(Anthropic|OpenAI|AzureOpenAI|google-genai|GoogleGenerativeAI)\/(Python|JS|Node|TypeScript|Go|Java|Ruby|\.NET)?\s*v?([\d.]+)?/i;

function detectSdk(headers: HeaderReader, userAgent: string | null): string | null {
  // Stainless-generated SDKs (Anthropic, OpenAI) send structured headers.
  const lang = headers.get("x-stainless-lang");
  const version = headers.get("x-stainless-package-version");
  const vendor = userAgent?.match(/^(Anthropic|OpenAI)/i)?.[1]?.toLowerCase() ?? null;
  if (lang) {
    return [vendor ? `${vendor}-${lang}` : lang, version].filter(Boolean).join(" ").slice(0, 60);
  }
  const match = userAgent?.match(SDK_UA);
  if (!match) return null;
  return [`${match[1].toLowerCase()}${match[2] ? `-${match[2].toLowerCase()}` : ""}`, match[3]]
    .filter(Boolean)
    .join(" ")
    .slice(0, 60);
}

export function classifyClient(userAgent: string | null): { framework: string | null; kind: ClientKind } {
  if (!userAgent) return { framework: null, kind: "unknown" };
  for (const entry of CLIENT_PATTERNS) {
    if (entry.pattern.test(userAgent)) return { framework: entry.id, kind: entry.kind };
  }
  return { framework: null, kind: "unknown" };
}

/**
 * The upstream credential a caller presented, from whichever header the
 * provider uses. For client-signed Bedrock requests only the SigV4 access key
 * id is taken — never the signature.
 */
export function extractCallerCredential(headers: HeaderReader, url?: string | null): string | null {
  for (const name of ["x-api-key", "api-key", "x-goog-api-key"]) {
    const value = headers.get(name)?.trim();
    if (value) return value;
  }
  const auth = headers.get("authorization")?.trim();
  if (auth) {
    const sigv4 = auth.match(/^AWS4-HMAC-SHA256\s+Credential=([A-Z0-9]+)\//i);
    if (sigv4) return `aws:${sigv4[1]}`;
    const bearer = auth.match(/^Bearer\s+(.+)$/i);
    if (bearer?.[1]?.trim()) return bearer[1].trim();
  }
  if (url) {
    try {
      const key = new URL(url, "http://localhost").searchParams.get("key");
      if (key) return key;
    } catch {
      // Unparseable URL: no credential from the query string.
    }
  }
  return null;
}

export function hashCallerCredential(salt: string | null | undefined, credential: string | null): string | null {
  if (!salt || !credential) return null;
  return createHmac("sha256", salt)
    .update(`caller-key:${credential}`, "utf8")
    .digest("hex")
    .slice(0, KEY_HASH_LENGTH);
}

/**
 * Fingerprint one request. `salt` is the prompt-hash salt (same chain in both
 * proxies); a distinct HMAC prefix keeps key hashes from colliding with
 * prompt hashes computed under the same salt.
 */
export function fingerprintCaller(input: {
  headers: HeaderReader;
  url?: string | null;
  salt: string | null | undefined;
}): ClientFingerprint {
  // Match on a bounded prefix: framework tokens lead the header, and an
  // oversized User-Agent should not cost regex time on the hot path.
  const rawUa = input.headers.get("user-agent")?.trim().slice(0, 512) || null;
  const userAgent = rawUa ? rawUa.slice(0, USER_AGENT_MAX_CHARS) : null;
  const { framework, kind } = classifyClient(rawUa);
  const sdk = detectSdk(input.headers, rawUa);
  return {
    framework,
    kind: kind === "unknown" && sdk ? "sdk" : kind,
    sdk,
    userAgent,
    keyHash: hashCallerCredential(input.salt, extractCallerCredential(input.headers, input.url)),
  };
}
