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
      /\b(api keys?|access tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?)\b.{0,40}\b(reveal|extract|dump|list|show|steal|copy|find)\b/i,
      /\b(reveal|extract|dump|list|show|steal|copy|find)\b.{0,40}\b(api keys?|access tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?)\b/i,
    ],
  },
  {
    key: "data_exfiltration",
    label: "Sensitive data exfiltration attempt",
    severity: "critical",
    patterns: [
      /\b(export|dump|extract|copy|list|download)\b.{0,60}\b(customer data|employee data|database|records|pii|phi|ssn|social security|passport|credit card)\b/i,
      /\b(ssn|social security|passport|credit card|patient|medical record|pii|phi)\b.{0,60}\b(export|dump|extract|copy|list|download|send)\b/i,
    ],
  },
  {
    key: "malware_or_phishing",
    label: "Malware, exploit, or phishing generation",
    severity: "critical",
    patterns: [
      /\b(malware|ransomware|keylogger|stealer|credential harvester|phishing|exploit|payload|reverse shell)\b/i,
      /\b(create|write|generate|build)\b.{0,40}\b(phishing email|malware|ransomware|exploit|keylogger)\b/i,
    ],
  },
  {
    key: "dangerous_autonomy",
    label: "Unsafe autonomous or impersonation behavior",
    severity: "warning",
    patterns: [
      /\b(without human review|without approval|without asking|autonomously)\b/i,
      /\b(send emails|modify records|delete records|impersonate|take action on my behalf|approve requests)\b/i,
    ],
  },
];

export type PromptRiskAnalysis = {
  flagged: boolean;
  severity: PromptRiskSeverity | null;
  flagReason: string | null;
  summary: string | null;
  categories: string[];
  matchedSignals: string[];
  excerpt: string | null;
};

function extractTextFromContent(value: unknown, acc: string[]) {
  if (typeof value === "string") {
    acc.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractTextFromContent(item, acc);
    }
    return;
  }

  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    if (
      key === "text" ||
      key === "content" ||
      key === "prompt" ||
      key === "input" ||
      key === "system" ||
      key === "instructions"
    ) {
      extractTextFromContent(nested, acc);
      continue;
    }

    if (key === "messages" || key === "contents") {
      extractTextFromContent(nested, acc);
    }
  }
}

function extractPromptText(requestBody: Record<string, unknown> | null | undefined): string {
  if (!requestBody) return "";
  const parts: string[] = [];
  extractTextFromContent(requestBody, parts);
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
      matchedSignals: [],
      excerpt: null,
    };
  }

  const categories: string[] = [];
  const matchedSignals: string[] = [];
  let severity: PromptRiskSeverity | null = null;

  for (const rule of PROMPT_RISK_RULES) {
    const matches = rule.patterns
      .map((pattern) => promptText.match(pattern)?.[0] ?? null)
      .filter((value): value is string => !!value);

    if (matches.length === 0) continue;

    categories.push(rule.label);
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
    matchedSignals: [...new Set(matchedSignals)].slice(0, 6),
    excerpt: sanitizeExcerpt(promptText),
  };
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

  if (recentDuplicate) {
    await prisma.alert.update({
      where: { id: recentDuplicate.id },
      data: {
        severity: input.analysis.severity === "critical" ? "CRITICAL" : "HIGH",
        description: descriptionParts.join(" · "),
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
    },
  });
}
