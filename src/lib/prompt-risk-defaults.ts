/**
 * Built-in prompt-risk rules. These mirror the seed data in
 * `prisma/migrations/20260415152555_add_prompt_risk_rules/migration.sql`
 * and are used as a fallback when the database is unreachable (CI, cold
 * starts, brief outages). If the DB is up and has the seeded rows, those
 * take precedence — this constant is only consulted when the DB read fails.
 *
 * Keep this list in sync with the migration seed. Admins can still edit
 * individual rules via `/alerts/prompt-rules`; their DB overrides win at
 * runtime as long as the DB is reachable.
 */
export type BuiltInPromptRiskRule = {
  key: string;
  label: string;
  severity: "critical" | "warning";
  patterns: string[];
  description: string;
};

export const BUILTIN_PROMPT_RISK_RULES: BuiltInPromptRiskRule[] = [
  {
    key: "prompt_injection",
    label: "Prompt injection or system prompt exfiltration",
    severity: "warning",
    patterns: [
      "\\bignore (all |any |the )?(previous|prior|earlier) instructions\\b",
      "\\b(reveal|show|print|dump|expose).{0,40}(system prompt|hidden instructions|developer message|internal prompt)\\b",
      "\\b(jailbreak|bypass (safety|guardrails|policy)|developer mode|dan mode)\\b",
    ],
    description:
      "Attempts to override the model's system prompt or escape safety guardrails.",
  },
  {
    key: "secret_extraction",
    label: "Secret or credential extraction attempt",
    severity: "critical",
    patterns: [
      "\\b(api keys?|access tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?)\\b.{0,40}\\b(reveal|extract|dump|steal|copy|exfiltrate)\\b",
      "\\b(reveal|extract|dump|steal|copy|exfiltrate)\\b.{0,40}\\b(api keys?|access tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?)\\b",
    ],
    description:
      "Requests framed as imperative commands to reveal, dump, or exfiltrate credentials.",
  },
  {
    key: "data_exfiltration",
    label: "Sensitive data exfiltration attempt",
    severity: "critical",
    patterns: [
      "\\b(dump|extract|exfiltrate|steal)\\b.{0,60}\\b(customer data|employee data|pii|phi|ssn|social security|passport|credit card)\\b",
      "\\b(ssn|social security|passport|credit card|patient|medical record|pii|phi)\\b.{0,60}\\b(dump|extract|exfiltrate|steal|send to)\\b",
    ],
    description:
      "Requests pairing sensitive data types (PII, PHI, credit cards) with exfiltration verbs.",
  },
  {
    key: "malware_or_phishing",
    label: "Malware, exploit, or phishing generation",
    severity: "critical",
    patterns: [
      "\\b(create|write|generate|build|code|develop)\\b.{0,40}\\b(phishing email|phishing page|malware|ransomware|exploit|keylogger|credential harvester|reverse shell)\\b",
      "\\b(malware|ransomware|keylogger|credential harvester)\\b.{0,40}\\b(that|which|to)\\b",
    ],
    description:
      "Requests asking the model to author malicious code or phishing content.",
  },
  {
    key: "dangerous_autonomy",
    label: "Unsafe autonomous or impersonation behavior",
    severity: "warning",
    patterns: [
      "\\b(act|proceed|go ahead|do it|execute|run)\\b.{0,30}\\b(without (human review|approval|asking|oversight|permission))\\b",
      "\\b(impersonate|pretend to be|pose as)\\b.{0,40}\\b(admin|ceo|manager|user|employee|customer)\\b",
    ],
    description:
      "Prompts instructing the model to bypass human review or impersonate a role.",
  },
];
