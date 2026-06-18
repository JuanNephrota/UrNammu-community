import { prisma } from "./prisma";
import { safeCompileRegex } from "./regex-validator";
import { BUILTIN_PROMPT_RISK_RULES } from "./prompt-risk-defaults";

type PromptRiskSeverity = "critical" | "warning";

type CompiledRule = {
  key: string;
  label: string;
  severity: PromptRiskSeverity;
  patterns: RegExp[];
};

// In-memory cache for compiled rules. Refreshed on TTL expiry or when
// invalidateRuleCache() is called (after a mutation).
let ruleCache: { rules: CompiledRule[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;
// When the DB is unreachable we serve built-in rules, but only briefly — so
// that admins' overrides take effect as soon as Postgres is back.
const FALLBACK_TTL_MS = 5_000;

export function invalidateRuleCache() {
  ruleCache = null;
}

function compileRules(
  rows: Array<{ key: string; label: string; severity: string; patterns: string[] }>
): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const row of rows) {
    const patterns = row.patterns
      .map((src) => safeCompileRegex(src))
      .filter((p): p is RegExp => p !== null);
    if (patterns.length === 0) continue; // skip rules with all-broken patterns
    const severity: PromptRiskSeverity =
      row.severity === "critical" ? "critical" : "warning";
    compiled.push({
      key: row.key,
      label: row.label,
      severity,
      patterns,
    });
  }
  return compiled;
}

async function loadActiveRules(): Promise<CompiledRule[]> {
  if (ruleCache && ruleCache.expiresAt > Date.now()) {
    return ruleCache.rules;
  }

  // Fall back to built-in rules if the DB is unreachable (CI without
  // Postgres, cold starts, transient outages). Admin edits in the DB still
  // win whenever it's reachable; this path only covers the failure case so
  // the proxy doesn't 500 and unit tests don't require a live database.
  try {
    const rows = await prisma.promptRiskRule.findMany({
      where: { enabled: true },
      orderBy: { key: "asc" },
    });
    const compiled = compileRules(rows);
    ruleCache = { rules: compiled, expiresAt: Date.now() + CACHE_TTL_MS };
    return compiled;
  } catch {
    const fallback = compileRules(BUILTIN_PROMPT_RISK_RULES);
    ruleCache = { rules: fallback, expiresAt: Date.now() + FALLBACK_TTL_MS };
    return fallback;
  }
}

/**
 * A single rule's match detail — preserves the grouping lost by the flat
 * `matchedSignals` list so investigators can see which signals triggered
 * which rule without having to cross-reference by index.
 */
export type RuleMatch = {
  key: string;
  label: string;
  severity: PromptRiskSeverity;
  signals: string[];
};

export type PromptRiskAnalysis = {
  flagged: boolean;
  severity: PromptRiskSeverity | null;
  flagReason: string | null;
  summary: string | null;
  categories: string[];        // legacy flat list, kept for backward compat
  ruleKeys: string[];          // legacy flat list, kept for backward compat
  matchedSignals: string[];    // legacy flat list, kept for backward compat
  ruleMatches: RuleMatch[];    // NEW: per-rule grouping for investigation UI
  excerpt: string | null;      // short sanitized excerpt (≤220 chars)
  fullExcerpt: string | null;  // longer sanitized excerpt (≤2000 chars)
};

