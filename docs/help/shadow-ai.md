# Shadow AI Discovery

Detect AI tools in use in your organization that are not yet in the Registry.

## Discovery sources

- **Google Workspace** — scans OAuth activity logs for AI apps that users have connected.
- **Microsoft 365** — scans delegated app permissions against a known-AI-tools registry.
- **DNS / proxy logs** — CSV upload or JSON API ingestion of network-observed AI domains.

## Triage workflow

Discoveries flow through: `DISCOVERED` → `UNDER_REVIEW` → `REGISTERED` / `APPROVED` / `BLOCKED`.

On each row:

- **Link to system** — attach the discovery to an existing governed system.
- **Mark approved** — permit without adding to the Registry.
- **Mark blocked** — indicate it is not allowed; organizational signal, not a technical block.
- **Add notes** — confidence reasoning and reviewer observations.

## Automatic suppression

Discoveries whose name (and vendor, when present) match an existing Registry system are auto-linked and suppressed. They do not appear in the shadow-AI queue and do not raise a new-discovery alert — the tool is already under governance.

The reverse also runs: when a new system is registered, pre-existing unlinked discoveries that match are back-linked in the same transaction.

## Scan triggers

- **Manual**: click **Scan Google Workspace** or **Scan Microsoft 365**.
- **Automatic**: configured in Settings → Shadow AI (cron fires hourly, each provider checks its own interval).
