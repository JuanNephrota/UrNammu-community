#!/bin/bash
# Iru (formerly Kandji) — macOS Custom Script, AUDIT half.
#
# Paste this as the Audit Script of a "Custom Script" Library Item, and
# iru-remediate-endpoint-agent.sh as its Remediation Script.
#
#   Library → Add Library Item → Custom Script
#   Execution Frequency: Run every 15 minutes (check-in) or Run daily
#
# Contract: exit 0 = pass (Iru does nothing), any non-zero exit = failure,
# which makes Iru run the remediation script. So this file only decides
# *whether* the agent needs attention; it never installs anything.
#
# Splitting it this way is the point of using Iru rather than a blind
# installer script. A fleet-wide installer on a 15-minute check-in re-downloads
# the binary to every Mac forever; this runs a few cheap local checks and stays
# quiet until something is actually wrong.
#
# Set EXPECTED_VERSION to roll out an upgrade: bump it here, audit starts
# failing across the fleet, remediation installs the new build.
set -uo pipefail

EXPECTED_VERSION="0.5.0"
CONSOLE_URL="https://REPLACE-ME.example.com"

SUPPORT_DIR="/Library/Application Support/UrNammu"
CONFIG_PATH="$SUPPORT_DIR/agent.json"
BINARY_PATH="/usr/local/bin/urnammu-agent"
PLIST_LABEL="com.urnammu.agent"
PLIST_PATH="/Library/LaunchAgents/$PLIST_LABEL.plist"

fail() {
  echo "$1"
  exit 1
}

# No console user is not a failure — there is simply nothing to install into
# yet, and reporting it as one would light up the fleet at imaging time.
CONSOLE_USER=$(/usr/bin/stat -f%Su /dev/console)
if [ -z "$CONSOLE_USER" ] || [ "$CONSOLE_USER" = "root" ]; then
  echo "no console user logged in; nothing to audit"
  exit 0
fi
CONSOLE_UID=$(/usr/bin/id -u "$CONSOLE_USER")

[ -x "$BINARY_PATH" ] || fail "agent binary missing at $BINARY_PATH"
[ -f "$CONFIG_PATH" ] || fail "agent config missing at $CONFIG_PATH"
[ -f "$PLIST_PATH" ] || fail "LaunchAgent missing at $PLIST_PATH"

INSTALLED_VERSION="$("$BINARY_PATH" --version 2>/dev/null || echo "")"
[ -n "$INSTALLED_VERSION" ] || fail "agent binary will not report a version; likely corrupt"
[ "$INSTALLED_VERSION" = "$EXPECTED_VERSION" ] || \
  fail "agent is $INSTALLED_VERSION, expected $EXPECTED_VERSION"

# Point the fleet at a new console by editing CONSOLE_URL here: a mismatch
# fails the audit and remediation rewrites the config.
if ! /usr/bin/grep -q "\"consoleUrl\": *\"$CONSOLE_URL\"" "$CONFIG_PATH" 2>/dev/null; then
  fail "agent config does not point at $CONSOLE_URL"
fi

# Signature still valid? Catches a partially-written binary from an interrupted
# download, and a build that was replaced by something unsigned.
/usr/bin/codesign --verify --strict "$BINARY_PATH" 2>/dev/null || \
  fail "agent binary is no longer validly signed"

# The job must be *loaded* in the user's GUI session. Deliberately not a check
# that the process is currently running: a revoked device exits cleanly by
# design and launchd respects that, so testing liveness would fight revocation
# forever — reinstalling a machine the console has deliberately cut off.
/bin/launchctl print "gui/$CONSOLE_UID/$PLIST_LABEL" >/dev/null 2>&1 || \
  fail "LaunchAgent not loaded for $CONSOLE_USER"

echo "urnammu-agent $INSTALLED_VERSION installed and loaded for $CONSOLE_USER"
exit 0
