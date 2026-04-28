#!/usr/bin/env bash
# Nammu secret-grep
#
# Scans the provided files (passed as args by lint-staged, or all staged
# files when invoked bare) for common credential patterns. Designed to
# fail fast and loud when a secret looks like it's about to be committed.
#
# This is a local supplement to GitHub's secret scanning + push protection —
# not a replacement. Patterns err on the side of false positives; tune via
# the .secretignore file or the --allow-file whitelist if needed.

set -euo pipefail

# --- Determine files to check ------------------------------------------------
if [[ $# -gt 0 ]]; then
  files=("$@")
else
  # Bare invocation: check everything currently staged.
  mapfile -t files < <(git diff --cached --name-only --diff-filter=ACM)
fi

if [[ ${#files[@]} -eq 0 ]]; then
  exit 0
fi

# --- Allow-list: paths where matches are expected or harmless ---------------
# Extend as needed. Be conservative — a false positive that wastes 10
# seconds is far better than missing a real leak.
allow_patterns=(
  '\.env\.example$'
  'local\.settings\.json$'     # contains placeholder values only
  'SECURITY\.md$'
  'docs/.+\.md$'
  'scripts/check-secrets\.sh$'
  'package-lock\.json$'
  'node_modules/'
  'prisma/migrations/'
)

should_skip() {
  local file="$1"
  for pat in "${allow_patterns[@]}"; do
    if [[ "$file" =~ $pat ]]; then
      return 0
    fi
  done
  return 1
}

# --- Patterns to flag --------------------------------------------------------
# Name => regex. Each regex should be specific enough to reduce noise.
# Keep these in sync with any custom patterns you set in GitHub's secret
# scanning UI.
declare -a pattern_names=(
  "Anthropic API key"
  "OpenAI API key"
  "OpenAI project key"
  "Google service-account JSON"
  "AWS access key"
  "AWS secret key"
  "GitHub token"
  "Slack token"
  "Generic private key block"
  "Nammu proxy secret (assigned)"
  "Nammu settings encryption key (assigned)"
  "Nammu cron secret (assigned)"
  "NextAuth secret (assigned)"
  "Postgres URL with inline password"
)
declare -a pattern_regexes=(
  'sk-ant-[a-zA-Z0-9_-]{20,}'
  'sk-(proj-)?[a-zA-Z0-9_]{20,}'
  'sk-proj-[a-zA-Z0-9_-]{20,}'
  '"private_key":[[:space:]]*"-----BEGIN PRIVATE KEY-----'
  'AKIA[0-9A-Z]{16}'
  'aws_secret_access_key[[:space:]]*=[[:space:]]*[A-Za-z0-9/+=]{40}'
  'gh[pousr]_[A-Za-z0-9]{36,}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  '-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----'
  'PROXY_SECRET[[:space:]]*=[[:space:]]*["'"'"']?[A-Za-z0-9][A-Za-z0-9_\-]{15,}'
  'SETTINGS_ENCRYPTION_KEY[[:space:]]*=[[:space:]]*["'"'"']?[A-Fa-f0-9]{32,}'
  'CRON_SECRET[[:space:]]*=[[:space:]]*["'"'"']?[A-Za-z0-9][A-Za-z0-9_\-]{15,}'
  'NEXTAUTH_SECRET[[:space:]]*=[[:space:]]*["'"'"']?[A-Za-z0-9][A-Za-z0-9_\-]{15,}'
  'postgres(ql)?://[^:@[:space:]]+:[^@[:space:]]+@'
)

# --- Placeholder filter ------------------------------------------------------
# If a matched line contains any of these substrings (case-insensitive), we
# treat it as documentation placeholder text, not a real secret. Catches
# patterns like `CRON_SECRET=replace-with-a-long-random-secret`.
placeholder_filter='(replace|your-|your_|change-?me|placeholder|example|__replace__|xxxx+|<[a-z -]*>|TODO|FIXME|dummy|redacted)'

# --- Scan --------------------------------------------------------------------
found=0

for file in "${files[@]}"; do
  if [[ ! -f "$file" ]]; then
    continue                               # deleted, or outside repo
  fi
  if should_skip "$file"; then
    continue
  fi

  for i in "${!pattern_names[@]}"; do
    name="${pattern_names[$i]}"
    regex="${pattern_regexes[$i]}"
    # -I skips binary files, -E for ERE, -n for line numbers, -H for filename.
    if raw=$(grep -InH -E "$regex" "$file" 2>/dev/null); then
      # Drop lines that look like documentation placeholders.
      matches=$(echo "$raw" | grep -viE "$placeholder_filter" || true)
      if [[ -n "$matches" ]]; then
        echo ""
        echo "❌ Possible secret detected — $name"
        echo "$matches" | sed 's/^/   /'
        found=1
      fi
    fi
  done
done

if [[ $found -ne 0 ]]; then
  cat <<'EOF'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Commit blocked. Remove the matched value(s) before committing.

If this is a FALSE POSITIVE (example config, documentation placeholder):
  • Move it into .env.example or docs/ (already allow-listed), OR
  • Extend the allow_patterns list in scripts/check-secrets.sh.

If this is a REAL LEAK:
  1. Do NOT commit. Do NOT push.
  2. Revoke the credential at its source (provider dashboard).
  3. Remove the value, generate a new one, re-test.
  4. Follow the secret-leak response in SECURITY.md.

To override in a genuine emergency: git commit --no-verify
(This will be caught by GitHub push protection on the server side.)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
  exit 1
fi

exit 0
