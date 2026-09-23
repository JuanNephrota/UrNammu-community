# Endpoints

Managed machines running the UrNammu endpoint agent, and the AI tools each one actually runs and reaches.

Every other discovery source watches AI use from the outside — vendor admin APIs, the proxy, DNS and CASB exports — and they all go blind in the same four places: a laptop off the VPN, a personal-tier account no enterprise API enumerates, a desktop app that leaves no audit trail, and a model served locally. The agent observes from inside the machine instead.

## What it collects

- **Apps** — installed and running AI applications, with bundle id or publisher and version.
- **Browser** — AI hostnames from browser history, with a visit count. Hostname only.
- **Network** — AI hostnames from the DNS resolver cache. Windows only; macOS has no unprivileged DNS cache to read, so it reports as not supported rather than doing work that yields nothing.
- **Local runtimes** — model servers answering on loopback, with the models pulled locally.
- **MCP & agent frameworks** — MCP servers configured in Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, Cline, Roo Code, Zed, Continue, Gemini CLI and Codex, and agent SDKs installed in well-known package folders. Per server: client, name, transport, and the bare remote hostname or the launcher and package id. Never the command, arguments, environment, headers or URL.

## What it never collects

No prompts, no responses, no URL paths, no query strings, no page titles, no window titles, no file paths, no command lines. The most specific thing that can leave a machine is a bare hostname already on the server-issued allowlist.

MCP client configs are where API keys and database passwords live, so the agent keeps only a server's name, transport, remote hostname and package id and discards the rest on the machine; a name that could hold a path, URL or token is replaced with `redacted-<hash>`. The server rejects anything else a compromised agent might try to send.

The allowlist is compiled from the AI tools registry and delivered to each agent, so a hostname that is not a known AI tool never leaves the endpoint — it is an allowlist, not a history upload. The wire schema has no field that can carry content, and its hostname type rejects anything containing a slash. Running the agent with `--dry-run` prints the exact bytes a machine would transmit.

It is not an EDR: no kernel extension, no Endpoint Security client, no ETW hooks. It runs unprivileged in the user's own session and reads only what that user can already read.

## Reading the page

- **Enrolled devices** and **AI tools observed** give fleet coverage and breadth.
- **Local model runtimes** counts devices serving a model from loopback. This is called out because traffic to a local model reaches no proxy, no vendor admin API and no DNS log — no other control in this platform applies to it. These raise **HIGH** alerts; other endpoint discoveries raise MEDIUM.
- **Degraded collectors** counts devices that are under-reporting, most often Safari without Full Disk Access. Worth watching: an agent that quietly stops collecting makes the console read as "no AI activity" rather than "no data".

Open a device for its collector health and every detection, grouped by signal, with the evidence behind each — the bundle id, the hostname, or the runtime, port and local model names. Detections the registry does not recognize stay on the device page marked **Unclassified** and are kept out of the Shadow AI queue: one laptop's unrecognized app name is not fleet-wide evidence.

## MCP servers and agent frameworks

Each MCP server shows on the device page with its client and transport, and either the recognized server or a warning — **Unrecognized remote host**, **Unrecognized package**, or **Bridge to unseen remote**. They feed **Agents → Discovered**, not Shadow AI:

- One row per machine and MCP client, listing its servers. Registering it creates one agent with those servers as its MCP allowlist, in monitor mode.
- Recognized, non-sensitive servers score low and do not alert. Unrecognized hosts or packages, bridges, and file system, shell, database, browser, payments or cloud access raise the score; 50 or more raises a MEDIUM alert when first seen.
- A newly added unrecognized server on a config already in the queue raises a **New unrecognized MCP server** alert.
- Installed agent frameworks become one low-confidence row per machine, with no alert.

Frameworks installed only inside a project's own virtualenv or node_modules are not seen — finding them would mean searching the disk, which the agent does not do.

## Shadow AI and device management

Matched detections roll into **Shadow AI** with source `endpoint_agent`, keyed on the registry's canonical domain — so a tool seen as an app, in the browser and over the network is one row, merged with any DNS or OAuth observation of the same tool. Triage is the normal Discovered to Under Review to Registered, Approved or Blocked workflow.

Admins and compliance officers can **revoke** a device from its detail page. Revocation kills its token immediately and is not undone by reinstalling the agent. A device with no report inside the staleness window is marked **Stale** by an hourly sweep; that is not a revocation, and it flips back to Active on the next report.

Rollout and configuration live at **Settings → Endpoint Agent**.
