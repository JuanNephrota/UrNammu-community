#!/bin/bash
# Deploy the UrNammu endpoint agent to a managed Mac (Jamf Pro policy script).
#
# Jamf Pro is Apple-only, so this is the macOS half of the rollout. For Windows
# use the Iru or Hexnode scripts in this directory.
#
# ── Setting it up in Jamf Pro ────────────────────────────────────────────────
# Settings → Computer Management → Scripts → New, paste this file, then on the
# Options tab label parameters 4-7:
#
#   Parameter 4  Console URL            https://urnammu.example.com
#   Parameter 5  Enrollment secret      (from Settings → Endpoint Agent)
#   Parameter 6  Binary URL             https://.../urnammu-agent-darwin-universal
#   Parameter 7  Expected version       0.5.0        (optional; see below)
#
# Then Policies → New, add the script, and scope it. Trigger: Recurring
# Check-in with Execution Frequency "Ongoing" — the script is idempotent and
# re-running it is how an upgrade rolls out.
#
# Jamf always passes $1 (mount point), $2 (computer name) and $3 (username);
# custom parameters therefore start at $4. $3 is honoured as the console user
# when Jamf populates it, which it does for policies that run with a user
# logged in; otherwise the script falls back to reading /dev/console.
#
# Parameter 7 is optional but recommended. When set, the script skips the
# download entirely if the installed binary already reports that version,
# which turns an Ongoing policy from "re-download on every check-in across the
# whole fleet" into a no-op until you bump the version.
#
# ── Prerequisites ────────────────────────────────────────────────────────────
# The binary must be signed with a Developer ID certificate. Signing is not
# optional if you want the Safari collector: a PPPC profile grants Full Disk
# Access by code requirement, so an unsigned binary cannot be granted it.
set -euo pipefail

CONSOLE_URL="${4:-}"
ENROLLMENT_SECRET="${5:-}"
BINARY_URL="${6:-}"
EXPECTED_VERSION="${7:-}"

SUPPORT_DIR="/Library/Application Support/UrNammu"
CONFIG_PATH="$SUPPORT_DIR/agent.json"
BINARY_PATH="/usr/local/bin/urnammu-agent"
PLIST_LABEL="com.urnammu.agent"
PLIST_PATH="/Library/LaunchAgents/$PLIST_LABEL.plist"

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root" >&2
  exit 1
fi

if [ -z "$CONSOLE_URL" ] || [ -z "$ENROLLMENT_SECRET" ] || [ -z "$BINARY_URL" ]; then
  echo "parameters 4 (console URL), 5 (enrollment secret) and 6 (binary URL) are required" >&2
  exit 1
fi

# The console user, not root. Endpoint findings are attributed to a person.
# Jamf's $3 is authoritative when populated; /dev/console covers the rest.
CONSOLE_USER="${3:-}"
if [ -z "$CONSOLE_USER" ] || [ "$CONSOLE_USER" = "root" ]; then
  CONSOLE_USER=$(/usr/bin/stat -f%Su /dev/console)
fi
if [ -z "$CONSOLE_USER" ] || [ "$CONSOLE_USER" = "root" ]; then
  # Exit 0, not 1: no logged-in user is an ordinary state at imaging time, and
  # a red policy in Jamf should mean something is actually wrong. The next
  # check-in with a user present will install.
  echo "no console user logged in; deferring to the next check-in"
  exit 0
fi
CONSOLE_UID=$(/usr/bin/id -u "$CONSOLE_USER")

# ─── Skip when already current ───────────────────────────
# Without this an Ongoing policy re-downloads the binary on every check-in for
# every Mac in the fleet, which is a lot of egress to achieve nothing.
if [ -n "$EXPECTED_VERSION" ] && [ -x "$BINARY_PATH" ]; then
  INSTALLED_VERSION="$("$BINARY_PATH" --version 2>/dev/null || echo "")"
  if [ "$INSTALLED_VERSION" = "$EXPECTED_VERSION" ] && [ -f "$CONFIG_PATH" ] && [ -f "$PLIST_PATH" ]; then
    # Still make sure it is loaded for this user — a new user on a shared Mac
    # has the plist on disk but no job in their GUI session yet.
    if /bin/launchctl print "gui/$CONSOLE_UID/$PLIST_LABEL" >/dev/null 2>&1; then
      echo "urnammu-agent $INSTALLED_VERSION already installed and loaded for $CONSOLE_USER"
      exit 0
    fi
  fi
fi

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
# Access to — better a red policy in Jamf than a silently dead agent.
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
#
# Jamf's own $2 (computer name) is not used for identity — the agent derives a
# stable machine id from the hardware UUID, which survives a rename.
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

# Load into the console user's GUI session. bootout of a job that is not
# loaded returns non-zero, which is expected on a first install.
/bin/launchctl bootout "gui/$CONSOLE_UID/$PLIST_LABEL" 2>/dev/null || true
/bin/launchctl bootstrap "gui/$CONSOLE_UID" "$PLIST_PATH"
/bin/launchctl enable "gui/$CONSOLE_UID/$PLIST_LABEL"

INSTALLED_VERSION="$("$BINARY_PATH" --version 2>/dev/null || echo "unknown")"
echo "urnammu-agent $INSTALLED_VERSION installed and loaded for $CONSOLE_USER"
echo
echo "NOTE: Safari history needs Full Disk Access. Deploy a PPPC configuration"
echo "      profile granting SystemPolicyAllFiles to $BINARY_PATH, identified by"
echo "      its code requirement, or Safari is skipped and the console reports"
echo "      the browser collector as partial_no_access. Get the requirement with:"
echo "        codesign -dr - $BINARY_PATH"
