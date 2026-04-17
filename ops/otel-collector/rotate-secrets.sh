#!/usr/bin/env bash
# Claude Code OTel Collector — secret rotation helper.
#
# Rotates ACA secrets via `az containerapp secret set` and restarts the
# Container App so new values are picked up. Does not touch Bicep — safe
# to run in isolation. Intended companion to deploy-infra.bicep (which
# preserves secret values across redeploys via listSecrets()).
#
# Usage:
#   ./rotate-secrets.sh status
#   ./rotate-secrets.sh rotate-ingest [new-token-hex]
#   ./rotate-secrets.sh rotate-forward [new-token-hex]
#   ./rotate-secrets.sh rotate-all
#
#   If no token is supplied, a fresh 32-byte hex token is generated.
#
# Environment overrides (both optional):
#   RG   — resource group (default: certifid-ai-governance)
#   APP  — Container App name (default: cc-otel-app)
#
# IMPORTANT coordination note for rotate-forward / rotate-all:
#   The "forward" token must match CLAUDE_CODE_TELEMETRY_SECRET on UrNammu.
#   Rotation ORDER matters to avoid a 401 window:
#     1. Update Vercel env (UrNammu must accept new token first)
#     2. Redeploy UrNammu
#     3. THEN rotate here
#   The script prints the new value so you can feed it to Vercel first.

set -euo pipefail

RG="${RG:-certifid-ai-governance}"
APP="${APP:-cc-otel-app}"

gen_token() {
  openssl rand -hex 32
}

require_az() {
  if ! command -v az >/dev/null 2>&1; then
    echo "error: az CLI not found. Install: https://aka.ms/install-az-cli" >&2
    exit 2
  fi
}

require_openssl() {
  if ! command -v openssl >/dev/null 2>&1; then
    echo "error: openssl not found" >&2
    exit 2
  fi
}

cmd_status() {
  require_az
  echo "Resource group: $RG"
  echo "Container App:  $APP"
  echo
  echo "Secrets (names only — values are write-only in the portal):"
  az containerapp secret list -g "$RG" -n "$APP" --query "[].name" -o tsv
}

set_and_restart() {
  local name="$1"
  local value="$2"
  az containerapp secret set -g "$RG" -n "$APP" \
    --secrets "${name}=${value}" >/dev/null
  az containerapp revision restart -g "$RG" -n "$APP" >/dev/null
  echo "Rotated $name (revision restarted)"
}

cmd_rotate_ingest() {
  require_az
  local token="${1:-$(require_openssl && gen_token)}"
  set_and_restart ingest-bearer-token "$token"
  echo
  echo "New ingest token: $token"
  echo
  echo "NEXT:"
  echo "  - Push this value to managed-settings.json and redeploy via MDM"
  echo "  - Or update ~/.claude/settings.json on dev laptops using the fallback flow"
}

cmd_rotate_forward() {
  require_az
  local token="${1:-$(require_openssl && gen_token)}"
  echo "WARNING: rotate UrNammu FIRST to avoid a 401 window."
  echo "  New forward token (copy this to Vercel env before continuing):"
  echo "    $token"
  echo
  echo "  1. vercel env rm CLAUDE_CODE_TELEMETRY_SECRET production -y"
  echo "  2. echo \"$token\" | vercel env add CLAUDE_CODE_TELEMETRY_SECRET production"
  echo "  3. vercel --prod --yes"
  echo
  read -r -p "UrNammu rotated + redeployed? Type 'yes' to rotate collector: " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted. Collector token unchanged."
    exit 1
  fi
  set_and_restart forward-bearer-token "$token"
}

cmd_rotate_all() {
  require_az
  require_openssl
  local ingest forward
  ingest=$(gen_token)
  forward=$(gen_token)

  echo "Generated fresh tokens. Rotate UrNammu FIRST to avoid a 401 window."
  echo
  echo "  New ingest token (for managed-settings.json):"
  echo "    $ingest"
  echo
  echo "  New forward token (for Vercel CLAUDE_CODE_TELEMETRY_SECRET):"
  echo "    $forward"
  echo
  echo "  1. Update CLAUDE_CODE_TELEMETRY_SECRET on Vercel to the forward value"
  echo "  2. vercel --prod --yes"
  echo
  read -r -p "UrNammu rotated + redeployed? Type 'yes' to rotate collector: " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted. Collector tokens unchanged."
    exit 1
  fi

  az containerapp secret set -g "$RG" -n "$APP" \
    --secrets ingest-bearer-token="$ingest" forward-bearer-token="$forward" >/dev/null
  az containerapp revision restart -g "$RG" -n "$APP" >/dev/null
  echo "Rotated both secrets (revision restarted)"
}

usage() {
  sed -n 's/^# \{0,1\}//p' "$0" | sed -n '/Usage:/,/^$/p'
  exit 1
}

cmd="${1:-}"
shift || true

case "$cmd" in
  status)          cmd_status ;;
  rotate-ingest)   cmd_rotate_ingest "$@" ;;
  rotate-forward)  cmd_rotate_forward "$@" ;;
  rotate-all)      cmd_rotate_all ;;
  -h|--help|help|'') usage ;;
  *)
    echo "error: unknown command '$cmd'" >&2
    usage
    ;;
esac
