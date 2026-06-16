#!/bin/bash
# Hexnode → macOS "Custom Script" (runs as root) — enforces the Claude Code
# OTel telemetry config by writing the managed-settings.json that users
# cannot override from their personal ~/.claude/settings.json.
#
# Deploy in Hexnode:
#   1. Admin Console → Scripts → Add Custom Script → Platform: Mac, Type: Bash.
#   2. Paste this script with the two placeholders below filled in.
#   3. Assign to your macOS device group / policy. Hexnode executes Mac
#      custom scripts as root, so it can write to /Library.
#   4. (Optional) schedule a periodic re-run for drift correction — the script
#      is idempotent and simply rewrites the file each run.
#
# SECURITY: the filled-in copy contains the ingest bearer token. Keep the
# real token in the Hexnode console copy only — this committed file uses
# placeholders. Rotate via ops/otel-collector/rotate-secrets.sh rotate-ingest
# and update the Hexnode script.

set -euo pipefail

# ── Fill these in the Hexnode console copy ───────────────────────────────
COLLECTOR_FQDN="__COLLECTOR_FQDN__"   # e.g. cc-otel-app.<region>.azurecontainerapps.io
INGEST_TOKEN="__INGEST_TOKEN__"
# ─────────────────────────────────────────────────────────────────────────

if [ "$COLLECTOR_FQDN" = "__COLLECTOR_FQDN__" ] || [ "$INGEST_TOKEN" = "__INGEST_TOKEN__" ]; then
  echo "ERROR: fill in COLLECTOR_FQDN and INGEST_TOKEN before deploying" >&2
  exit 1
fi

DEST_DIR="/Library/Application Support/ClaudeCode"
DEST="$DEST_DIR/managed-settings.json"

mkdir -p "$DEST_DIR"

# Write atomically: stage to a temp file, validate, then move into place.
TMP="$(mktemp)"
cat > "$TMP" <<JSON
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://${COLLECTOR_FQDN}",
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer ${INGEST_TOKEN}",
    "OTEL_METRIC_EXPORT_INTERVAL": "60000",
    "OTEL_LOGS_EXPORT_INTERVAL": "5000",
    "OTEL_LOG_USER_PROMPTS": "1",
    "OTEL_METRICS_INCLUDE_ENTRYPOINT": "1"
  }
}
JSON

# Validate JSON before installing. `plutil -convert json` parses JSON and
# exits non-zero on a syntax error (note: `plutil -lint` only accepts
# plists, not JSON). plutil ships on every macOS. Fail loudly so Hexnode
# marks the run failed rather than installing a broken file.
if ! /usr/bin/plutil -convert json -o /dev/null "$TMP" >/dev/null 2>&1; then
  echo "ERROR: generated managed-settings.json is not valid JSON" >&2
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$DEST"
# Root-owned, world-readable: enforced config the user cannot override.
chown root:wheel "$DEST"
chmod 644 "$DEST"

echo "Deployed $DEST"
exit 0
