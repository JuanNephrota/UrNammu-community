# Endpoint agent — installable AI-activity collector

Status: **complete** (2026-09-21). Verified end to end against a local
database: enrollment, manifest, report ingest, Shadow AI rollup, alerting,
revocation, and the console pages.

Every source UrNammu has today observes AI use from the *outside*: SaaS admin
APIs (what the vendor will tell us), the proxy (what we route), DNS/CASB
exports (what crosses the corporate network), and MDM-pushed client config for
two specific tools (Claude Code, Cursor). All four go blind in the same places:

- a laptop off the VPN talking straight to `chatgpt.com`;
- a personal-tier AI account, which no enterprise admin API enumerates;
- a desktop app (Claude Desktop, ChatGPT, Copilot) that leaves no SaaS-side
  audit trail we can read;
- **local inference** — Ollama, LM Studio, llama.cpp — which is ungoverned by
  construction and invisible to every existing source.

The endpoint agent closes those gaps by observing from the *inside*: a small
signed binary, pushed by Hexnode to macOS and Windows, that reports which AI
tools a machine actually runs and reaches.

## Non-goals

- **No content.** Not prompts, not responses, not file contents, not URLs
  beyond the hostname, not window titles, not keystrokes. The agent reports
  *which tool*, *how often*, *when* — nothing about what was said to it. This
  is the same line the OTel pipeline already holds (`ClaudeCodeEvent` stores a
  risk verdict, never the prompt) and it is what makes the agent deployable
  without a works-council fight.
- **No enforcement.** The agent observes and reports. Blocking stays with the
  network feed (`/api/discovered-tools/blocklist`) and Entra app-disable.
- **Not an EDR.** No kernel extension, no ESF/ETW hooks, no injection. It runs
  unprivileged in the user's session and reads what that user can already read.

## Architecture

```
macOS / Windows endpoint
  ┌──────────────────────────────────────────┐
  │ urnammu-agent (Go, static)               │
  │   collectors → local match → aggregate   │
  │   spool (disk, survives reboot/offline)  │
  └───────────────┬──────────────────────────┘
                  │ HTTPS, Bearer <per-device token>
                  │ POST /api/endpoint-agent/report   (every 15 min)
                  │ GET  /api/endpoint-agent/manifest (hourly)
                  ▼
      UrNammu (Vercel)  ──► EndpointDevice / EndpointDetection
                        └─► DiscoveredAITool (detectionSource="endpoint_agent")
```

The agent ships **direct to UrNammu**, not through the ACA OTel collector: this
is not OTLP, and routing it through the collector would mean teaching the
collector a second schema for no gain. It reuses the collector's operational
shape though — bearer auth, spool-and-retry, idempotent ingest by content hash.

### Detection lives on the server

The agent does **not** carry its own list of AI tools. `src/lib/ai-tools-registry.ts`
is the single source of truth, and the server compiles it into a **manifest**
(domains, process/bundle patterns, runtime ports) that the agent fetches and
caches. Consequences:

- Growing the registry instantly improves every deployed agent — no re-release.
- The agent filters locally against the manifest, so a domain that matches
  nothing in the registry **never leaves the machine**. This is the privacy
  property that makes the browser collector defensible: it is an allowlist, not
  a history upload.
- Final classification (confidence, category, vendor) still runs server-side
  through `resolveAIToolMatch`, so endpoint discoveries are scored exactly like
  OAuth-scan and DNS ones.

## Collectors

| Collector | macOS | Windows | Reports |
|---|---|---|---|
| `apps` | `/Applications` + `~/Applications` bundle scan, `NSRunningApplication` via `lsappinfo`/`ps` | Uninstall registry keys + running image names | bundle id / publisher / version, running flag |
| `browser` | Chrome, Edge, Brave, Arc, Firefox, Safari history DBs | Chrome, Edge, Brave, Firefox history DBs | **hostname + visit count only**, allowlisted against the manifest |
| `runtimes` | probe `127.0.0.1` on known local-inference ports | same | runtime name, port, model list where the runtime exposes one |
| `network` | DNS cache sample (best effort) | `Get-DnsClientCache` | hostname + hit count, allowlisted |

Notes on the two awkward ones:

