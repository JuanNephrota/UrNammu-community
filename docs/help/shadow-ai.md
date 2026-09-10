# Shadow AI Discovery

Detect AI tools in use in your organization that are not yet in the Registry.

## Discovery sources

Four scanning sources, each independently configurable:

- **Google Workspace** — scans OAuth activity logs for AI apps that users have connected.
- **Microsoft 365** — scans delegated app permissions in your tenant against a known-AI-tools registry.
- **Hexnode UEM** — reads the app inventory from managed devices, catching desktop and mobile apps that never touch an OAuth flow.
- **CrowdStrike Falcon** — endpoint discovery, for AI tools observed running on protected hosts.

Plus two import paths that need no live connection:

- **DNS / proxy logs** — CSV or TXT upload, or JSON API ingestion, of network-observed AI domains. Hostnames are normalized before matching, so `api.openai.com`, `openai.com.`, and mixed-case variants resolve to the same tool.
- **Netskope** — a dedicated import for Netskope's cloud log shipper.

The identity-based sources (Google, Microsoft) only see apps federated to your IdP. A tool someone signed into with a personal account is invisible to them and must be caught by device inventory or network logs — which is why the sources are complementary rather than redundant.

## Confidence scoring

Every discovered tool is assigned a match confidence based on how it was identified:

- **High** (score 10+) — strong match via domain + name or multiple signals.
- **Medium** (score 6–9) — partial match via name or publisher only.
- **Low** (score < 6) — heuristic match via AI keywords (e.g. ".ai" domain, "gpt", "copilot") but no known registry entry.

## Page sections

The page splits discoveries into three sections:

- **Needs Review** — high-confidence matches and legacy tools. These are confirmed AI tools that need a governance decision: **Convert to Governed System**, **Register & Assess**, **Approve**, or **Block**.
- **Low-Confidence Candidates** — medium and low-confidence matches. Each shows a confidence badge, score, and match reasons. Actions: **Promote** (move to main queue as high-confidence) or **Dismiss** (permanently suppress with a reason).
- **Resolved** — tools that have been registered, approved, or blocked.

## Scan triggers

- **Manual**: click **Scan All Sources**. Every configured source runs; unconfigured ones are skipped cleanly and reported as such, so it is always clear which sources actually ran.
- **Automatic**: configured in **Settings → Shadow AI** (cron fires hourly; each source checks its own interval).

## What "Block" actually does

Blocking records the decision in UrNammu — but UrNammu is not in your traffic path, so the block only takes effect through one of two enforcement layers:

- **Network** — blocked domains are published on an authenticated feed at `/api/discovered-tools/blocklist`, which a DNS sinkhole, proxy ACL, firewall URL list, or CASB polls to enforce. Formats: `text` (default), `hosts`, `json`, and `pac`, selected with `?format=`. The feed requires a Bearer token and fails closed — with no token configured it returns 503 rather than serving unauthenticated. Set the token in **Settings → Shadow AI**.
- **Identity** — where the tool is federated to Google Workspace or Microsoft 365 and the scan captured an app handle, blocking disables the app at the identity provider so sign-ins stop. Tools discovered without an app handle report `skipped`; a provider missing the required admin permission reports `failed`.

Check **Settings → Shadow AI** for a readiness summary of both layers. A blocked tool with neither layer configured is a documented decision, not an enforced one.

## Automatic suppression

Discoveries whose name (and vendor, when present) match an existing Registry system are auto-linked and suppressed. Dismissed candidates are also suppressed — the scanner checks the dismissed list before creating new records.
