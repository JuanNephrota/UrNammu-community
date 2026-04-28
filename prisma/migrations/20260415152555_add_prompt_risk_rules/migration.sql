-- CreateTable
CREATE TABLE "PromptRiskRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "patterns" TEXT[],
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "defaultLabel" TEXT,
    "defaultSeverity" TEXT,
    "defaultPatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptRiskRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromptRiskRule_key_key" ON "PromptRiskRule"("key");

-- CreateIndex
CREATE INDEX "PromptRiskRule_enabled_idx" ON "PromptRiskRule"("enabled");

-- Seed the five built-in rules. Patterns mirror the previous hardcoded set in
-- src/lib/prompt-risk.ts. `defaultLabel` / `defaultSeverity` / `defaultPatterns`
-- mirror `label` / `severity` / `patterns` on seed so "reset to default" can
-- restore the original definition even after edits.
INSERT INTO "PromptRiskRule" (
  "id", "key", "label", "severity", "patterns", "description",
  "enabled", "builtIn", "defaultLabel", "defaultSeverity", "defaultPatterns",
  "createdAt", "updatedAt"
) VALUES
(
  'builtin_prompt_injection',
  'prompt_injection',
  'Prompt injection or system prompt exfiltration',
  'warning',
  ARRAY[
    '\bignore (all |any |the )?(previous|prior|earlier) instructions\b',
    '\b(reveal|show|print|dump|expose).{0,40}(system prompt|hidden instructions|developer message|internal prompt)\b',
    '\b(jailbreak|bypass (safety|guardrails|policy)|developer mode|dan mode)\b'
  ],
  'Attempts to override the model''s system prompt or escape safety guardrails.',
  true, true,
  'Prompt injection or system prompt exfiltration',
  'warning',
  ARRAY[
    '\bignore (all |any |the )?(previous|prior|earlier) instructions\b',
    '\b(reveal|show|print|dump|expose).{0,40}(system prompt|hidden instructions|developer message|internal prompt)\b',
    '\b(jailbreak|bypass (safety|guardrails|policy)|developer mode|dan mode)\b'
  ],
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  'builtin_secret_extraction',
  'secret_extraction',
  'Secret or credential extraction attempt',
  'critical',
  ARRAY[
    '\b(api keys?|access tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?)\b.{0,40}\b(reveal|extract|dump|steal|copy|exfiltrate)\b',
    '\b(reveal|extract|dump|steal|copy|exfiltrate)\b.{0,40}\b(api keys?|access tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?)\b'
  ],
  'Requests framed as imperative commands to reveal, dump, or exfiltrate credentials.',
  true, true,
  'Secret or credential extraction attempt',
  'critical',
  ARRAY[
    '\b(api keys?|access tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?)\b.{0,40}\b(reveal|extract|dump|steal|copy|exfiltrate)\b',
    '\b(reveal|extract|dump|steal|copy|exfiltrate)\b.{0,40}\b(api keys?|access tokens?|passwords?|private keys?|secret keys?|ssh keys?|credentials?)\b'
  ],
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  'builtin_data_exfiltration',
  'data_exfiltration',
  'Sensitive data exfiltration attempt',
  'critical',
  ARRAY[
    '\b(dump|extract|exfiltrate|steal)\b.{0,60}\b(customer data|employee data|pii|phi|ssn|social security|passport|credit card)\b',
    '\b(ssn|social security|passport|credit card|patient|medical record|pii|phi)\b.{0,60}\b(dump|extract|exfiltrate|steal|send to)\b'
  ],
  'Requests pairing sensitive data types (PII, PHI, credit cards) with exfiltration verbs.',
  true, true,
  'Sensitive data exfiltration attempt',
  'critical',
  ARRAY[
    '\b(dump|extract|exfiltrate|steal)\b.{0,60}\b(customer data|employee data|pii|phi|ssn|social security|passport|credit card)\b',
    '\b(ssn|social security|passport|credit card|patient|medical record|pii|phi)\b.{0,60}\b(dump|extract|exfiltrate|steal|send to)\b'
  ],
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  'builtin_malware_or_phishing',
  'malware_or_phishing',
  'Malware, exploit, or phishing generation',
  'critical',
  ARRAY[
    '\b(create|write|generate|build|code|develop)\b.{0,40}\b(phishing email|phishing page|malware|ransomware|exploit|keylogger|credential harvester|reverse shell)\b',
    '\b(malware|ransomware|keylogger|credential harvester)\b.{0,40}\b(that|which|to)\b'
  ],
  'Requests asking the model to author malicious code or phishing content.',
  true, true,
  'Malware, exploit, or phishing generation',
  'critical',
  ARRAY[
    '\b(create|write|generate|build|code|develop)\b.{0,40}\b(phishing email|phishing page|malware|ransomware|exploit|keylogger|credential harvester|reverse shell)\b',
    '\b(malware|ransomware|keylogger|credential harvester)\b.{0,40}\b(that|which|to)\b'
  ],
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  'builtin_dangerous_autonomy',
  'dangerous_autonomy',
  'Unsafe autonomous or impersonation behavior',
  'warning',
  ARRAY[
    '\b(act|proceed|go ahead|do it|execute|run)\b.{0,30}\b(without (human review|approval|asking|oversight|permission))\b',
    '\b(impersonate|pretend to be|pose as)\b.{0,40}\b(admin|ceo|manager|user|employee|customer)\b'
  ],
  'Prompts instructing the model to bypass human review or impersonate a role.',
  true, true,
  'Unsafe autonomous or impersonation behavior',
  'warning',
  ARRAY[
    '\b(act|proceed|go ahead|do it|execute|run)\b.{0,30}\b(without (human review|approval|asking|oversight|permission))\b',
    '\b(impersonate|pretend to be|pose as)\b.{0,40}\b(admin|ceo|manager|user|employee|customer)\b'
  ],
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
