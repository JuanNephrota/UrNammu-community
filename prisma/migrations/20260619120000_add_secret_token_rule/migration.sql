-- Add a data-presence rule that flags literal API keys / access tokens present
-- in text (prompt OR model response). Complements `sensitive_data_in_prompt`
-- (SSN/card/PEM/AWS key). Mirrors src/lib/prompt-risk-defaults.ts. Idempotent.
INSERT INTO "PromptRiskRule" (
  "id", "key", "label", "severity", "patterns", "description",
  "enabled", "builtIn", "defaultLabel", "defaultSeverity", "defaultPatterns",
  "createdAt", "updatedAt"
) VALUES (
  'builtin_secret_token_in_text',
  'secret_token_in_text',
  'API key or token present',
  'critical',
  ARRAY[
    '\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b',
    '\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b',
    '\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b',
    '\bgithub_pat_[A-Za-z0-9_]{60,}\b',
    '\bAIza[0-9A-Za-z_-]{35}\b',
    '\bya29\.[0-9A-Za-z._-]{20,}\b',
    '\bxox[baprs]-[A-Za-z0-9-]{10,}\b'
  ],
  'A literal API key or access token (OpenAI, Anthropic, Stripe, GitHub, Google, Slack, etc.) is present in the text — a credential leak whether in a prompt or a model response.',
  true, true,
  'API key or token present',
  'critical',
  ARRAY[
    '\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b',
    '\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b',
    '\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b',
    '\bgithub_pat_[A-Za-z0-9_]{60,}\b',
    '\bAIza[0-9A-Za-z_-]{35}\b',
    '\bya29\.[0-9A-Za-z._-]{20,}\b',
    '\bxox[baprs]-[A-Za-z0-9-]{10,}\b'
  ],
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
