-- Expand the built-in prompt-risk rules with broader phrasing coverage and add
-- a new `sensitive_data_in_prompt` rule that flags literal secrets / regulated
-- identifiers pasted into a prompt. Mirrors src/lib/prompt-risk-defaults.ts.
--
-- Update strategy for the five existing built-ins:
--   1. Always refresh `defaultPatterns` (+ defaultLabel/defaultSeverity) so the
--      "reset to default" action restores the NEW baseline.
--   2. Only overwrite the live `patterns` when they still equal the OLD default
--      (i.e. an admin has not customized them). This preserves admin edits.
--
-- The OLD default arrays below are copied verbatim from the original seed
-- migration (20260415152555_add_prompt_risk_rules) for the equality guard.

-- ----- prompt_injection -----
UPDATE "PromptRiskRule" SET
  "defaultLabel" = 'Prompt injection or system prompt exfiltration',
  "defaultSeverity" = 'warning',
  "defaultPatterns" = ARRAY[
    '\b(ignore|disregard|forget)\b.{0,30}\b(previous|prior|earlier|above|preceding|all|any|these|those|the system)\b.{0,20}\b(instructions?|prompts?|directives?|rules?|guidelines?)\b',
    '\b(you are now|you''re now|from now on,? you|new instructions:|override (your )?(instructions|guidelines|rules|safety)|you have no (restrictions|limitations|rules|guidelines)|there are no (rules|restrictions|limitations)|act as (a |an )?(dan|jailbroken|unrestricted|unfiltered))\b',
    '\b(reveal|show|print|dump|expose|repeat|output|tell me|give me|what (?:is|are))\b.{0,40}\b(your )?(system prompt|hidden instructions|developer message|developer prompt|initial instructions|original instructions|internal prompt|instructions you were given)\b',
    '\b(jailbreak|bypass (safety|guardrails|policy)|developer mode|dan mode)\b'
  ],
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'prompt_injection';

UPDATE "PromptRiskRule" SET
  "patterns" = "defaultPatterns", "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'prompt_injection' AND "patterns" = ARRAY[
  '\bignore (all |any |the )?(previous|prior|earlier) instructions\b',
  '\b(reveal|show|print|dump|expose).{0,40}(system prompt|hidden instructions|developer message|internal prompt)\b',
  '\b(jailbreak|bypass (safety|guardrails|policy)|developer mode|dan mode)\b'
];

-- ----- secret_extraction -----
UPDATE "PromptRiskRule" SET
  "defaultLabel" = 'Secret or credential extraction attempt',
  "defaultSeverity" = 'critical',
  "defaultPatterns" = ARRAY[
    '\b(api keys?|access tokens?|bearer tokens?|auth tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?|env(ironment)? (?:variables?|vars?)|\.env|connection strings?|service account keys?|aws (?:secret|access) keys?)\b.{0,40}\b(reveal|extract|dump|steal|copy|exfiltrate|leak|send|email|upload|paste|post)\b',
    '\b(reveal|extract|dump|steal|copy|exfiltrate|leak|send|email|upload|paste|post)\b.{0,40}\b(api keys?|access tokens?|bearer tokens?|auth tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?|env(ironment)? (?:variables?|vars?)|\.env|connection strings?|service account keys?|aws (?:secret|access) keys?)\b'
  ],
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'secret_extraction';

UPDATE "PromptRiskRule" SET
  "patterns" = "defaultPatterns", "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'secret_extraction' AND "patterns" = ARRAY[
  '\b(api keys?|access tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?)\b.{0,40}\b(reveal|extract|dump|steal|copy|exfiltrate)\b',
  '\b(reveal|extract|dump|steal|copy|exfiltrate)\b.{0,40}\b(api keys?|access tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?)\b'
];

-- ----- data_exfiltration -----
UPDATE "PromptRiskRule" SET
  "defaultLabel" = 'Sensitive data exfiltration attempt',
  "defaultSeverity" = 'critical',
  "defaultPatterns" = ARRAY[
    '\b(dump|extract|exfiltrate|steal|leak|email|upload)\b.{0,60}\b(customer data|client data|employee data|user data|payroll|salary data|bank account|routing number|pii|phi|ssn|social security|passport|credit card|date of birth|driver''?s licen[sc]e|medical record|patient record|health record)\b',
    '\b(ssn|social security|passport|credit card|patient|medical record|health record|pii|phi|payroll|bank account)\b.{0,60}\b(dump|extract|exfiltrate|steal|leak|send to|email to|upload to|post to)\b'
  ],
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'data_exfiltration';

