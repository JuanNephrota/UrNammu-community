# UrNammu endpoint agent

A small signed binary, pushed by MDM to macOS and Windows, that reports which
AI tools a machine actually runs and reaches.

It exists because every other source UrNammu has observes AI use from the
outside — SaaS admin APIs, the proxy, DNS/CASB exports — and all of them go
blind in the same places: a laptop off the VPN, a personal-tier account no
enterprise API enumerates, a desktop app with no SaaS audit trail, and local
inference, which is invisible by construction.

## What it collects — and what it never does

| Collector | macOS | Windows | Reports |
|---|---|---|---|
| `apps` | `/Applications`, `~/Applications`, running processes | Uninstall registry keys, running images | app name, bundle id / publisher, version, running flag |
| `browser` | Chrome, Edge, Brave, Arc, Vivaldi, Firefox, Safari | Chrome, Edge, Brave, Vivaldi, Opera, Firefox | **hostname + visit count only** |
| `network` | *unsupported — see below* | `Get-DnsClientCache` | hostname + hit count |
| `runtimes` | loopback probe | loopback probe | runtime id, port, local model names |

**It never collects content.** Not prompts, not responses, not URL paths, not
query strings, not page titles, not window titles, not file paths, not command
lines, not keystrokes. The most specific thing that can leave a machine is a
bare hostname that already appears on the server-issued allowlist.

Three things enforce that rather than merely promising it:

1. **The allowlist is server-issued.** The agent fetches a manifest compiled
   from `src/lib/ai-tools-registry.ts` and reports only what matches it. A
   hostname that is not a known AI tool never leaves the endpoint. It is an
   allowlist, not a history upload.
2. **The wire schema cannot express content.** `src/lib/validations/endpoint-agent.ts`
   has no free-text field wide enough to carry a prompt, and its `hostname`
   type rejects anything containing a slash — so a full URL cannot be smuggled
   through a domain field even by a compromised agent.
3. **`--dry-run` shows the exact bytes.** Anyone can run it on their own
   machine and read precisely what would be transmitted.

```bash
urnammu-agent --config ./agent.json --dry-run
```

It is also **not an EDR**: no kernel extension, no Endpoint Security client, no
ETW hooks, no injection. It runs unprivileged in the user's own session and
reads only what that user can already read.

### Why `network` is unsupported on macOS

There is no unprivileged, stable way to enumerate resolved hostnames on a
modern Mac. `dscacheutil -cachedump` needs root and returns nothing;
`scutil --dns` describes configuration, not history; and reverse-resolving
`lsof` connections yields the CDN's PTR, not `api.openai.com`. Rather than burn
cycles to report nothing, macOS reports the collector as `unsupported_platform`
and the console says so. On macOS the browser collector carries AI web traffic
and the app and runtime collectors carry everything local.

Windows keeps the full network collector, because `Get-DnsClientCache` is a
real, documented, unprivileged API.

## How it works

```
enroll once (org secret)  ──►  per-device token
      │
      ├── GET  /api/endpoint-agent/manifest   (hourly, ETag-conditional)
      └── POST /api/endpoint-agent/report     (every 15 min, spooled)
```

- **Per-device tokens.** The org-wide enrollment secret is readable on every
  managed laptop, so it is treated as low-value: it can enroll a device and
  nothing else. Each machine then gets its own token, stored server-side only
  as a SHA-256 hash. One exfiltrated laptop cannot forge reports for the fleet.
- **Revocation is terminal.** Revoking a device in the console kills its token
  immediately, and re-running the installer will not resurrect it. A revoked
  agent exits cleanly rather than crash-looping.
- **Spool-and-retry.** Reports are written to disk before they are sent and
  deleted only once accepted, so a laptop that spends the afternoon offline
  reports the afternoon when it reconnects. The backlog is capped at 96
  reports; a permanently rejected report is dropped rather than blocking the
  queue behind it.