- **Browser.** History DBs are SQLite in WAL mode; recent visits live in the
  `-wal` file, so the agent copies DB+WAL to a temp dir and reads with a real
  SQLite implementation (`modernc.org/sqlite`, pure Go — keeps the binary
  static and cgo-free). Safari's `History.db` needs Full Disk Access; without
  it, Safari is skipped and the agent reports `safari: no_access` rather than
  failing. Chrome/Edge/Brave/Firefox profiles are readable in the user's own
  session with no special grant.
- **Network.** macOS has no unprivileged, stable DNS-cache dump, so this
  collector is genuinely best-effort there and the browser collector carries
  the weight. Windows `Get-DnsClientCache` is reliable. The collector is worth
  shipping because it catches non-browser, non-app traffic (a script hitting
  `api.openai.com`), but it is not the primary signal and the UI should not
  imply it is.

## Data model

Two new tables. `EndpointDevice` is the enrolled machine; `EndpointDetection`
is one (device, signal, tool, evidence) observation row, merged on repeat so
the table grows with the fleet, not with time.

Endpoint findings also roll up into `DiscoveredAITool` with
`detectionSource = "endpoint_agent"` through the existing merge helpers, so
Shadow AI's triage workflow (Discovered → Under Review → Registered/Blocked)
works unchanged and an endpoint-only discovery sits next to a DNS one.

## Enrollment and auth

1. Hexnode pushes the binary plus a config file holding the **enrollment
   secret** (one shared org-wide secret, rotatable in Settings).
2. On first run the agent calls `POST /api/endpoint-agent/enroll` with its
   machine id, hostname, platform and console-user email.
3. The server issues a **per-device token**, returned once and stored only as
   a SHA-256 hash. The agent persists it with `0600` perms and drops the
   enrollment secret from memory.
4. Every later call authenticates with the device token. Revoking a device in
   the UI invalidates it immediately; a revoked agent stops reporting and does
   not re-enroll on its own.

Per-device tokens matter: a shared secret readable on every laptop is a shared
secret, and one exfiltrated laptop should not let an attacker forge reports for
the whole fleet or read the manifest indefinitely.

## Ingest idempotency

Reports carry a `reportId` (UUID) and each observation a content-derived key.
Re-sending a spooled batch after a timeout is a no-op, matching the
`dedupeKey` + `skipDuplicates` convention the OTel routes already use.

## Deliverables

| # | Item | Schema | Done |
|---|---|---|---|
| 1 | `EndpointDevice`, `EndpointDetection` models + migration | yes | yes |
| 2 | `src/lib/endpoint-agent.ts` — manifest, enrollment, report ingest | — | yes |
| 3 | `src/lib/validations/endpoint-agent.ts` — Zod wire schemas | — | yes |
| 4 | `/api/endpoint-agent/{enroll,manifest,report,devices}` routes | — | yes |
| 5 | Oversight → Endpoints UI + Settings → Endpoint Agent | — | yes |
| 6 | `ops/endpoint-agent/` — Go agent, packaging, Hexnode scripts | — | yes |
| 7 | Docs: install guide, user guide, in-app help | — | yes |
| 8 | `/api/cron/endpoint-agent-sweep` staleness sweep | — | yes |

## What testing on a real machine changed

Three things only showed up once the agent ran against a live console, and all
three are worth recording because they are the kind of bug that would have
looked fine in review:

- **Every Mac would have raised a HIGH "ungoverned local model" alert.** The
  runtime collector reported on an open TCP port alone, and macOS runs the
  AirPlay Receiver on port 5000 — one of the ports in the manifest. Detection
  now requires the service to answer as a model server on its own model-listing
  path, with a body that actually contains a model list.
- **Every report with no local runtime would have been rejected.** Go marshals
  a nil slice as `null`, and a Zod `.default([])` only fires on `undefined`. The
  agent now guarantees non-nil slices, and a test pins the strict behaviour on
  both sides so the two halves cannot drift.
- **One person using ChatGPT produced six alerts.** The rollup keyed Shadow AI
  on the *observed* hostname, and browser history yields every host a tool
  touches. It now keys on the registry's canonical domain — which is what the
  DNS importer already did — so endpoint and DNS observations of the same tool
  share one row.

## Needs from the user after merge

- `npx prisma migrate deploy` against prod (the migration is not auto-applied).
- Generate the enrollment secret in Settings → Endpoint Agent.
- An Apple Developer ID cert to sign/notarize the macOS build, and an
  Authenticode cert for Windows, before the Hexnode push. Unsigned binaries
  will be Gatekeeper-blocked.
