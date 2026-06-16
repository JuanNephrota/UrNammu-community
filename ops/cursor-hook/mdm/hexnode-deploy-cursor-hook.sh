#!/bin/bash
# Hexnode → macOS "Custom Script" (runs as root) — configures cursor-otel-hook
# for the active console user so Cursor activity is reported to UrNammu.
#
# PREREQ (separate Hexnode step): the cursor-otel-hook **.pkg must already be
# installed system-wide** — push it as a Hexnode *app/package*. This script
# does NOT install the hook binary; it writes the per-user config + hook
# registration that points the installed hook at your collector. Cursor stores
# hook config per-user under ~/.cursor, and there is no enforced system tier
# (unlike Claude Code), so this runs against the logged-in user's home.
#
# Deploy in Hexnode:
#   1. Admin Console → Scripts → Add Custom Script → Platform: Mac, Type: Bash.
#   2. Paste this script AS-IS and set the script Arguments to:
#        "<fqdn>" "<ingest-bearer-token>"
#   3. Assign to your macOS device group / policy (runs as root).
#   4. Schedule a periodic re-run — it's idempotent and also re-applies after a
#      different user logs in (it targets whoever is at the console).
#
# SECURITY: the filled-in copy contains the ingest bearer token. Keep the real
# token in the Hexnode console copy only — this committed file uses
# placeholders. Rotate via ops/otel-collector/rotate-secrets.sh rotate-ingest
# and update the Hexnode script.
#
# ⚠️ TOKEN: INGEST_TOKEN is the CLIENT→COLLECTOR ingest token — the collector's
# `ingest-bearer-token` ACA secret (= INGEST_BEARER_TOKEN). It is NOT the
# cursor_telemetry_secret / cursor-forward-bearer-token (that one is
# COLLECTOR→UrNammu). Mixing them up yields a 401 at the collector. Read it with:
#   az containerapp secret show -g certifid-ai-governance -n cc-otel-app \
#     --secret-name ingest-bearer-token --query value -o tsv
#
# CURSOR_OTEL_MASK_PROMPTS=false sends prompt
# text to the collector so UrNammu can run dangerous-prompt detection
# in-memory (the raw prompt is never stored). Set it to "true" to keep prompts
# off the wire entirely (disables Cursor prompt-risk).

set -euo pipefail

# ── Arguments (set in the Hexnode custom-script "Arguments" field) ───────
#   $1 = collector FQDN   e.g. cc-otel-app.<region>.azurecontainerapps.io
#   $2 = ingest token     the collector ingest-bearer-token (NOT the forward secret)
#   $3 = email domain     optional, default certifid.com (blank = user.id only)
#   $4 = hook bin path    optional override if auto-detect fails
# Passing them as arguments keeps secrets out of the script body.
COLLECTOR_FQDN="${1:-}"
INGEST_TOKEN="${2:-}"
EMAIL_DOMAIN="${3:-certifid.com}"
HOOK_BIN_OVERRIDE="${4:-}"
# ─────────────────────────────────────────────────────────────────────────

if [ -z "$COLLECTOR_FQDN" ] || [ -z "$INGEST_TOKEN" ]; then
  echo "ERROR: pass collector FQDN (\$1) and ingest token (\$2) as script arguments" >&2
  exit 1
fi

# Hexnode runs as root. Configure the human at the console, not root.
CONSOLE_USER="$(/usr/bin/stat -f%Su /dev/console 2>/dev/null || true)"
if [ -z "$CONSOLE_USER" ] || [ "$CONSOLE_USER" = "root" ] || [ "$CONSOLE_USER" = "loginwindow" ]; then
  echo "No active console user (got '${CONSOLE_USER:-}'). Nothing to configure; will re-run on next schedule."
  exit 0
fi

USER_HOME="$(/usr/bin/dscl . -read /Users/"$CONSOLE_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
USER_GROUP="$(id -gn "$CONSOLE_USER" 2>/dev/null || echo staff)"
if [ -z "$USER_HOME" ] || [ ! -d "$USER_HOME" ]; then
  echo "ERROR: could not resolve home directory for $CONSOLE_USER" >&2
  exit 1
fi

# Per-user span attribution. UrNammu reads user.email → userEmail (the
# "Most Active Users" dimension) and user.id → userId. Requires the hook to
# honor OTEL_RESOURCE_ATTRIBUTES (Resource.create() in the pkg build).
OTEL_RES_ATTRS="user.id=${CONSOLE_USER}"
if [ -n "$EMAIL_DOMAIN" ]; then
  OTEL_RES_ATTRS="${OTEL_RES_ATTRS},user.email=${CONSOLE_USER}@${EMAIL_DOMAIN}"
