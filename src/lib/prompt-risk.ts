import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { safeCompileRegex } from "./regex-validator";
import { BUILTIN_PROMPT_RISK_RULES } from "./prompt-risk-defaults";
import { getSetting } from "./settings";
import {
  computePromptHash,
  extractUserPromptText,
  PROMPT_HASH_SETTING_KEY,
  resolvePromptHashSalt,
} from "./prompt-hash";
import {
  initialOccurrenceMetadata,
  mergePromptHashOccurrence,
  PROMPT_HASH_DEDUPE_WINDOW_MS,
  surfaceForProvider,
  type PromptRiskSurface,
} from "./prompt-risk-dedupe";

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
  /**
   * Salted HMAC fingerprint of the normalized prompt (see ./prompt-hash.ts),
   * or null when there was no prompt text or no salt is configured. Safe to
   * persist — it is what lets the same prompt be correlated across the
   * proxies, Claude Code and Cursor without storing the prompt itself.
   */
  promptHash: string | null;
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
 *
 * The extractor itself lives in ./prompt-hash.ts (extractUserPromptText) so
 * the risk analysis and the prompt hash are always computed over the same
 * text, on every surface including the Azure proxy mirror.
 */

export function sanitizeText(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g, "[private-key]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    // API keys / access tokens — keep aligned with the `secret_token_in_text`
    // rule so a matched token is never surfaced raw in a finding or alert.
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{10,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z._-]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:sk|AIza|ya29|ghp)_[A-Za-z0-9._-]+)\b/gi,
      "[secret]"
    )
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
  return analyzeText(extractUserPromptText(requestBody));
}

// ── Prompt hash salt ──
// AppSetting `prompt_hash_salt` (env fallback PROMPT_HASH_SALT via
// getSetting), then NEXTAUTH_SECRET so an install that never set a salt still
// gets stable hashes. Cached briefly; a DB outage falls through to env so the
// proxy hot path never blocks on it.
let saltCache: { value: string | null; expiresAt: number } | null = null;
const SALT_TTL_MS = 60_000;

export async function loadPromptHashSalt(): Promise<string | null> {
  if (saltCache && saltCache.expiresAt > Date.now()) return saltCache.value;
  let configured: string | null = null;
  try {
    configured = await getSetting(PROMPT_HASH_SETTING_KEY);
  } catch {
    configured = process.env.PROMPT_HASH_SALT ?? null;
  }
  const value = resolvePromptHashSalt(configured, process.env.NEXTAUTH_SECRET);
  saltCache = { value, expiresAt: Date.now() + SALT_TTL_MS };
  return value;
}

/** Test hook — drop the cached salt so the next call re-reads settings. */
export function invalidatePromptHashSaltCache() {
  saltCache = null;
}

/**
 * The prompt-risk slice of an APIUsageLog `promptMetadata` blob. `promptHash`
 * is written on EVERY logged request (so a later alert can be correlated to
 * the calls that carried the same prompt); the `promptRisk` block only when
 * the analysis flagged. Never includes prompt text — only the sanitized
 * excerpt the analysis already produced.
 */
export function promptRiskLogMetadata(analysis: PromptRiskAnalysis): {
  promptHash: string | null;
  promptRisk?: {
    severity: PromptRiskSeverity | null;
    categories: string[];
    matchedSignals: string[];
    excerpt: string | null;
    promptHash: string | null;
  };
} {
  return {
    promptHash: analysis.promptHash,
    promptRisk: analysis.flagged
      ? {
          severity: analysis.severity,
          categories: analysis.categories,
          matchedSignals: analysis.matchedSignals,
          excerpt: analysis.excerpt,
          promptHash: analysis.promptHash,
        }
      : undefined,
  };
}

// Built-in rules that detect malicious INTENT in user input. They match on
// keywords/verbs ("reveal credentials", "bypass safety", "ignore previous
// instructions"), so they false-positive on model OUTPUT — a refusal that
// explains itself ("I won't reveal credentials or bypass safety guardrails")
// trips them. Response scanning (inline DLP + leakage probe) excludes these and
// looks only for actual sensitive DATA in the text.
const INTENT_RULE_KEYS = new Set<string>([
  "prompt_injection",
  "secret_extraction",
  "data_exfiltration",
  "malware_or_phishing",
  "dangerous_autonomy",
]);

