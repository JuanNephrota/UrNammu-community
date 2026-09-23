#!/bin/bash
# Iru (formerly Kandji) — macOS Custom Script, REMEDIATION half.
#
# Paste this as the Remediation Script of the same Custom Script Library Item
# that carries iru-audit-endpoint-agent.sh as its Audit Script. Iru runs it
# only when the audit exits non-zero, so it is an installer, not a check.
#
# Keep the four values below in sync with the audit script — EXPECTED_VERSION
# and CONSOLE_URL in particular, or audit and remediation will disagree and the
# item will reinstall on every check-in forever.
#
# The binary must be signed with a Developer ID certificate. Signing is not
# optional if you want the Safari collector: a PPPC profile grants Full Disk
# Access by code requirement, so an unsigned binary cannot be granted it.
set -euo pipefail

CONSOLE_URL="https://REPLACE-ME.example.com"
ENROLLMENT_SECRET="REPLACE-ME"
BINARY_URL="https://REPLACE-ME/urnammu-agent-darwin-universal"

SUPPORT_DIR="/Library/Application Support/UrNammu"
CONFIG_PATH="$SUPPORT_DIR/agent.json"
BINARY_PATH="/usr/local/bin/urnammu-agent"
PLIST_LABEL="com.urnammu.agent"
PLIST_PATH="/Library/LaunchAgents/$PLIST_LABEL.plist"

if [ "$CONSOLE_URL" = "https://REPLACE-ME.example.com" ] || [ "$ENROLLMENT_SECRET" = "REPLACE-ME" ]; then
  echo "CONSOLE_URL and ENROLLMENT_SECRET must be set before deploying" >&2
  exit 1
fi

CONSOLE_USER=$(/usr/bin/stat -f%Su /dev/console)
if [ -z "$CONSOLE_USER" ] || [ "$CONSOLE_USER" = "root" ]; then
  echo "no console user logged in; deferring to the next check-in"
  exit 0
fi
CONSOLE_UID=$(/usr/bin/id -u "$CONSOLE_USER")

echo "installing urnammu-agent for $CONSOLE_USER"

mkdir -p "$SUPPORT_DIR"
chmod 755 "$SUPPORT_DIR"

# ─── Binary ──────────────────────────────────────────────
TMP_BINARY=$(mktemp)
trap 'rm -f "$TMP_BINARY"' EXIT
if ! /usr/bin/curl -fsSL "$BINARY_URL" -o "$TMP_BINARY"; then
  echo "failed to download agent binary from $BINARY_URL" >&2
  exit 1
fi

# Refuse a binary Gatekeeper would reject and TCC could never grant Full Disk
# Access to. Failing loudly here beats a silently dead agent that the audit
# will then try to fix on every check-in.
if ! /usr/bin/codesign --verify --strict "$TMP_BINARY" 2>/dev/null; then
  echo "downloaded binary is not validly signed; refusing to install" >&2
  exit 1
fi

# Stop the running job before replacing the file it is executing.
/bin/launchctl bootout "gui/$CONSOLE_UID/$PLIST_LABEL" 2>/dev/null || true

install -m 0755 -o root -g wheel "$TMP_BINARY" "$BINARY_PATH"
/usr/bin/xattr -d com.apple.quarantine "$BINARY_PATH" 2>/dev/null || true

# ─── Config ──────────────────────────────────────────────
# 0644 because the LaunchAgent runs as the console user and must read it. The
# enrollment secret inside is low-value by design: it can enroll a device and
# nothing else. Rotate it in Settings → Endpoint Agent if a machine is lost.
USER_EMAIL="${USER_EMAIL:-$CONSOLE_USER@$(hostname -d 2>/dev/null || echo localdomain)}"
cat > "$CONFIG_PATH" <<EOF
{
  "consoleUrl": "$CONSOLE_URL",
  "enrollmentSecret": "$ENROLLMENT_SECRET",
  "userEmail": "$USER_EMAIL"
}
EOF
chmod 0644 "$CONFIG_PATH"
chown root:wheel "$CONFIG_PATH"

# ─── LaunchAgent ─────────────────────────────────────────
# A LaunchAgent, not a LaunchDaemon: browser profiles live in the user's home
# and Full Disk Access is granted per-user, so a root daemon would either see
# nothing or need far broader privilege than this agent should hold.
cat > "$PLIST_PATH" <<'PLISTEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.urnammu.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/urnammu-agent</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <!--
      KeepAlive with SuccessfulExit false: restart on crash, but respect a
      clean exit — which is how a revoked device stops itself without launchd
      fighting it.
    -->
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>300</integer>
    <key>ProcessType</key>
    <string>Background</string>
    <key>Nice</key>
    <integer>10</integer>
    <key>LowPriorityIO</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/urnammu-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/urnammu-agent.log</string>
</dict>
</plist>
PLISTEOF
chmod 0644 "$PLIST_PATH"
chown root:wheel "$PLIST_PATH"

/bin/launchctl bootout "gui/$CONSOLE_UID/$PLIST_LABEL" 2>/dev/null || true
/bin/launchctl bootstrap "gui/$CONSOLE_UID" "$PLIST_PATH"
/bin/launchctl enable "gui/$CONSOLE_UID/$PLIST_LABEL"

INSTALLED_VERSION="$("$BINARY_PATH" --version 2>/dev/null || echo "unknown")"
echo "urnammu-agent $INSTALLED_VERSION installed and loaded for $CONSOLE_USER"
echo
echo "NOTE: Safari history needs Full Disk Access. Deploy a PPPC profile granting"
echo "      SystemPolicyAllFiles to $BINARY_PATH, or Safari is skipped and the"
echo "      console reports the browser collector as partial_no_access."
