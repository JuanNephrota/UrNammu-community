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
  *which tool*, *how often*, *when* — nothing about what was said to it. The
  MCP collector adds the one exception to "hostname is the most specific
  thing": a configured MCP server's *name* and, for package-runner launchers,
  its *package id* — both identifiers, both shape-restricted on the device and
  again by the server (see *MCP configs* below). This
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
| `agents` | MCP client config files at fixed paths; well-known site-packages / global node_modules | same | per MCP server: client, name, transport, bare remote host *or* launcher category + package id; per agent framework: id, ecosystem, location kind, count |

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

### MCP configs — what is kept and what is thrown away

MCP client config files are the most secret-dense files on a developer
laptop: `env` blocks hold API keys, `args` hold database URLs with passwords
and the directories a filesystem server may touch, `headers` hold bearer
tokens, and remote URLs carry tokens in query strings. The `agents` collector
therefore parses each file in memory and keeps exactly this, per server:

| Field | Derived from | Never includes |
|---|---|---|
| `client` | which file it came from (closed enum) | the file path |
| `name` | the config key, if it matches `^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,63}$` and is not credential-shaped; otherwise `redacted-<first 8 hex of sha256>` | slashes, colons, `=`, `@`, URLs, tokens |
| `transport` | `type` / presence of `url` / `command` → `stdio` \| `http` \| `sse` \| `ws` | — |
| `host` | remote servers: `url.Hostname()`, lowercased, validated as a DNS name; reduced to its last two labels when any label is credential-shaped or a long hex/base62 run, and to the bare service for tunnels (`jdoe.ngrok.io` → `ngrok.io`); loopback (including `127.1`-style shorthand) → `loopback: true`, IPv6, other numeric or templated URLs → nothing | scheme, port, path, query, fragment, userinfo, secret-bearing labels |
| `launcher` | stdio servers: command basename mapped to a closed category (`npx`, `uvx`, `docker`, `node`, `python`, …); any other executable is `binary` | the command path or basename |
| `package` | only for `npx`/`bunx`/`pnpm dlx`/`yarn dlx`/`uvx`/`uv tool run`/`pipx run`/`docker run`: the first package/image argument, version/tag/digest/registry host stripped, validated against a lowercase package-id regex and the credential check. The parse stops (no package) at any flag it does not know, so `--token <value>` can never be read as the package; docker references that look like paths are refused | every other argument, `env`, `headers`, `cwd`, paths, git/file/URL specs |

The credential check flags a known token prefix at the start of a value or
after any separator (`Bearer sk-…`), any 20+ character alphanumeric run with a
digit, any 32+ character pure-hex run, and long mixed-case strings; the server
schema applies the same rules independently. The `redacted-<8 hex>` placeholder
is an unsalted 32-bit hash for de-duplication, not secrecy: a guessable
original (a common path shape) can be recovered, which is why only names that
fail the plain-identifier rule are hashed and the rest are dropped entirely.

Disabled servers and Claude Code in-process (`sdk`) servers are dropped.
The per-project keys of `~/.claude.json` are absolute paths; they are used
only to iterate and are never retained. Files are read only if they are
regular files under a size cap (4 MiB; 32 MiB for `~/.claude.json`), at most
64 distinct servers per file and 256 per report — de-duplicated before the
caps, and a scan any cap or the 10-second time budget cuts short reports
`truncated`, so ingest never clears rows on it. No home directory reports
`no_home` for the same reason. JSONC, the Continue YAML subset and
the Codex TOML subset are parsed by small hand readers, so the binary keeps
SQLite as its only dependency.

The server re-validates every field (`endpointMcpServerSchema`): `name` has
the same regex and credential check, `host` is the bare-hostname type,
`package` must fit its launcher (npm scope only for npm launchers, one
namespace slash only for docker, no slash for PyPI), and a remote server may
not carry a launcher or package. A report that violates any of it is
rejected whole — the same "a compromised agent cannot widen the channel"
property the `hostname` type gives the browser collector.

Agent frameworks are detected by listing a bounded set of package
directories — never by walking the home directory — so project virtualenvs
are out of scope by design. Only framework id, ecosystem, location kind
(`user_site`, `system_site`, `pipx`, `uv_tool`, `conda`, `npm_global`) and an
environment count leave the machine.

Client config paths (checked against each client's documentation, 2026-09):

| Client | macOS | Windows |
|---|---|---|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `%APPDATA%\Claude\…`, plus the MSIX `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\…` |
| Claude Code | `~/.claude.json` (user + per-project), `~/.claude/settings.json`, `~/.mcp.json`, `/Library/Application Support/ClaudeCode/managed-mcp.json` | same dotfiles under `%USERPROFILE%`, `%ProgramFiles%\ClaudeCode\managed-mcp.json` |
| Cursor | `~/.cursor/mcp.json` | same |
| Windsurf / Devin | `~/.codeium/windsurf/mcp_config.json`, `~/.config/devin/mcp_config.json` | `%USERPROFILE%\.codeium\…`, `%APPDATA%\devin\mcp_config.json` |
| VS Code (+ Insiders, VSCodium) | `<config>/Code/User/mcp.json` (`servers`), `settings.json` (`mcp.servers`) | same under `%APPDATA%` |
| Cline / Roo Code | `<config>/{Code,Cursor,Windsurf,…}/User/globalStorage/{saoudrizwan.claude-dev/settings/cline_mcp_settings.json, rooveterinaryinc.roo-cline/settings/mcp_settings.json}` | same under `%APPDATA%` |
| Zed | `~/.config/zed/settings.json` (`context_servers`) | `%APPDATA%\Zed\settings.json` |
| Continue | `~/.continue/config.yaml`, `config.json`, `mcpServers/*.{yaml,yml,json}` | same |
| Gemini CLI | `~/.gemini/settings.json` (`url` = SSE, `httpUrl` = HTTP) | same |
| Codex | `~/.codex/config.toml` (`[mcp_servers.<name>]`) | same |

Project-level config files (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`
in a repo) are not searched for: finding them would mean crawling the disk.

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
| 9 | `agents` collector: MCP client configs + agent frameworks → `DiscoveredAgent` (see `docs/plans/agent-discovery.md`, Gap 3) | — | yes |

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

## Needs from the user after merge (agents collector)

- Deploy the server first, then release a signed agent **0.2.0** (`make VERSION=0.2.0`, notarize, Authenticode) and push it through Hexnode. Older agents keep working and simply never send MCP data.
- The collector is **opt-in**: tick **MCP servers & agent frameworks** in Settings → Endpoint Agent to enable it fleet-wide. It is off by default, including for tenants that never saved a collector selection, because MCP configs are where credentials live.
- No migration: `DiscoveredAgent` and `EndpointDetection` already exist.

## Needs from the user after merge

- `npx prisma migrate deploy` against prod (the migration is not auto-applied).
- Generate the enrollment secret in Settings → Endpoint Agent.
- An Apple Developer ID cert to sign/notarize the macOS build, and an
  Authenticode cert for Windows, before the Hexnode push. Unsigned binaries
  will be Gatekeeper-blocked.