/**
 * Run the active prompt-risk rule set against an arbitrary piece of text and
 * return the same structured analysis as {@link analyzePromptRisk}. This is the
 * shared detector used for sensitive-information scanning — both the active
 * leakage probe (model responses to bait prompts) and inline response DLP at
 * the proxy — so probe findings, response findings, and prompt findings all use
 * one rule engine and one sanitizer.
 */
export async function analyzeText(
  text: string | null | undefined,
  options?: { excludeIntentRules?: boolean }
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
      promptHash: null,
    };
  }

  const [allRules, salt] = await Promise.all([loadActiveRules(), loadPromptHashSalt()]);
  const promptHash = computePromptHash(salt, promptText);
  const rules = options?.excludeIntentRules
    ? allRules.filter((r) => !INTENT_RULE_KEYS.has(r.key))
    : allRules;

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
      promptHash,
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
    promptHash,
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

/**
 * Raise (or fold into) a dangerous_prompt alert.
 *
 * Dedupe, in order:
 *  1. By prompt hash — an OPEN dangerous_prompt alert carrying the same
 *     `promptHash` from the last 24h absorbs the sighting: `occurrences`
 *     increments, the surface and actor are appended (deduped), severity
 *     only ever escalates, and `updatedAt` is touched. No second alert.
 *  2. Hash-less fallback (no salt / no prompt text): the original 1h
 *     same-title dedupe against OPEN/ACKNOWLEDGED alerts on the same system.
 */
export async function createPromptRiskAlert(input: {
  provider: string;
  model: string;
  department: string | null;
  userEmail: string | null;
  aiSystemId?: string | null;
  analysis: PromptRiskAnalysis;
  /** Where the prompt was observed. Derived from `provider` when omitted. */
  surface?: PromptRiskSurface;
}) {
  if (!input.analysis.flagged || !input.analysis.summary) return;

  // Check if all matched categories are covered by exceptions
  const suppressed = await shouldSuppressAlert(
    input.analysis.ruleKeys,
    input.analysis.matchedSignals
  );
  if (suppressed) return;

  const surface = input.surface ?? surfaceForProvider(input.provider);
  const severity = input.analysis.severity === "critical" ? "CRITICAL" : "HIGH";
  const promptHash = input.analysis.promptHash;

  if (promptHash) {
    const sameHash = await prisma.alert.findFirst({
      where: {
        source: "dangerous_prompt",
        status: "OPEN",
        createdAt: { gte: new Date(Date.now() - PROMPT_HASH_DEDUPE_WINDOW_MS) },
        promptRiskMetadata: { path: ["promptHash"], equals: promptHash },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, severity: true, promptRiskMetadata: true },
    });
    if (sameHash) {
      await prisma.alert.update({
        where: { id: sameHash.id },
        data: {
          // Escalate only; never downgrade an open CRITICAL.
          severity: sameHash.severity === "CRITICAL" ? "CRITICAL" : severity,
          promptRiskMetadata: mergePromptHashOccurrence(sameHash.promptRiskMetadata, {
            surface,
            userEmail: input.userEmail,
          }) as Prisma.InputJsonValue,
          // Explicit touch so "last seen" ordering never depends on Prisma's
          // change detection for @updatedAt.
          updatedAt: new Date(),
        },
      });
      return;
    }
  }

  const title = `Dangerous prompt signal detected: ${input.analysis.categories[0] ?? "Prompt risk"}`;
  const recentDuplicate = promptHash
    ? null
    : await prisma.alert.findFirst({
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
    promptHash,
    ...initialOccurrenceMetadata({ surface, userEmail: input.userEmail }),
  };

  if (recentDuplicate) {
    await prisma.alert.update({
      where: { id: recentDuplicate.id },
      data: {
        severity,
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
      severity,
      source: "dangerous_prompt",
      aiSystemId: input.aiSystemId ?? null,
      promptRiskMetadata: metadata,
    },
  });
}