/**
 * Extract only **user-authored** text from a request body. We deliberately
 * skip:
 *
 * -  `system` / `instructions` — developer-controlled, not end-user input.
 * -  `role: "assistant"` messages — contain `tool_use` blocks with bash
 *    commands, file edits, and other programmatic content that legitimately
 *    includes keywords like "reverse shell", "credentials", "delete records",
 *    etc. Scanning these produces massive false-positive noise, especially
 *    from Claude Code.
 * -  `role: "tool"` messages (OpenAI) and `type: "tool_result"` content
 *    blocks (Anthropic) — tool outputs, not user text.
 * -  `type: "tool_use"` content blocks inside any message — the model's own
 *    tool invocations.
 *
 * What we DO scan: `role: "user"` message text, excluding tool_result
 * sub-blocks. This is the surface where prompt injection and social
 * engineering actually originate.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractUserTextFromContentBlocks(blocks: unknown, acc: string[]) {
  if (typeof blocks === "string") {
    acc.push(blocks);
    return;
  }
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (typeof block === "string") {
      acc.push(block);
      continue;
    }
    if (!isRecord(block)) continue;
    // Skip tool_result and tool_use content blocks entirely.
    if (block.type === "tool_result" || block.type === "tool_use") continue;
    // Accept text blocks.
    if (block.type === "text" && typeof block.text === "string") {
      acc.push(block.text);
    }
  }
}

function extractPromptText(requestBody: Record<string, unknown> | null | undefined): string {
  if (!requestBody) return "";
  const parts: string[] = [];

  // Anthropic: messages is [{ role, content }]
  // OpenAI:    messages is [{ role, content }]
  const messages = requestBody.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!isRecord(msg)) continue;
      const role = msg.role;
      // Only scan user messages.
      if (role !== "user") continue;
      extractUserTextFromContentBlocks(msg.content, parts);
    }
  }

  // Bare `prompt` field (legacy / non-chat APIs) — treat as user text.
  if (typeof requestBody.prompt === "string") {
    parts.push(requestBody.prompt);
  }

  return parts.join("\n").slice(0, 8000);
}

export function sanitizeText(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g, "[private-key]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:sk|AIza|ya29|ghp)_[A-Za-z0-9._-]+\b/g, "[secret]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[aws-key]")
    // Payment card (major brand prefixes, optional separators) — redact before
    // the generic \d{6,} rule, which wouldn't catch dash/space-grouped cards.
    .replace(/\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[ -]?\d{4}[ -]?\d{4}[ -]?\d{2,4}\b/g, "[card]")
    // US SSN — grouped digits are individually < 6 chars, so \d{6,} misses them.
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[ssn]")
    .replace(/\b\d{6,}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

function sanitizeExcerpt(value: string | null, maxLength = 220): string | null {
  const cleaned = sanitizeText(value);
  if (!cleaned) return null;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3)}...` : cleaned;
}

export async function analyzePromptRisk(
  requestBody: Record<string, unknown> | null | undefined
): Promise<PromptRiskAnalysis> {
  return analyzeText(extractPromptText(requestBody));
}

/**
 * Run the active prompt-risk rule set against an arbitrary piece of text and
 * return the same structured analysis as {@link analyzePromptRisk}. This is the
 * shared detector used for sensitive-information scanning — both the active
 * leakage probe (model responses to bait prompts) and inline response DLP at
 * the proxy — so probe findings, response findings, and prompt findings all use
 * one rule engine and one sanitizer.
 */
export async function analyzeText(
  text: string | null | undefined
): Promise<PromptRiskAnalysis> {
  const promptText = (text ?? "").slice(0, 8000);
  if (!promptText) {
    return {
      flagged: false,
      severity: null,
      flagReason: null,
      summary: null,
      categories: [],
      ruleKeys: [],
      matchedSignals: [],
      ruleMatches: [],
      excerpt: null,
      fullExcerpt: null,
    };
  }

  const rules = await loadActiveRules();

  const categories: string[] = [];
  const ruleKeys: string[] = [];
  const matchedSignals: string[] = [];
  const ruleMatches: RuleMatch[] = [];
  let severity: PromptRiskSeverity | null = null;

  for (const rule of rules) {
    const matches = rule.patterns
      .map((pattern) => promptText.match(pattern)?.[0] ?? null)
      .filter((value): value is string => !!value);

    if (matches.length === 0) continue;

    // Sanitize matched substrings before they are surfaced or persisted —
    // rules like `sensitive_data_in_prompt` match literal SSNs / card numbers /
    // private keys, and the raw match must never land in alert metadata.
    const uniqueMatches = [...new Set(matches)]
      .map((m) => sanitizeText(m) ?? "[redacted]")
      .slice(0, 5);
    categories.push(rule.label);
    ruleKeys.push(rule.key);
    matchedSignals.push(...uniqueMatches.slice(0, 3));
    ruleMatches.push({
      key: rule.key,
      label: rule.label,
      severity: rule.severity,
      signals: uniqueMatches,
    });
    if (severity !== "critical") {
      severity = rule.severity === "critical" ? "critical" : severity ?? "warning";
    }
  }

  if (categories.length === 0) {
    return {
      flagged: false,
      severity: null,
      flagReason: null,
      summary: null,
      categories: [],
      ruleKeys: [],
      matchedSignals: [],
      ruleMatches: [],
      excerpt: sanitizeExcerpt(promptText),
      fullExcerpt: sanitizeExcerpt(promptText, 2000),
    };
  }

  const summary =
    categories.length === 1
      ? categories[0]
      : `${categories[0]} plus ${categories.length - 1} additional prompt-risk signal${categories.length === 2 ? "" : "s"}`;

  return {
    flagged: true,
    severity,
    flagReason: summary,
    summary,
    categories,
    ruleKeys,
    matchedSignals: [...new Set(matchedSignals)].slice(0, 6),
    ruleMatches,
    excerpt: sanitizeExcerpt(promptText),
    fullExcerpt: sanitizeExcerpt(promptText, 2000),
  };
}

