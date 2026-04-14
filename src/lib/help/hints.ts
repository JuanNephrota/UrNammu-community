/**
 * Named tooltip strings for in-app help hints. Keep entries short — one or
 * two sentences. Use the matching HelpHint component:
 *
 *     <HelpHint hint="autonomy_level" />
 */

export const HELP_HINTS = {
  // --- AI System form ---
  data_sensitivity:
    "Drives policy evaluation and exposure alerts. Use RESTRICTED for regulated / high-sensitivity data.",
  review_interval:
    "How often this system must be re-assessed. The next-review date is computed from this on save.",
  approval_stages:
    "Which stages must sign off before the system can be APPROVED. Toggle off stages that aren't required for low-risk systems.",

  // --- Agent form ---
  autonomy_level:
    "FULL_AUTONOMY (no human) → SUPERVISED (human monitors) → HUMAN_IN_THE_LOOP (human approves each action) → HUMAN_ON_THE_LOOP (human can override) → MANUAL (human-driven, agent assists).",
  human_review_triggers:
    "JSON list of conditions that force a human step (e.g. 'amount > 1000', 'contains PII'). Feeds the AI risk review.",
  connected_systems:
    "Which AI systems this agent acts on top of. Used for risk inheritance and telemetry attribution.",

  // --- Risk assessment ---
  risk_bias: "Fairness of outputs across groups. Higher = more risk.",
  risk_security: "Vulnerability to attack, prompt injection, or model misuse. Higher = more risk.",
  risk_privacy: "Exposure of personal or restricted data. Higher = more risk.",
  risk_fairness: "Outcome equity and disparate impact. Higher = more risk.",
  risk_performance: "Reliability and accuracy. Higher = more risk.",
  risk_transparency: "Explainability and traceability. Higher = more risk.",

  // --- Compliance ---
  compliance_status:
    "COMPLIANT and PARTIALLY_COMPLIANT pass approval; NOT_ASSESSED and NON_COMPLIANT block it. Evidence is required.",
  compliance_evidence:
    "Free-text describing the controls, testing, or artifacts that back the rating. Reviewers read this at approval time.",
  policy_enforcement:
    "ADVISORY flags violations but does not block approval. BLOCKING prevents a system from moving to APPROVED until the violation is resolved.",
  policy_rules_json:
    "Machine-evaluable constraints: allowed/blocked vendors, max data sensitivity, required approval stages, model patterns.",

  // --- Shadow AI ---
  shadow_ai_status:
    "DISCOVERED → UNDER_REVIEW → REGISTERED / APPROVED / BLOCKED. Discoveries linked to a governed system are auto-suppressed.",
  shadow_ai_confidence:
    "How confident the scanner is that this is the named AI tool, based on name, vendor, domain, and scopes.",
  shadow_ai_confidence_score:
    "Numeric match score: 10+ = high, 6–9 = medium, < 6 = low. Based on domain, name, publisher, scope, and app ID signals.",
  shadow_ai_promote:
    "Promotes this candidate to the main review queue as a confirmed AI tool with high confidence.",
  shadow_ai_dismiss:
    "Permanently removes this candidate and prevents it from resurfacing on future scans. Requires a reason.",

  // --- Alerts / Prompt Risk ---
  dangerous_prompt:
    "Proxy-detected risky prompt pattern. Categories include jailbreak, credential extraction, data exfiltration, malware, and unsafe autonomy.",
  false_positive:
    "Mark this alert as a benign detection. Optionally create an exception to suppress similar future alerts for the matched categories.",
  prompt_risk_exception:
    "A suppression rule that prevents future alerts for a specific prompt risk category. Exceptions match on stable rule keys and can be deactivated.",
  prompt_risk_signals:
    "The exact phrases from the user's prompt that matched a detection rule. Sanitized — emails, keys, and long numbers are redacted.",

  // --- Proxy ---
  proxy_attribution:
    "Usage is attributed via optional headers: x-user-email (person), x-department (cost center), x-ai-system-id (registry link).",
  proxy_user_email:
    "Set PROXY_USER_EMAIL in your shell profile (from git config user.email) so Claude Code usage is attributed to you.",

  // --- Oversight ---
  spend_budget_scope:
    "PROVIDER (e.g. all OpenAI), AI_SYSTEM (one registered system), or DEPARTMENT.",
  spend_budget_threshold:
    "Percent of monthly budget at which a cost_anomaly alert fires (default 80%).",
  anomaly_multiplier:
    "Recent usage above (baseline × multiplier) triggers an alert. Higher = less sensitive.",
  vendor_contract_status:
    "UNKNOWN → IN_REVIEW → ACTIVE → EXPIRED / TERMINATED. Drives renewal alerts.",
  vendor_security_review:
    "NOT_REVIEWED → IN_PROGRESS → APPROVED / CONDITIONAL / REJECTED.",
} as const;

export type HelpHintKey = keyof typeof HELP_HINTS;
