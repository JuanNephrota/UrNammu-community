#!/usr/bin/env bash
# Claude Code OTel Collector — infra deploy wrapper.
#
# Reads existing bearer tokens from the ACA Container App (via
# `az containerapp secret show`) and passes them to deploy-infra.bicep as
# params. On first deploy (no existing app), prompts you for either
# "generate fresh" or "paste existing". You never have to re-type the
# tokens on routine redeploys.
#
# Why this exists: Bicep cannot call listSecrets() on a resource it is
# also declaring in the same template — BCP422 / circular dependency.
# Moving the secret read-back out of Bicep into plain `az` calls fixes
# that without Key Vault.
#
# Usage:
#   ./deploy-infra.sh                                  # interactive bootstrap if needed
#   URNAMMU_URL=https://... ./deploy-infra.sh          # override target
#   RG=my-rg APP=my-app ./deploy-infra.sh              # different subscription/app
#
# Exit codes:
#   0 — deploy succeeded
#   1 — user aborted or missing prereq
#   2 — az CLI error

set -euo pipefail

RG="${RG:-certifid-ai-governance}"
APP="${APP:-cc-otel-app}"
URNAMMU_URL="${URNAMMU_URL:-https://nammu.certifid.com/api/telemetry/claude-code}"
# Events (logs) ingestion endpoint. Defaults to the metrics URL + "-events"
# so it tracks URNAMMU_URL overrides automatically; override explicitly if
# your events route lives elsewhere.
URNAMMU_EVENTS_URL="${URNAMMU_EVENTS_URL:-${URNAMMU_URL}-events}"
# Cursor ingestion endpoints. Default to the same host as the Claude Code
# metrics URL, swapping the path. Override explicitly if they live elsewhere.
URNAMMU_HOST="${URNAMMU_URL%/api/telemetry/*}"
URNAMMU_CURSOR_METRICS_URL="${URNAMMU_CURSOR_METRICS_URL:-${URNAMMU_HOST}/api/telemetry/cursor}"
URNAMMU_CURSOR_TRACES_URL="${URNAMMU_CURSOR_TRACES_URL:-${URNAMMU_HOST}/api/telemetry/cursor-traces}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BICEP_FILE="$SCRIPT_DIR/deploy-infra.bicep"

require() {
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "error: '$cmd' not found on PATH" >&2
      exit 1
    fi
  done
}

try_read_secret() {
  local secret_name="$1"
  # 2>/dev/null suppresses "SecretNotFoundInContainerApp" noise when the
  # app doesn't exist yet; we treat any failure as "no value".
  az containerapp secret show \
    -g "$RG" -n "$APP" \
    --secret-name "$secret_name" \
    --query value -o tsv 2>/dev/null || true
}

prompt_token() {
  local label="$1"
  local existing_env_var="$2"
  local default_value="${!existing_env_var:-}"
  local value

  # Prefer the env var if the caller pre-set it (useful for CI).
  if [ -n "$default_value" ]; then
    echo "$default_value"
    return
  fi

  echo >&2
  echo "No existing $label found. Choose one:" >&2
  echo "  [g] generate a fresh 32-byte hex token" >&2
  echo "  [p] paste an existing token" >&2
  echo "  [a] abort" >&2
  read -r -p "Choice [g/p/a]: " choice >&2
  case "$choice" in
    g|G)
      require openssl
      value=$(openssl rand -hex 32)
      echo "Generated $label: $value" >&2
      ;;
    p|P)
      read -r -s -p "Paste $label (input hidden): " value
      echo >&2
      ;;
    *)
      echo "Aborted." >&2
      exit 1
      ;;
  esac
  echo "$value"
}

main() {
  require az

  echo "Resource group:       $RG"
  echo "Container App:        $APP"
  echo "UrNammu metrics:      $URNAMMU_URL"
  echo "UrNammu events:       $URNAMMU_EVENTS_URL"
  echo "UrNammu cursor metr.: $URNAMMU_CURSOR_METRICS_URL"
  echo "UrNammu cursor trace: $URNAMMU_CURSOR_TRACES_URL"
  echo

  ingest=$(try_read_secret ingest-bearer-token)
  forward=$(try_read_secret forward-bearer-token)
  cursor_forward=$(try_read_secret cursor-forward-bearer-token)
  bypass=$(try_read_secret vercel-protection-bypass)

  if [ -n "$ingest" ]; then
    echo "ingest-bearer-token:  (preserving existing, len=${#ingest})"
  else
    ingest=$(prompt_token "ingest bearer token" INGEST_BEARER_TOKEN)
  fi

  if [ -n "$forward" ]; then
    echo "forward-bearer-token: (preserving existing, len=${#forward})"
  else
    echo
    echo "NOTE: the forward token MUST match CLAUDE_CODE_TELEMETRY_SECRET on" >&2
    echo "      UrNammu (Vercel). Set it there FIRST, then continue here." >&2
    forward=$(prompt_token "forward bearer token" FORWARD_BEARER_TOKEN)
  fi

  if [ -n "$cursor_forward" ]; then
    echo "cursor-forward-bearer-token: (preserving existing, len=${#cursor_forward})"
  else
    echo
    echo "NOTE: the cursor forward token MUST match CURSOR_TELEMETRY_SECRET on" >&2
    echo "      UrNammu (Vercel). Set it there FIRST, then continue here." >&2
    cursor_forward=$(prompt_token "cursor forward bearer token" CURSOR_FORWARD_BEARER_TOKEN)
  fi

  if [ -n "$bypass" ]; then
    echo "vercel-protection-bypass: (preserving existing, len=${#bypass})"
  else
    echo
    echo "NOTE: UrNammu sits behind Vercel Deployment Protection (SSO)." >&2
    echo "      The collector must send a Protection Bypass for Automation" >&2
    echo "      secret. Get it from Vercel → Project → Settings →" >&2
    echo "      Deployment Protection → Protection Bypass for Automation." >&2
    bypass=$(prompt_token "vercel protection bypass" VERCEL_PROTECTION_BYPASS)
  fi

  echo
  echo "Running Bicep deploy..."
  az deployment group create \
    --resource-group "$RG" \
    --template-file "$BICEP_FILE" \
    --parameters \
        ingestBearerToken="$ingest" \
        forwardBearerToken="$forward" \
        cursorForwardBearerToken="$cursor_forward" \
        vercelProtectionBypass="$bypass" \
        urnammuTelemetryUrl="$URNAMMU_URL" \
        urnammuEventsUrl="$URNAMMU_EVENTS_URL" \
        urnammuCursorMetricsUrl="$URNAMMU_CURSOR_METRICS_URL" \
        urnammuCursorTracesUrl="$URNAMMU_CURSOR_TRACES_URL" \
    --output table
}

main "$@"