fi

# Locate the hook executable the .pkg installed. It is named "cursor-otel-hook".
SYS_DIR="/Library/Application Support/CursorOtelHook"
HOOK_BIN="$HOOK_BIN_OVERRIDE"
if [ -z "$HOOK_BIN" ]; then
  for c in \
    "$SYS_DIR/venv/bin/cursor-otel-hook" \
    "$SYS_DIR/bin/cursor-otel-hook" \
    "$SYS_DIR/cursor-otel-hook" \
    "/usr/local/bin/cursor-otel-hook" \
    "/opt/homebrew/bin/cursor-otel-hook"; do
    if [ -x "$c" ]; then HOOK_BIN="$c"; break; fi
  done
fi
# Fall back to resolving "cursor-otel-hook" on PATH, wherever the .pkg put it.
if [ -z "$HOOK_BIN" ]; then
  HOOK_BIN="$(command -v cursor-otel-hook 2>/dev/null || true)"
fi
if [ -z "$HOOK_BIN" ] || [ ! -x "$HOOK_BIN" ]; then
  echo "ERROR: cursor-otel-hook executable not found under $SYS_DIR." >&2
  echo "       Push the cursor-otel-hook .pkg as a Hexnode app first, or set" >&2
  echo "       HOOK_BIN_OVERRIDE to its absolute path." >&2
  exit 1
fi

CURSOR_DIR="$USER_HOME/.cursor"
HOOKS_DIR="$CURSOR_DIR/hooks"
CONFIG="$HOOKS_DIR/otel_config.json"
WRAPPER="$HOOKS_DIR/otel_hook.sh"
HOOKS_JSON="$CURSOR_DIR/hooks.json"
CA_BUNDLE="$HOOKS_DIR/ca-bundle.pem"

install -d -o "$CONSOLE_USER" -g "$USER_GROUP" -m 755 "$CURSOR_DIR"
install -d -o "$CONSOLE_USER" -g "$USER_GROUP" -m 755 "$HOOKS_DIR"

# ── CA bundle — trust the corporate TLS-intercepting proxy ───────────────
# Many managed fleets run a TLS-inspecting proxy (Netskope/Zscaler/etc). Its
# root CA is in the macOS keychain (so curl/Safari trust it) but NOT in
# Python's certifi bundle, so the hook's OTLP/HTTPS export fails with
# CERTIFICATE_VERIFY_FAILED. Export the system + root keychains into a bundle
# the wrapper points the exporter at. Harmless on un-proxied devices — the
# bundle still contains the public roots. Refresh on each (idempotent) run so
# it tracks proxy-root rotations.
TMP_CA="$(mktemp)"
/usr/bin/security find-certificate -a -p \
  /System/Library/Keychains/SystemRootCertificates.keychain > "$TMP_CA" 2>/dev/null || true
/usr/bin/security find-certificate -a -p \
  /Library/Keychains/System.keychain >> "$TMP_CA" 2>/dev/null || true
if [ -s "$TMP_CA" ] && grep -q "BEGIN CERTIFICATE" "$TMP_CA"; then
  install -o "$CONSOLE_USER" -g "$USER_GROUP" -m 644 "$TMP_CA" "$CA_BUNDLE"
else
  echo "WARN: could not export keychain CA bundle; TLS-intercepted devices may fail to export." >&2
fi
rm -f "$TMP_CA"

# ── otel_config.json — points the hook at our collector ──────────────────
# NOTE: the endpoint MUST include the /v1/traces path. The hook's http/protobuf
# branch passes the endpoint to OTLPSpanExporter as-is and does NOT append the
# OTLP signal path (its http/json branch does) — without /v1/traces the
# collector returns 404.
TMP_CFG="$(mktemp)"
cat > "$TMP_CFG" <<JSON
{
  "OTEL_EXPORTER_OTLP_ENDPOINT": "https://${COLLECTOR_FQDN}/v1/traces",
  "OTEL_SERVICE_NAME": "cursor-agent",
  "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
  "OTEL_EXPORTER_OTLP_INSECURE": "false",
  "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer ${INGEST_TOKEN}",
  "CURSOR_OTEL_MASK_PROMPTS": "false",
  "OTEL_EXPORTER_OTLP_TIMEOUT": "30"
}
JSON
if ! /usr/bin/plutil -convert json -o /dev/null "$TMP_CFG" >/dev/null 2>&1; then
  echo "ERROR: generated otel_config.json is not valid JSON" >&2
  rm -f "$TMP_CFG"; exit 1
fi
# 600: contains the bearer token. Owned by the user so Cursor can read it.
install -o "$CONSOLE_USER" -g "$USER_GROUP" -m 600 "$TMP_CFG" "$CONFIG"
rm -f "$TMP_CFG"

