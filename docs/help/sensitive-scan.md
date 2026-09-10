# Sensitive Scan

Two related defenses against sensitive data leaving — or coming back out of — your AI tools: an active prober that tests reachable endpoints, and passive inspection of live proxy traffic.

## Probe targets

Probing runs against AI gateways you have configured — **OpenRouter**, **Helicone**, **Portkey**, and **LiteLLM**. Each configured gateway becomes a target; unconfigured ones are skipped. Configure credentials at **Integrations** or **Settings → Provider Admin APIs**.

## What the probes test

Four probes, each a crafted prompt that a well-configured endpoint should refuse:

- **System prompt extraction** (`prompt_disclosure`) — attempts to make the model reveal its own system prompt. Critical if it leaks.
- **Credential / secret recall** (`secret_disclosure`) — attempts to surface API keys or credentials from context or training data. Critical if it leaks.
- **PII recall** (`pii_disclosure`) — attempts to elicit personal data about individuals. Critical if it leaks.
- **Training-data exfiltration** (`data_exfiltration`) — attempts verbatim recall of training material. Raises a warning rather than a critical.

A probe that leaks creates a finding with its category and severity, and raises an alert. Each target is recorded with a status — `probed`, `skipped` (not configured), or `error` — and a finding count, so a clean result reads as "probed, 0 findings" rather than as silence. Distinguishing `probed` from `skipped` matters: a skipped target was never tested.

## Inline response DLP

Independently of probing, traffic through the proxy is inspected in both directions against four built-in detectors:

- **Secret or credential extraction attempt** — the prompt is fishing for credentials.
- **Sensitive data exfiltration attempt** — the prompt is trying to move sensitive data out.
- **Sensitive data pasted into prompt** — a user pasted sensitive material **in**. Often the most common finding, and usually careless rather than malicious.
- **API key or token present** — a live-looking key or token appears in the text.

Matches are recorded as findings and linked to an alert. Excerpts are redacted before storage — UrNammu keeps the matched shape and a sanitized snippet, never the full prompt or response.

## Scheduling

Probes can run on a schedule as well as on demand, so a gateway that silently changes its retention or system-prompt handling is caught without someone remembering to check. Findings accumulate on this page and in **Alerts**.

## Reading a finding

Treat a finding as a lead, not a verdict. A gateway may legitimately echo a system prompt you authored yourself, and a detector may match a documentation example that merely looks like a key. Confirm before escalating, and mark genuine non-issues so the noise does not train your team to skim past the real ones.
