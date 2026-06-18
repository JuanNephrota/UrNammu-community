/**
 * Sensitive-information detection for the Azure proxy.
 *
 * This is a self-contained PORT of the main app's `src/lib/prompt-risk.ts` +
 * `sensitive-alerts.ts` — the ai-proxy is a separate project with its own
 * Prisma client and cannot import from the Next.js app. It runs the same
 * admin-configurable rule set against model RESPONSES (inline DLP) and records
 * sanitized findings + alerts.
 *
 * Keep the built-in rules below in sync with the main app's
 * `src/lib/prompt-risk-defaults.ts`. DB rules win when reachable; built-ins are
 * the cold-start / outage fallback.
 */
import { prisma } from "./db";

type Severity = "critical" | "warning";

type BuiltInRule = {
  key: string;
  label: string;
  severity: Severity;
  patterns: string[];
};

// Mirror of src/lib/prompt-risk-defaults.ts — the rules that actually fire on
// response text are the data-presence ones; the imperative-verb rules rarely
// match a model's own output but are kept for parity.
const BUILTIN_RULES: BuiltInRule[] = [
  {
    key: "secret_extraction",
    label: "Secret or credential extraction attempt",
    severity: "critical",
    patterns: [
      "\\b(api keys?|access tokens?|bearer tokens?|auth tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?|env(ironment)? (?:variables?|vars?)|\\.env|connection strings?|service account keys?|aws (?:secret|access) keys?)\\b.{0,40}\\b(reveal|extract|dump|steal|copy|exfiltrate|leak|send|email|upload|paste|post)\\b",
      "\\b(reveal|extract|dump|steal|copy|exfiltrate|leak|send|email|upload|paste|post)\\b.{0,40}\\b(api keys?|access tokens?|bearer tokens?|auth tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?|env(ironment)? (?:variables?|vars?)|\\.env|connection strings?|service account keys?|aws (?:secret|access) keys?)\\b",
    ],
  },
  {
    key: "data_exfiltration",
    label: "Sensitive data exfiltration attempt",
    severity: "critical",
    patterns: [
      "\\b(dump|extract|exfiltrate|steal|leak|email|upload)\\b.{0,60}\\b(customer data|client data|employee data|user data|payroll|salary data|bank account|routing number|pii|phi|ssn|social security|passport|credit card|date of birth|driver'?s licen[sc]e|medical record|patient record|health record)\\b",
    ],
  },
  {
    key: "sensitive_data_in_prompt",
    label: "Sensitive data pasted into prompt",
    severity: "critical",
    patterns: [
      "\\b\\d{3}-\\d{2}-\\d{4}\\b",
      "\\b(?:4\\d{3}|5[1-5]\\d{2}|3[47]\\d{2}|6011)[ -]?\\d{4}[ -]?\\d{4}[ -]?\\d{2,4}\\b",
      "-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----",
      "\\bAKIA[0-9A-Z]{16}\\b",
    ],
  },
];