# ── wrapper that the hook registration invokes ───────────────────────────
TMP_W="$(mktemp)"
cat > "$TMP_W" <<SH
#!/bin/bash
# Auto-generated by Hexnode. Invokes the system cursor-otel-hook with this
# user's config. Cursor passes the hook event JSON on stdin.
# Point Python's TLS at the keychain-derived bundle so the OTLP/HTTPS export
# trusts a corporate TLS-intercepting proxy (certifi alone does not).
if [ -f "$CA_BUNDLE" ]; then
  export REQUESTS_CA_BUNDLE="$CA_BUNDLE"
  export SSL_CERT_FILE="$CA_BUNDLE"
  export OTEL_EXPORTER_OTLP_CERTIFICATE="$CA_BUNDLE"
fi
# Attribute spans to this user (hook merges OTEL_RESOURCE_ATTRIBUTES into the
# span resource; UrNammu reads user.email/user.id off it).
export OTEL_RESOURCE_ATTRIBUTES="$OTEL_RES_ATTRS"
exec "$HOOK_BIN" --config "$CONFIG"
SH
install -o "$CONSOLE_USER" -g "$USER_GROUP" -m 755 "$TMP_W" "$WRAPPER"
rm -f "$TMP_W"

# ── hooks.json registration (merge — never clobber other hooks) ──────────
# Events we register. Trim if Cursor rejects any in your version; the
# governance-relevant ones are beforeSubmitPrompt (prompt-risk), tool/shell/MCP
# use, file edits, and session start/end.
EVENTS="sessionStart sessionEnd beforeSubmitPrompt preToolUse postToolUse beforeShellExecution beforeMCPExecution afterFileEdit stop"

# Prefer the pkg's bundled python for a safe JSON merge; fall back to system.
PYBIN=""
for p in "$SYS_DIR/venv/bin/python3" "$SYS_DIR/venv/bin/python" /usr/bin/python3 /usr/local/bin/python3; do
  if [ -x "$p" ]; then PYBIN="$p"; break; fi
done

TMP_H="$(mktemp)"
if [ -n "$PYBIN" ]; then
  HOOKS_JSON_PATH="$HOOKS_JSON" WRAPPER_CMD="$WRAPPER" EVENTS="$EVENTS" OUT="$TMP_H" "$PYBIN" - <<'PY'
import json, os
path = os.environ["HOOKS_JSON_PATH"]
cmd = os.environ["WRAPPER_CMD"]
events = os.environ["EVENTS"].split()
out = os.environ["OUT"]

data = {"version": 1, "hooks": {}}
if os.path.exists(path):
    try:
        with open(path) as f:
            existing = json.load(f)
        if isinstance(existing, dict):
            data = existing
            data.setdefault("version", 1)
            if not isinstance(data.get("hooks"), dict):
                data["hooks"] = {}
    except Exception:
        pass  # malformed existing file → start fresh

hooks = data["hooks"]
for ev in events:
    arr = hooks.get(ev)
    if not isinstance(arr, list):
        arr = []
    if not any(isinstance(h, dict) and h.get("command") == cmd for h in arr):
        arr.append({"command": cmd, "timeout": 5})
    hooks[ev] = arr

with open(out, "w") as f:
    json.dump(data, f, indent=2)
PY
else
  # No python anywhere — back up any existing file, then write a fresh one.
  if [ -f "$HOOKS_JSON" ]; then
    cp -p "$HOOKS_JSON" "$HOOKS_JSON.bak.$(date +%s 2>/dev/null || echo backup)" || true
    echo "WARN: no python3 found; existing hooks.json backed up and overwritten (other hooks may be lost)." >&2
  fi
  {
    printf '{\n  "version": 1,\n  "hooks": {\n'
    first=1
    for ev in $EVENTS; do
      if [ $first -eq 1 ]; then first=0; else printf ',\n'; fi
      printf '    "%s": [{"command": "%s", "timeout": 5}]' "$ev" "$WRAPPER"
    done
    printf '\n  }\n}\n'
  } > "$TMP_H"
fi

if ! /usr/bin/plutil -convert json -o /dev/null "$TMP_H" >/dev/null 2>&1; then
  echo "ERROR: generated hooks.json is not valid JSON" >&2
  rm -f "$TMP_H"; exit 1
fi
install -o "$CONSOLE_USER" -g "$USER_GROUP" -m 644 "$TMP_H" "$HOOKS_JSON"
rm -f "$TMP_H"

echo "Configured cursor-otel-hook for $CONSOLE_USER → https://$COLLECTOR_FQDN"
exit 0
