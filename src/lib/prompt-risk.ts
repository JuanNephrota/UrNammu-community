import { prisma } from "./prisma";

type PromptRiskSeverity = "critical" | "warning";

type PromptRiskRule = {
  key: string;
  label: string;
  severity: PromptRiskSeverity;
  patterns: RegExp[];
};

const PROMPT_RISK_RULES: PromptRiskRule[] = [
  {
    key: "prompt_injection",
    label: "Prompt injection or system prompt exfiltration",
    severity: "warning",
    patterns: [
      /\bignore (all |any |the )?(previous|prior|earlier) instructions\b/i,
      /\b(reveal|show|print|dump|expose).{0,40}(system prompt|hidden instructions|developer message|internal prompt)\b/i,
      /\b(jailbreak|bypass (safety|guardrails|policy)|developer mode|dan mode)\b/i,
    ],
  },
  {
    key: "secret_extraction",
    label: "Secret or credential extraction attempt",
    severity: "critical",
    patterns: [
      // Require imperative/command framing — "reveal my api keys", "steal the credentials"
      // Exclude: "show" and "find" and "list" which are common in legit debugging/security contexts
      /\b(api keys?|access tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?)\b.{0,40}\b(reveal|extract|dump|steal|copy|exfiltrate)\b/i,
      /\b(reveal|extract|dump|steal|copy|exfiltrate)\b.{0,40}\b(api keys?|access tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?)\b/i,
    ],
  },
  {
    key: "data_exfiltration",
    label: "Sensitive data exfiltration attempt",
    severity: "critical",
    patterns: [
      // Require explicit exfil verbs paired with sensitive data types.
      // Removed "export", "copy", "list", "download" which are common in legit data work.
      /\b(dump|extract|exfiltrate|steal)\b.{0,60}\b(customer data|employee data|pii|phi|ssn|social security|passport|credit card)\b/i,
      /\b(ssn|social security|passport|credit card|patient|medical record|pii|phi)\b.{0,60}\b(dump|extract|exfiltrate|steal|send to)\b/i,
    ],
  },
  {
    key: "malware_or_phishing",
    label: "Malware, exploit, or phishing generation",
    severity: "critical",
    patterns: [
      // Require generation intent — bare mentions of "phishing" or "exploit" in security
      // discussions should not flag. "payload" alone is far too common in API/testing contexts.
      /\b(create|write|generate|build|code|develop)\b.{0,40}\b(phishing email|phishing page|malware|ransomware|exploit|keylogger|credential harvester|reverse shell)\b/i,
      /\b(malware|ransomware|keylogger|credential harvester)\b.{0,40}\b(that|which|to)\b/i,
    ],
  },
  {
    key: "dangerous_autonomy",
    label: "Unsafe autonomous or impersonation behavior",
    severity: "warning",
    patterns: [
      // Require explicit instruction to act without oversight — not just mentioning the concept.
      /\b(act|proceed|go ahead|do it|execute|run)\b.{0,30}\b(without (human review|approval|asking|oversight|permission))\b/i,
      // Require impersonation framing — "impersonate the CEO", "pretend to be the admin"
      /\b(impersonate|pretend to be|pose as)\b.{0,40}\b(admin|ceo|manager|user|employee|customer)\b/i,
    ],
  },
];

export type PromptRiskAnalysis = {
  flagged: boolean;
  severity: PromptRiskSeverity | null;
  flagReason: string | null;
  summary: string | null;
  categories: string[];
  ruleKeys: string[];
  matchedSignals: string[];
  excerpt: string | null;
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

function sanitizeExcerpt(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:sk|AIza|ya29|ghp)_[A-Za-z0-9._-]+\b/g, "[secret]")
    .replace(/\b\d{6,}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;
  return cleaned.length > 220 ? `${cleaned.slice(0, 217)}...` : cleaned;
}

export function analyzePromptRisk(requestBody: Record<string, unknown> | null | undefined): PromptRiskAnalysis {
  const promptText = extractPromptText(requestBody);
  if (!promptText) {
    return {
      flagged: false,
      severity: null,
      flagReason: null,
      summary: null,
      categories: [],
      ruleKeys: [],
      matchedSignals: [],
      excerpt: null,
    };
  }

  const categories: string[] = [];
  const ruleKeys: string[] = [];
  const matchedSignals: string[] = [];
  let severity: PromptRiskSeverity | null = null;

  for (const rule of PROMPT_RISK_RULES) {
    const matches = rule.patterns
      .map((pattern) => promptText.match(pattern)?.[0] ?? null)
      .filter((value): value is string => !!value);

    if (matches.length === 0) continue;

    categories.push(rule.label);
    ruleKeys.push(rule.key);
    matchedSignals.push(...matches.slice(0, 3));
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
      excerpt: sanitizeExcerpt(promptText),
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
    excerpt: sanitizeExcerpt(promptText),
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
    excerpt: input.analysis.excerpt,
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
