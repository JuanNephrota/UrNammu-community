#!/bin/bash
# Deploy the UrNammu endpoint agent to a managed Mac (Hexnode custom script).
#
# Mirrors ops/cursor-hook/mdm/hexnode-deploy-cursor-hook.sh in shape: idempotent,
# safe to re-run on every check-in, and it exits non-zero only on a genuine
# failure so Hexnode's status reflects reality.
#
# Before deploying, set the three values below. The binary must already be
# signed and notarized (see the Makefile) or Gatekeeper will block it.
set -euo pipefail

CONSOLE_URL="${CONSOLE_URL:-https://REPLACE-ME.vercel.app}"
ENROLLMENT_SECRET="${ENROLLMENT_SECRET:-REPLACE-ME}"
BINARY_URL="${BINARY_URL:-https://REPLACE-ME/urnammu-agent-darwin-universal}"

SUPPORT_DIR="/Library/Application Support/UrNammu"
CONFIG_PATH="$SUPPORT_DIR/agent.json"
BINARY_PATH="/usr/local/bin/urnammu-agent"
PLIST_LABEL="com.urnammu.agent"
PLIST_PATH="/Library/LaunchAgents/$PLIST_LABEL.plist"

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root" >&2
  exit 1
fi

if [ "$CONSOLE_URL" = "https://REPLACE-ME.vercel.app" ] || [ "$ENROLLMENT_SECRET" = "REPLACE-ME" ]; then
  echo "CONSOLE_URL and ENROLLMENT_SECRET must be set before deploying" >&2
  exit 1
fi

# The console user, not root. Endpoint findings are attributed to a person, and
# on a Hexnode-managed Mac this is the reliable way to learn who that is.
CONSOLE_USER=$(/usr/bin/stat -f%Su /dev/console)
if [ -z "$CONSOLE_USER" ] || [ "$CONSOLE_USER" = "root" ]; then
  echo "no console user logged in; will retry on the next check-in" >&2
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
  echo "failed to download agent binary" >&2
  exit 1
fi

# Refuse to install a binary Gatekeeper would reject anyway — better a clear
# failure here than a silently dead agent on the endpoint.
if ! /usr/bin/codesign --verify --strict "$TMP_BINARY" 2>/dev/null; then
  echo "downloaded binary is not validly signed; refusing to install" >&2
  exit 1
fi

install -m 0755 -o root -g wheel "$TMP_BINARY" "$BINARY_PATH"
/usr/bin/xattr -d com.apple.quarantine "$BINARY_PATH" 2>/dev/null || true

# ─── Config ──────────────────────────────────────────────
# 0644 because the LaunchAgent runs as the console user and must read it. The
# enrollment secret inside is low-value by design: it can enroll a device and
# nothing else. Rotate it in Settings if a machine is lost.
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
cat > "$PLIST_PATH" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!--
  LaunchAgent for the UrNammu endpoint agent.

  A LaunchAgent, not a LaunchDaemon, and deliberately so: browser profiles live
  in the user's home directory and Full Disk Access is granted per-user, so a
  root daemon would either see nothing or need far broader privilege than this
  agent should ever hold. Running in the user's own session means the agent can
  read exactly what that user can read, and nothing else.

  Install to /Library/LaunchAgents/com.urnammu.agent.plist so it loads for
  every user at login.
-->
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
      The agent runs its own interval loop on the cadence the console dictates,
      so launchd only needs to keep it alive. KeepAlive with SuccessfulExit
      false means: restart it if it crashes, but respect a clean exit — which
      is how a revoked device stops itself without launchd fighting it.
    -->
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <!-- Back off rather than hammering a console that is down. -->
    <key>ThrottleInterval</key>
    <integer>300</integer>

    <key>ProcessType</key>
    <string>Background</string>

    <!--
      Lowest scheduling priority available. This is an inventory agent on
      someone's work machine; it must never be something they can feel.
    -->
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
EOF
chmod 0644 "$PLIST_PATH"
chown root:wheel "$PLIST_PATH"

# Reload in the console user's GUI session. bootout of a job that is not
# loaded returns non-zero, which is expected on a first install.
/bin/launchctl bootout "gui/$CONSOLE_UID/$PLIST_LABEL" 2>/dev/null || true
/bin/launchctl bootstrap "gui/$CONSOLE_UID" "$PLIST_PATH"
/bin/launchctl enable "gui/$CONSOLE_UID/$PLIST_LABEL"

echo "urnammu-agent installed and loaded for $CONSOLE_USER"
echo
echo "NOTE: Safari history needs Full Disk Access. Push a PPPC profile granting"
echo "      SystemPolicyAllFiles to $BINARY_PATH, or Safari is skipped and the"
echo "      console reports the browser collector as partial_no_access."