/**
 * Check whether all matched rule keys are covered by active exceptions.
 * Returns true only when EVERY ruleKey has at least one matching exception.
 */
export async function shouldSuppressAlert(
  ruleKeys: string[],
  matchedSignals: string[]
): Promise<boolean> {
  if (ruleKeys.length === 0) return false;

  const exceptions = await prisma.promptRiskException.findMany({
    where: {
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      category: { in: ruleKeys },
    },
  });

  if (exceptions.length === 0) return false;

  // Check each ruleKey has at least one matching exception
  for (const key of ruleKeys) {
    const keyExceptions = exceptions.filter((e) => e.category === key);
    if (keyExceptions.length === 0) return false;

    // A blanket exception (pattern=null) covers the whole category
    const hasBlanket = keyExceptions.some((e) => !e.pattern);
    if (hasBlanket) continue;

    // Pattern-based exceptions: at least one signal must match one exception pattern
    const patternMatch = keyExceptions.some((exc) =>
      matchedSignals.some((signal) =>
        signal.toLowerCase().includes((exc.pattern ?? "").toLowerCase())
      )
    );
    if (!patternMatch) return false;
  }

  return true;
}

export async function createPromptRiskAlert(input: {
  provider: string;
  model: string;
  department: string | null;
  userEmail: string | null;
  aiSystemId?: string | null;
  analysis: PromptRiskAnalysis;
}) {
  if (!input.analysis.flagged || !input.analysis.summary) return;

  // Check if all matched categories are covered by exceptions
  const suppressed = await shouldSuppressAlert(
    input.analysis.ruleKeys,
    input.analysis.matchedSignals
  );
  if (suppressed) return;

  const title = `Dangerous prompt signal detected: ${input.analysis.categories[0] ?? "Prompt risk"}`;
  const recentDuplicate = await prisma.alert.findFirst({
    where: {
      source: "dangerous_prompt",
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
      aiSystemId: input.aiSystemId ?? null,
      title,
      createdAt: {
        gte: new Date(Date.now() - 60 * 60 * 1000),
      },
    },
  });

  const descriptionParts = [
    `Provider: ${input.provider}`,
    `Model: ${input.model}`,
    input.department ? `Department: ${input.department}` : null,
    input.userEmail ? `User: ${input.userEmail}` : null,
    `Signals: ${input.analysis.categories.join(", ")}`,
    input.analysis.excerpt ? `Excerpt: ${input.analysis.excerpt}` : null,
  ].filter(Boolean);

  const metadata = {
    provider: input.provider,
    model: input.model,
    department: input.department,
    userEmail: input.userEmail,
    categories: input.analysis.categories,
    ruleKeys: input.analysis.ruleKeys,
    matchedSignals: input.analysis.matchedSignals,
    ruleMatches: input.analysis.ruleMatches,
    excerpt: input.analysis.excerpt,
    fullExcerpt: input.analysis.fullExcerpt,
  };

  if (recentDuplicate) {
    await prisma.alert.update({
      where: { id: recentDuplicate.id },
      data: {
        severity: input.analysis.severity === "critical" ? "CRITICAL" : "HIGH",
        description: descriptionParts.join(" · "),
        promptRiskMetadata: metadata,
      },
    });
    return;
  }

  await prisma.alert.create({
    data: {
      title,
      description: descriptionParts.join(" · "),
      severity: input.analysis.severity === "critical" ? "CRITICAL" : "HIGH",
      source: "dangerous_prompt",
      aiSystemId: input.aiSystemId ?? null,
      promptRiskMetadata: metadata,
    },
  });
}