- **Jittered cadence.** Wake-ups are smeared by up to 10% so an MDM push of a
  few thousand agents does not arrive as a thundering herd.

## Build

```bash
make                 # macOS universal + Windows amd64 into dist/
make VERSION=0.2.0   # stamp a version
make test vet        # tests and vet
```

Both platforms **must be signed** or the MDM push will not work — Gatekeeper
blocks unsigned Mac binaries and SmartScreen flags unsigned Windows ones. Both
deploy scripts verify the signature and refuse to install without one.

```bash
make notarize-darwin DEVELOPER_ID="Developer ID Application: … (TEAMID)" \
                     NOTARY_PROFILE=urnammu-notary
```

## Deploy

Host the built binary somewhere the fleet can reach, then push the matching
script as a Hexnode custom script with `CONSOLE_URL`, `ENROLLMENT_SECRET` and
`BINARY_URL` set:

- macOS — [`mdm/hexnode-deploy-endpoint-agent.sh`](mdm/hexnode-deploy-endpoint-agent.sh)
  installs to `/usr/local/bin`, writes `/Library/Application Support/UrNammu/agent.json`,
  and loads a **LaunchAgent** in the console user's GUI session.
- Windows — [`mdm/hexnode-deploy-endpoint-agent.ps1`](mdm/hexnode-deploy-endpoint-agent.ps1)
  installs under `%ProgramData%\UrNammu` and registers an at-logon **Scheduled
  Task** in the user's context.

Both run in the *user's* session, not as root/SYSTEM, because browser profiles
live in the user's home and Full Disk Access is granted per-user. A privileged
daemon would need far broader access to see less.

### Safari needs Full Disk Access

Safari's `History.db` is TCC-protected. Push a PPPC profile granting
`SystemPolicyAllFiles` to `/usr/local/bin/urnammu-agent`, or Safari is skipped
and the console reports the browser collector as `partial_no_access` — visible,
not silent.

## Configuration

`agent.json`, written by MDM:

```json
{
  "consoleUrl": "https://urnammu.example.com",
  "enrollmentSecret": "…",
  "userEmail": "person@example.com"
}
```

`consoleUrl` must be `https` — the agent refuses to start otherwise, since it
carries a bearer token and reports where people work. `insecure: true` permits
plain http against loopback for development only.

Every field can be overridden by `URNAMMU_CONSOLE_URL`,
`URNAMMU_ENROLLMENT_SECRET`, `URNAMMU_STATE_DIR`, `URNAMMU_USER_EMAIL`.

Cadence and which collectors run are **console-side** decisions, delivered in
the manifest — see Settings → Endpoint Agent. Turning a collector off there
takes effect fleet-wide on the next manifest fetch, with no redeploy.

## Flags

| Flag | Effect |
|---|---|
| `--config PATH` | config location (defaults to the platform path) |
| `--once` | one cycle, then exit — the MDM smoke test |
| `--dry-run` | collect and print the report without sending it |
| `--version` | print the version |

## Local development

```bash
# Never point this at the production database — see the repo's CLAUDE.md.
createdb urnammu_dev && DATABASE_URL=… npx prisma migrate deploy
ENDPOINT_AGENT_ENROLLMENT_SECRET=dev-secret npm run dev

cat > /tmp/agent.json <<'EOF'
{ "consoleUrl": "http://localhost:3000",
  "enrollmentSecret": "dev-secret",
  "userEmail": "you@example.com",
  "insecure": true }
EOF

URNAMMU_STATE_DIR=/tmp/agentstate go run ./cmd/urnammu-agent --config /tmp/agent.json --dry-run
```

## Dependencies

One: `modernc.org/sqlite`, a pure-Go SQLite. Browser history lives in SQLite
databases held open in WAL mode, and the most recent visits — the ones that
matter — sit in the `-wal` sidecar, which a hand-rolled page reader would miss.
Pure Go keeps the binary static and cgo-free, so it cross-compiles and has no
runtime dependency on the endpoint.
