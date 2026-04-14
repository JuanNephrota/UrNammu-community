# Shadow AI Discovery

Detect AI tools in use in your organization that are not yet in the Registry.

## Discovery sources

- **Google Workspace** — scans OAuth activity logs for AI apps that users have connected.
- **Microsoft 365** — scans delegated app permissions against a known-AI-tools registry.
- **DNS / proxy logs** — CSV upload or JSON API ingestion of network-observed AI domains.

## Confidence scoring

Every discovered tool is assigned a match confidence based on how it was identified:

- **High** (score 10+) — strong match via domain + name or multiple signals.
- **Medium** (score 6–9) — partial match via name or publisher only.
- **Low** (score < 6) — heuristic match via AI keywords (e.g. ".ai" domain, "gpt", "copilot") but no known registry entry.

## Page sections

The page splits discoveries into three sections:

1. **Needs Review** — high-confidence matches and legacy tools. These are confirmed AI tools that need a governance decision: **Convert to Governed System**, **Register & Assess**, **Approve**, or **Block**.
2. **Low-Confidence Candidates** — medium and low-confidence matches. Each shows a confidence badge, score, and match reasons. Actions: **Promote** (move to main queue as high-confidence) or **Dismiss** (permanently suppress with a reason).
3. **Resolved** — tools that have been registered, approved, or blocked.

## Automatic suppression

Discoveries whose name (and vendor, when present) match an existing Registry system are auto-linked and suppressed. Dismissed candidates are also suppressed — the scanner checks the dismissed list before creating new records.

## Scan triggers

- **Manual**: click **Scan Google Workspace** or **Scan Microsoft 365**.
- **Automatic**: configured in Settings → Shadow AI (cron fires hourly, each provider checks its own interval).
