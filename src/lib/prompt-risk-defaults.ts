/**
 * Built-in prompt-risk rules. These mirror the seed data in
 * `prisma/migrations/20260611120000_expand_prompt_risk_rules/migration.sql`
 * and are used as a fallback when the database is unreachable (CI, cold
 * starts, brief outages). If the DB is up and has the seeded rows, those
 * take precedence — this constant is only consulted when the DB read fails.
 *
 * Keep this list in sync with the migration seed. Admins can still edit
 * individual rules via `/alerts/prompt-rules`; their DB overrides win at
 * runtime as long as the DB is reachable.
 *
 * Tuning note: the `critical` rules deliberately key on *aggressive* verbs
 * (extract/dump/exfiltrate/leak/steal/…), NOT neutral verbs like
 * "show me"/"list"/"export"/"download". This is intentional — security
 * reviews ("show me which API keys are active") and routine business
 * exports ("export the customer data to CSV") must not flag. See the
 * false-positive cases in `prompt-risk.test.ts` before widening a verb set.
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
      "\\b(ignore|disregard|forget)\\b.{0,30}\\b(previous|prior|earlier|above|preceding|all|any|these|those|the system)\\b.{0,20}\\b(instructions?|prompts?|directives?|rules?|guidelines?)\\b",
      "\\b(you are now|you're now|from now on,? you|new instructions:|override (your )?(instructions|guidelines|rules|safety)|you have no (restrictions|limitations|rules|guidelines)|there are no (rules|restrictions|limitations)|act as (a |an )?(dan|jailbroken|unrestricted|unfiltered))\\b",
      "\\b(reveal|show|print|dump|expose|repeat|output|tell me|give me|what (?:is|are))\\b.{0,40}\\b(your )?(system prompt|hidden instructions|developer message|developer prompt|initial instructions|original instructions|internal prompt|instructions you were given)\\b",
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
      "\\b(api keys?|access tokens?|bearer tokens?|auth tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?|env(ironment)? (?:variables?|vars?)|\\.env|connection strings?|service account keys?|aws (?:secret|access) keys?)\\b.{0,40}\\b(reveal|extract|dump|steal|copy|exfiltrate|leak|send|email|upload|paste|post)\\b",
      "\\b(reveal|extract|dump|steal|copy|exfiltrate|leak|send|email|upload|paste|post)\\b.{0,40}\\b(api keys?|access tokens?|bearer tokens?|auth tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?|env(ironment)? (?:variables?|vars?)|\\.env|connection strings?|service account keys?|aws (?:secret|access) keys?)\\b",
    ],
    description:
      "Requests framed as imperative commands to reveal, dump, or exfiltrate credentials.",
  },
  {
    key: "data_exfiltration",
    label: "Sensitive data exfiltration attempt",
    severity: "critical",
    patterns: [
      "\\b(dump|extract|exfiltrate|steal|leak|email|upload)\\b.{0,60}\\b(customer data|client data|employee data|user data|payroll|salary data|bank account|routing number|pii|phi|ssn|social security|passport|credit card|date of birth|driver'?s licen[sc]e|medical record|patient record|health record)\\b",
      "\\b(ssn|social security|passport|credit card|patient|medical record|health record|pii|phi|payroll|bank account)\\b.{0,60}\\b(dump|extract|exfiltrate|steal|leak|send to|email to|upload to|post to)\\b",
    ],
    description:
      "Requests pairing sensitive data types (PII, PHI, credit cards) with exfiltration verbs.",
  },
  {
    key: "malware_or_phishing",
    label: "Malware, exploit, or phishing generation",
    severity: "critical",
    patterns: [
      "\\b(create|write|generate|build|code|develop|design)\\b.{0,40}\\b(phishing (?:email|page|site|website|message|sms|text|kit|landing page)|spear[- ]?phishing|malware|ransomware|spyware|rootkit|trojan|backdoor|worm|botnet|keylogger|credential harvester|reverse shell|web ?shell|shellcode|exploit|0day|zero[- ]day|sql injection|xss payload|ddos (?:script|tool))\\b",
      "\\b(malware|ransomware|spyware|rootkit|trojan|backdoor|keylogger|credential harvester|botnet|reverse shell)\\b.{0,40}\\b(that|which|to)\\b",
      "\\b(evade|bypass|avoid|defeat|disable)\\b.{0,30}\\b(antivirus|anti-?virus|edr|defender|detection|sandbox|firewall)\\b",
    ],
    description:
      "Requests asking the model to author malicious code, phishing content, or detection-evasion.",
  },
  {
    key: "dangerous_autonomy",
    label: "Unsafe autonomous or impersonation behavior",
    severity: "warning",
    patterns: [
      "\\b(act|proceed|go ahead|do it|execute|run)\\b.{0,30}\\b(without (human review|approval|asking|oversight|permission))\\b",
      "\\b(impersonate|pretend to be|pose as)\\b.{0,40}\\b(admin|ceo|manager|user|employee|customer)\\b",
      "\\b(don'?t|do not|never)\\b.{0,20}\\b(ask|wait|stop|check|confirm)\\b.{0,30}\\b(confirmation|approval|permission|review|consent|oversight)\\b",
      "\\b(skip|bypass|disable|turn off|remove)\\b.{0,25}\\b(human )?(review|approval|confirmation|oversight|safety check|guardrails?|sign[- ]?off)\\b",
      "\\b(no human (in the loop|oversight|review|involved)|auto[- ]?approve (everything|all)|fully autonomous(ly)?|without (my )?sign[- ]?off)\\b",
    ],
    description:
      "Prompts instructing the model to bypass human review or impersonate a role.",
  },
  {
    key: "sensitive_data_in_prompt",
    label: "Sensitive data pasted into prompt",
    severity: "critical",
    patterns: [
      // US SSN
      "\\b\\d{3}-\\d{2}-\\d{4}\\b",
      // Payment card (major brand prefixes, optional space/dash separators)
      "\\b(?:4\\d{3}|5[1-5]\\d{2}|3[47]\\d{2}|6011)[ -]?\\d{4}[ -]?\\d{4}[ -]?\\d{2,4}\\b",
      // PEM private key block
      "-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----",
      // AWS access key id
      "\\bAKIA[0-9A-Z]{16}\\b",
    ],
    description:
      "Literal secrets or regulated identifiers (SSN, payment card, private key, cloud access key) present in the prompt body — a potential data-leak / compliance exposure when sent to an external model.",
  },
];