UPDATE "PromptRiskRule" SET
  "patterns" = "defaultPatterns", "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'data_exfiltration' AND "patterns" = ARRAY[
  '\b(dump|extract|exfiltrate|steal)\b.{0,60}\b(customer data|employee data|pii|phi|ssn|social security|passport|credit card)\b',
  '\b(ssn|social security|passport|credit card|patient|medical record|pii|phi)\b.{0,60}\b(dump|extract|exfiltrate|steal|send to)\b'
];

-- ----- malware_or_phishing -----
UPDATE "PromptRiskRule" SET
  "defaultLabel" = 'Malware, exploit, or phishing generation',
  "defaultSeverity" = 'critical',
  "defaultPatterns" = ARRAY[
    '\b(create|write|generate|build|code|develop|design)\b.{0,40}\b(phishing (?:email|page|site|website|message|sms|text|kit|landing page)|spear[- ]?phishing|malware|ransomware|spyware|rootkit|trojan|backdoor|worm|botnet|keylogger|credential harvester|reverse shell|web ?shell|shellcode|exploit|0day|zero[- ]day|sql injection|xss payload|ddos (?:script|tool))\b',
    '\b(malware|ransomware|spyware|rootkit|trojan|backdoor|keylogger|credential harvester|botnet|reverse shell)\b.{0,40}\b(that|which|to)\b',
    '\b(evade|bypass|avoid|defeat|disable)\b.{0,30}\b(antivirus|anti-?virus|edr|defender|detection|sandbox|firewall)\b'
  ],
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'malware_or_phishing';

UPDATE "PromptRiskRule" SET
  "patterns" = "defaultPatterns", "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'malware_or_phishing' AND "patterns" = ARRAY[
  '\b(create|write|generate|build|code|develop)\b.{0,40}\b(phishing email|phishing page|malware|ransomware|exploit|keylogger|credential harvester|reverse shell)\b',
  '\b(malware|ransomware|keylogger|credential harvester)\b.{0,40}\b(that|which|to)\b'
];

-- ----- dangerous_autonomy -----
UPDATE "PromptRiskRule" SET
  "defaultLabel" = 'Unsafe autonomous or impersonation behavior',
  "defaultSeverity" = 'warning',
  "defaultPatterns" = ARRAY[
    '\b(act|proceed|go ahead|do it|execute|run)\b.{0,30}\b(without (human review|approval|asking|oversight|permission))\b',
    '\b(impersonate|pretend to be|pose as)\b.{0,40}\b(admin|ceo|manager|user|employee|customer)\b',
    '\b(don''?t|do not|never)\b.{0,20}\b(ask|wait|stop|check|confirm)\b.{0,30}\b(confirmation|approval|permission|review|consent|oversight)\b',
    '\b(skip|bypass|disable|turn off|remove)\b.{0,25}\b(human )?(review|approval|confirmation|oversight|safety check|guardrails?|sign[- ]?off)\b',
    '\b(no human (in the loop|oversight|review|involved)|auto[- ]?approve (everything|all)|fully autonomous(ly)?|without (my )?sign[- ]?off)\b'
  ],
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'dangerous_autonomy';

UPDATE "PromptRiskRule" SET
  "patterns" = "defaultPatterns", "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'dangerous_autonomy' AND "patterns" = ARRAY[
  '\b(act|proceed|go ahead|do it|execute|run)\b.{0,30}\b(without (human review|approval|asking|oversight|permission))\b',
  '\b(impersonate|pretend to be|pose as)\b.{0,40}\b(admin|ceo|manager|user|employee|customer)\b'
];

-- ----- NEW: sensitive_data_in_prompt -----
INSERT INTO "PromptRiskRule" (
  "id", "key", "label", "severity", "patterns", "description",
  "enabled", "builtIn", "defaultLabel", "defaultSeverity", "defaultPatterns",
  "createdAt", "updatedAt"
) VALUES (
  'builtin_sensitive_data_in_prompt',
  'sensitive_data_in_prompt',
  'Sensitive data pasted into prompt',
  'critical',
  ARRAY[
    '\b\d{3}-\d{2}-\d{4}\b',
    '\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[ -]?\d{4}[ -]?\d{4}[ -]?\d{2,4}\b',
    '-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----',
    '\bAKIA[0-9A-Z]{16}\b'
  ],
  'Literal secrets or regulated identifiers (SSN, payment card, private key, cloud access key) present in the prompt body — a potential data-leak / compliance exposure when sent to an external model.',
  true, true,
  'Sensitive data pasted into prompt',
  'critical',
  ARRAY[
    '\b\d{3}-\d{2}-\d{4}\b',
    '\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[ -]?\d{4}[ -]?\d{4}[ -]?\d{2,4}\b',
    '-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----',
    '\bAKIA[0-9A-Z]{16}\b'
  ],
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