function safeCompileRegex(source: string): RegExp | null {
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

type CompiledRule = { key: string; label: string; severity: Severity; patterns: RegExp[] };

let ruleCache: { rules: CompiledRule[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;
const FALLBACK_TTL_MS = 5_000;

function compileRules(
  rows: Array<{ key: string; label: string; severity: string; patterns: string[] }>
): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const row of rows) {
    const patterns = row.patterns
      .map((src) => safeCompileRegex(src))
      .filter((p): p is RegExp => p !== null);
    if (patterns.length === 0) continue;
    compiled.push({
      key: row.key,
      label: row.label,
      severity: row.severity === "critical" ? "critical" : "warning",
      patterns,
    });
  }
  return compiled;
}

async function loadActiveRules(): Promise<CompiledRule[]> {
  if (ruleCache && ruleCache.expiresAt > Date.now()) return ruleCache.rules;
  try {
    const rows = await prisma.promptRiskRule.findMany({
      where: { enabled: true },
      orderBy: { key: "asc" },
    });
    const compiled = compileRules(rows);
    ruleCache = { rules: compiled, expiresAt: Date.now() + CACHE_TTL_MS };
    return compiled;
  } catch {
    const fallback = compileRules(BUILTIN_RULES);
    ruleCache = { rules: fallback, expiresAt: Date.now() + FALLBACK_TTL_MS };
    return fallback;
  }
}

export function sanitizeText(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g, "[private-key]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:sk|AIza|ya29|ghp)_[A-Za-z0-9._-]+\b/g, "[secret]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[aws-key]")
    .replace(/\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[ -]?\d{4}[ -]?\d{4}[ -]?\d{2,4}\b/g, "[card]")
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

export type SensitiveAnalysis = {
  flagged: boolean;
  severity: Severity | null;
  summary: string | null;
  categories: string[];
  ruleKeys: string[];
  matchedSignals: string[];
  excerpt: string | null;
  fullExcerpt: string | null;
};

const EMPTY_ANALYSIS: SensitiveAnalysis = {
  flagged: false,
  severity: null,
  summary: null,
  categories: [],
  ruleKeys: [],
  matchedSignals: [],
  excerpt: null,
  fullExcerpt: null,
};

/** Run the active rule set against arbitrary text (here: a model response). */
export async function analyzeText(text: string | null | undefined): Promise<SensitiveAnalysis> {
  const body = (text ?? "").slice(0, 8000);
  if (!body) return EMPTY_ANALYSIS;

  const rules = await loadActiveRules();
  const categories: string[] = [];
  const ruleKeys: string[] = [];
  const matchedSignals: string[] = [];
  let severity: Severity | null = null;

  for (const rule of rules) {
    const matches = rule.patterns
      .map((p) => body.match(p)?.[0] ?? null)
      .filter((v): v is string => !!v);
    if (matches.length === 0) continue;

    const uniqueMatches = [...new Set(matches)]
      .map((m) => sanitizeText(m) ?? "[redacted]")
      .slice(0, 3);
    categories.push(rule.label);
    ruleKeys.push(rule.key);
    matchedSignals.push(...uniqueMatches);
    if (severity !== "critical") {
      severity = rule.severity === "critical" ? "critical" : severity ?? "warning";
    }
  }

  if (categories.length === 0) return EMPTY_ANALYSIS;

  const summary =
    categories.length === 1
      ? categories[0]
      : `${categories[0]} plus ${categories.length - 1} additional signal${categories.length === 2 ? "" : "s"}`;

  return {
    flagged: true,
    severity,
    summary,
    categories,
    ruleKeys,
    matchedSignals: [...new Set(matchedSignals)].slice(0, 6),
    excerpt: sanitizeExcerpt(body),
    fullExcerpt: sanitizeExcerpt(body, 2000),
  };
}

/** Returns true when every matched rule is covered by an active exception. */
async function shouldSuppressAlert(ruleKeys: string[], matchedSignals: string[]): Promise<boolean> {
  if (ruleKeys.length === 0) return false;
  let exceptions: Array<{ category: string; pattern: string | null }>;
  try {
    exceptions = await prisma.promptRiskException.findMany({
      where: {
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        category: { in: ruleKeys },
      },
      select: { category: true, pattern: true },
    });
  } catch {
    return false; // fail open to alerting if exception lookup fails
  }
  if (exceptions.length === 0) return false;

  for (const key of ruleKeys) {
    const keyExceptions = exceptions.filter((e) => e.category === key);
    if (keyExceptions.length === 0) return false;
    if (keyExceptions.some((e) => !e.pattern)) continue;
    const patternMatch = keyExceptions.some((exc) =>
      matchedSignals.some((s) => s.toLowerCase().includes((exc.pattern ?? "").toLowerCase()))
    );
    if (!patternMatch) return false;
  }
  return true;
}

const SENSITIVE_ALERT_SOURCE = "sensitive_info";

async function createSensitiveAlert(input: {
  provider: string;
  model: string | null;
  analysis: SensitiveAnalysis;
  aiSystemId: string | null;
}): Promise<string> {
  const title = `Sensitive data in model response: ${input.analysis.categories[0] ?? "sensitive info"}`;
  const severity = input.analysis.severity === "critical" ? "CRITICAL" : "HIGH";

  const recentDuplicate = await prisma.alert.findFirst({
    where: {
      source: SENSITIVE_ALERT_SOURCE,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
      aiSystemId: input.aiSystemId,
      title,
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });

  const descriptionParts = [
    "Source: inline response DLP (proxy)",
    `Provider: ${input.provider}`,
    input.model ? `Model: ${input.model}` : null,
    `Signals: ${input.analysis.categories.join(", ")}`,
    input.analysis.excerpt ? `Excerpt: ${input.analysis.excerpt}` : null,
  ].filter(Boolean) as string[];

  const metadata = {
    findingSource: "response_dlp",
    provider: input.provider,
    model: input.model,
    categories: input.analysis.categories,
    ruleKeys: input.analysis.ruleKeys,
    matchedSignals: input.analysis.matchedSignals,
    excerpt: input.analysis.excerpt,
    fullExcerpt: input.analysis.fullExcerpt,
  };

  if (recentDuplicate) {
    await prisma.alert.update({
      where: { id: recentDuplicate.id },
      data: { severity, description: descriptionParts.join(" · "), promptRiskMetadata: metadata },
    });
    return recentDuplicate.id;
  }

  const alert = await prisma.alert.create({
    data: {
      title,
      description: descriptionParts.join(" · "),
      severity,
      source: SENSITIVE_ALERT_SOURCE,
      aiSystemId: input.aiSystemId,
      promptRiskMetadata: metadata,
    },
  });
  return alert.id;
}

/**
 * Detect sensitive info in a model response, persist a sanitized finding, and
 * raise (or fold into) an alert — unless an active exception covers it. Safe to
 * call fire-and-forget; never throws. Returns the analysis for flag bookkeeping.
 */
export async function scanResponseForSensitiveInfo(input: {
  provider: string;
  model: string | null;
  aiSystemId: string | null;
  responseText: string;
}): Promise<SensitiveAnalysis> {
  const analysis = await analyzeText(input.responseText);
  if (!analysis.flagged) return analysis;

  try {
    const finding = await prisma.sensitiveFinding.create({
      data: {
        source: "response_dlp",
        provider: input.provider,
        model: input.model,
        severity: analysis.severity === "critical" ? "critical" : "warning",
        ruleKeys: analysis.ruleKeys,
        categories: analysis.categories,
        matchedSignals: analysis.matchedSignals,
        excerpt: analysis.excerpt,
        aiSystemId: input.aiSystemId,
      },
    });

    const suppressed = await shouldSuppressAlert(analysis.ruleKeys, analysis.matchedSignals);
    if (!suppressed) {
      const alertId = await createSensitiveAlert({
        provider: input.provider,
        model: input.model,
        analysis,
        aiSystemId: input.aiSystemId,
      });
      await prisma.sensitiveFinding.update({ where: { id: finding.id }, data: { alertId } });
    }
  } catch (err) {
    console.error("scanResponseForSensitiveInfo persist failed:", err);
  }

  return analysis;
}
