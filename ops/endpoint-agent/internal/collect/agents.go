package collect

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// MCP client configuration and agent framework inventory — the `agents`
// collector.
//
// MCP client config files are the most secret-dense files on a developer's
// laptop: `env` blocks hold API keys, `args` hold database URLs with
// passwords and the paths a filesystem server may touch, `headers` hold
// bearer tokens, and remote URLs carry tokens in their query strings. So this
// collector parses each file in memory and keeps only these fields per
// server, every one of them sanitized here before it can reach a report:
//
//   - client     which MCP client the file belongs to (closed list)
//   - name       the server's config key, or a hashed placeholder if the key
//                is not a plain identifier
//   - transport  stdio | http | sse | ws
//   - host       remote servers only: the bare hostname — never the URL
//   - launcher   stdio servers only: a closed category (npx, uvx, docker, …)
//   - package    npx/uvx/docker-style launchers only: the package or image id
//                with any version or tag stripped
//
// Nothing else from the file is retained: not the command path, not the
// remaining args, not env, not headers, not cwd, not the project paths that
// key Claude Code's per-project settings. The server's wire schema
// (src/lib/validations/endpoint-agent.ts) enforces the same shapes, so a
// compromised or buggy agent cannot widen the channel either.
//
// Framework detection lists a bounded set of well-known package directories
// (user/system site-packages, pipx and uv tool venvs, global node_modules) and
// reports framework ids and environment counts. It never walks the home
// directory, so project virtualenvs are deliberately out of scope.

const (
	// maxConfigBytes caps a config file read. ~/.claude.json grows with
	// per-project history and is allowed more room than the rest.
	maxConfigBytes        = 4 << 20
	maxClaudeJSONBytes    = 32 << 20
	maxServersPerFile     = 64
	maxServersPerReport   = 256
	maxProjectsScanned    = 500
	maxPackageLen         = 128
	maxContinueDirFiles   = 50
	maxFrameworkDirs      = 128
	maxSitePackageEntries = 5000
)

// Client ids. Mirrored by `mcpClientSchema` on the server.
const (
	ClientClaudeDesktop = "claude_desktop"
	ClientClaudeCode    = "claude_code"
	ClientCursor        = "cursor"
	ClientWindsurf      = "windsurf"
	ClientVSCode        = "vscode"
	ClientCline         = "cline"
	ClientRooCode       = "roo_code"
	ClientZed           = "zed"
	ClientContinue      = "continue"
	ClientGeminiCLI     = "gemini_cli"
	ClientCodex         = "codex"
)

// configFormat selects how a file is parsed.
type configFormat int

const (
	// {"mcpServers": {name: server}} — Claude Desktop, Cursor, Windsurf,
	// Cline, Roo, ~/.mcp.json, Continue's JSON blocks.
	formatMCPServers configFormat = iota
	// ~/.claude.json: top-level mcpServers plus projects.<path>.mcpServers.
	formatClaudeJSON
	// VS Code settings.json: {"mcp": {"servers": {...}}} (JSONC).
	formatVSCodeSettings
	// VS Code mcp.json: {"servers": {...}} (JSONC).
	formatVSCodeMCP
	// Zed settings.json: {"context_servers": {...}} (JSONC).
	formatZed
	// Gemini CLI: mcpServers where `url` means SSE and `httpUrl` streamable HTTP.
	formatGemini
	// Continue config.yaml / mcpServers/*.yaml: `mcpServers:` list.
	formatContinueYAML
	// Continue legacy config.json: experimental.modelContextProtocolServers.
	formatContinueJSON
	// Codex ~/.codex/config.toml: [mcp_servers.<name>] tables.
	formatCodexTOML
)

// configFile is one known MCP client config location.
type configFile struct {
	client string
	path   string
	format configFormat
	// glob marks `path` as a filepath.Glob pattern (Continue's block dir).
	glob bool
}

// rawServer is a parsed server entry before sanitization. It exists only in
// memory; the sanitizer turns it into an MCPServer or drops it.
type rawServer struct {
	name     string
	typ      string
	command  string
	args     []string
	url      string
	disabled bool
	// fromExtension marks a Zed extension-provided server (no command).
	fromExtension bool
}

// CollectAgents reads every known MCP client config and the well-known
// package locations, returning sanitized identifiers only.
func CollectAgents() ([]MCPServer, []AgentFramework, Status) {
	home, homeErr := os.UserHomeDir()
	configDir, configErr := os.UserConfigDir()
	if homeErr != nil || configErr != nil || home == "" || configDir == "" {
		// Without a home directory nothing can be looked at, and an empty
		// "successful" scan would tell the console every config was removed.
		return nil, nil, FailStatus("no_home")
	}

	deadline := time.Now().Add(agentsTimeBudget)
	scan := collectMCPServers(mcpConfigFiles(home, configDir), deadline)
	frameworks, dirsScanned, fwTimedOut := collectFrameworks(frameworkLocations(home, configDir), deadline)

	status := OKStatus(scan.read + dirsScanned)
	switch {
	case scan.failed > 0:
		// Some config existed but could not be read or parsed. Say so, so an
		// empty list is not mistaken for "no MCP servers here".
		status.Reason = "partial_unparseable"
	case scan.truncated || fwTimedOut:
		// A cap or the time budget cut the scan short. Any reason makes the
		// server treat the scan as partial, so nothing is cleared.
		status.Reason = "truncated"
	}
	return scan.servers, frameworks, status
}

// agentsTimeBudget bounds one collection pass. Normal passes take tens of
// milliseconds; this only matters on a pathological file system.
const agentsTimeBudget = 10 * time.Second

type mcpScan struct {
	servers []MCPServer
	// read counts files parsed; failed counts files that exist but could not
	// be read or parsed.
	read, failed int
	// truncated is set when a per-file or per-report cap, or the deadline,
	// dropped servers.
	truncated bool
}

// collectMCPServers parses each config file that exists and returns the
// deduplicated, sanitized server list. Deduplication runs before the caps, so
// a ~/.claude.json listing the same server under 300 projects still yields
// every distinct server.
func collectMCPServers(files []configFile, deadline time.Time) mcpScan {
	var scan mcpScan
	seen := map[string]struct{}{}
	for _, file := range files {
		paths := []string{file.path}
		if file.glob {
			matches, _ := filepath.Glob(file.path)
			if len(matches) > maxContinueDirFiles {
				matches = matches[:maxContinueDirFiles]
				scan.truncated = true
			}
			paths = matches
		}
		for _, path := range paths {
			if !deadline.IsZero() && time.Now().After(deadline) {
				scan.truncated = true
				return scan
			}
			limit := int64(maxConfigBytes)
			if file.format == formatClaudeJSON {
				limit = maxClaudeJSONBytes
			}
			data, exists, err := readConfigFile(path, limit)
			if !exists {
				continue
			}
			if err != nil {
				scan.failed++
				continue
			}
			raws, err := parseConfig(file.format, data)
			if err != nil {
				scan.failed++
				continue
			}
			scan.read++
			fromFile := 0
			for _, raw := range raws {
				server, ok := sanitizeServer(file.client, raw, file.format)
				if !ok {
					continue
				}
				key := server.Client + "\x00" + server.Name + "\x00" + server.Transport + "\x00" +
					server.Host + "\x00" + server.Launcher + "\x00" + server.Package
				if _, dup := seen[key]; dup {
					continue
				}
				if fromFile >= maxServersPerFile || len(scan.servers) >= maxServersPerReport {
					scan.truncated = true
					break
				}
				seen[key] = struct{}{}
				scan.servers = append(scan.servers, server)
				fromFile++
			}
		}
	}
	return scan
}

// readConfigFile reads a regular file up to `limit` bytes. A missing file is
// not an error. Anything that is not a regular file (a FIFO would block the
// read forever, a directory is not config) counts as unreadable.
//
// The file is opened first and then checked through the open descriptor, so
// it cannot be swapped for a FIFO between the check and the read; the open
// itself is non-blocking where FIFOs exist (see openConfigFile).
func readConfigFile(path string, limit int64) (data []byte, exists bool, err error) {
	f, err := openConfigFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, true, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, true, err
	}
	if !info.Mode().IsRegular() {
		return nil, true, os.ErrInvalid
	}
	if info.Size() > limit {
		return nil, true, os.ErrInvalid
	}
	data, err = io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, true, err
	}
	if int64(len(data)) > limit {
		return nil, true, os.ErrInvalid
	}
	return data, true, nil
}

// ─── Parsing ─────────────────────────────────────────────

func parseConfig(format configFormat, data []byte) ([]rawServer, error) {
	switch format {
	case formatContinueYAML:
		return parseContinueYAML(string(data)), nil
	case formatCodexTOML:
		return parseCodexTOML(string(data)), nil
	}

	var root map[string]json.RawMessage
	if err := json.Unmarshal(StripJSONC(data), &root); err != nil {
		return nil, err
	}

	switch format {
	case formatMCPServers, formatGemini:
		return serversFromMap(root["mcpServers"]), nil
	case formatClaudeJSON:
		out := serversFromMap(root["mcpServers"])
		var projects map[string]struct {
			MCPServers json.RawMessage `json:"mcpServers"`
		}
		if raw, ok := root["projects"]; ok {
			_ = json.Unmarshal(raw, &projects)
		}
		// The project map is keyed by absolute path. The keys are sorted only
		// to make the scan deterministic and are never retained.
		keys := make([]string, 0, len(projects))
		for key := range projects {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		if len(keys) > maxProjectsScanned {
			keys = keys[:maxProjectsScanned]
		}
		for _, key := range keys {
			out = append(out, serversFromMap(projects[key].MCPServers)...)
		}
		return out, nil
	case formatVSCodeSettings:
		var mcp struct {
			Servers json.RawMessage `json:"servers"`
		}
		if raw, ok := root["mcp"]; ok {
			_ = json.Unmarshal(raw, &mcp)
		}
		return serversFromMap(mcp.Servers), nil
	case formatVSCodeMCP:
		return serversFromMap(root["servers"]), nil
	case formatZed:
		return serversFromMap(root["context_servers"]), nil
	case formatContinueJSON:
		out := serversFromMap(root["mcpServers"])
		var experimental struct {
			Servers []struct {
				Name      string `json:"name"`
				Transport struct {
					Type    string   `json:"type"`
					Command string   `json:"command"`
					Args    []string `json:"args"`
					URL     string   `json:"url"`
				} `json:"transport"`
			} `json:"modelContextProtocolServers"`
		}
		if raw, ok := root["experimental"]; ok {
			_ = json.Unmarshal(raw, &experimental)
		}
		for i, s := range experimental.Servers {
			name := s.Name
			if name == "" {
				name = "server-" + strconv.Itoa(i+1)
			}
			out = append(out, rawServer{
				name:    name,
				typ:     s.Transport.Type,
				command: s.Transport.Command,
				args:    s.Transport.Args,
				url:     s.Transport.URL,
			})
		}
		return out, nil
	}
	return nil, nil
}

// serversFromMap decodes a {name: server} object. Entries that do not decode
// are skipped individually, so one odd entry cannot hide the rest.
func serversFromMap(raw json.RawMessage) []rawServer {
	if len(raw) == 0 {
		return nil
	}
	var entries map[string]json.RawMessage
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil
	}
	names := make([]string, 0, len(entries))
	for name := range entries {
		names = append(names, name)
	}
	sort.Strings(names)

	var out []rawServer
	for _, name := range names {
		var entry struct {
			Type      string          `json:"type"`
			Transport json.RawMessage `json:"transport"`
			Command   json.RawMessage `json:"command"`
			Args      []interface{}   `json:"args"`
			URL       string          `json:"url"`
			ServerURL string          `json:"serverUrl"`
			HTTPURL   string          `json:"httpUrl"`
			Disabled  bool            `json:"disabled"`
			Enabled   *bool           `json:"enabled"`
			Source    string          `json:"source"`
			Settings  json.RawMessage `json:"settings"`
		}
		if err := json.Unmarshal(entries[name], &entry); err != nil {
			continue
		}
		server := rawServer{name: name, typ: entry.Type, disabled: entry.Disabled}
		if entry.Enabled != nil && !*entry.Enabled {
			server.disabled = true
		}
		if server.typ == "" && len(entry.Transport) > 0 {
			var transport string
			if json.Unmarshal(entry.Transport, &transport) == nil {
				server.typ = transport
			}
		}
		server.args = stringArgs(entry.Args)

		// `command` is a string everywhere except Zed's older shape,
		// {"command": {"path": "...", "args": [...]}}.
		if len(entry.Command) > 0 {
			var command string
			if json.Unmarshal(entry.Command, &command) == nil {
				server.command = command
			} else {
				var nested struct {
					Path string        `json:"path"`
					Args []interface{} `json:"args"`
				}
				if json.Unmarshal(entry.Command, &nested) == nil {
					server.command = nested.Path
					if len(server.args) == 0 {
						server.args = stringArgs(nested.Args)
					}
				}
			}
		}

		switch {
		case entry.HTTPURL != "":
			server.url = entry.HTTPURL
			if server.typ == "" {
				server.typ = "http"
			}
		case entry.ServerURL != "":
			server.url = entry.ServerURL
		default:
			server.url = entry.URL
		}

		if server.command == "" && server.url == "" &&
			(entry.Source == "extension" || len(entry.Settings) > 0) {
			server.fromExtension = true
		}
		out = append(out, server)
	}
	return out
}

func stringArgs(values []interface{}) []string {
	var out []string
	for _, v := range values {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
		if len(out) >= 64 {
			break
		}
	}
	return out
}

// ─── Sanitization ────────────────────────────────────────

var (
	// A server name is sent only if it is a plain identifier. Anything with a
	// slash, backslash, colon, equals sign, quote or `@` could be a path, a
	// URL, a KEY=value or a credential, and is replaced by a hashed
	// placeholder instead.
	safeServerName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,63}$`)
	npmPackageRe   = regexp.MustCompile(`^(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$`)
	pypiPackageRe  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)
	imagePartRe    = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*$`)
	hostLabelRe    = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
	pypiSeparators = regexp.MustCompile(`[-_.]+`)
	numericHostRe  = regexp.MustCompile(`^[0-9]+(\.[0-9]+){0,3}$`)
)

// SanitizeServerName returns the config key if it is a plain identifier, and
// otherwise a stable placeholder derived from its hash, so the server is still
// counted and tracked across reports without its key leaving the machine.
func SanitizeServerName(name string) string {
	trimmed := strings.TrimSpace(name)
	if safeServerName.MatchString(trimmed) && !looksLikeSecret(trimmed) {
		return trimmed
	}
	sum := sha256.Sum256([]byte(name))
	return "redacted-" + hex.EncodeToString(sum[:4])
}

// sanitizeServer turns a parsed entry into its reportable identifiers, or
// drops it. Disabled servers and in-process SDK servers are dropped.
func sanitizeServer(client string, raw rawServer, format configFormat) (MCPServer, bool) {
	if raw.disabled {
		return MCPServer{}, false
	}
	server := MCPServer{Client: client, Name: SanitizeServerName(raw.name)}

	transport := normalizeTransport(raw.typ)
	if transport == "skip" {
		return MCPServer{}, false
	}
	if transport == "" {
		switch {
		case raw.url != "":
			if format == formatGemini {
				// Gemini CLI: `url` is SSE, `httpUrl` (already typed) is HTTP.
				transport = "sse"
			} else {
				transport = guessRemoteTransport(raw.url)
			}
		case raw.command != "" || raw.fromExtension:
			transport = "stdio"
		default:
			return MCPServer{}, false
		}
	}
	server.Transport = transport

	if transport == "stdio" {
		if raw.fromExtension && raw.command == "" {
			server.Launcher = "extension"
			return server, true
		}
		server.Launcher, server.Package = launcherAndPackage(raw.command, raw.args)
		return server, true
	}

	host, loopback := RemoteHost(raw.url)
	server.Host = host
	server.Loopback = loopback
	return server, true
}

func normalizeTransport(typ string) string {
	switch strings.ToLower(strings.TrimSpace(typ)) {
	case "":
		return ""
	case "stdio":
		return "stdio"
	case "http", "streamable-http", "streamablehttp", "streamable_http", "https":
		return "http"
	case "sse":
		return "sse"
	case "ws", "websocket", "websockets":
		return "ws"
	case "sdk":
		// Claude Code in-process server: nothing is launched or reached.
		return "skip"
	}
	return ""
}

func guessRemoteTransport(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "http"
	}
	if u.Scheme == "ws" || u.Scheme == "wss" {
		return "ws"
	}
	if strings.HasSuffix(strings.TrimRight(u.Path, "/"), "/sse") {
		return "sse"
	}
	return "http"
}

// RemoteHost reduces a remote server URL to its bare hostname. The path,
// query, fragment, port and userinfo — where tokens live — are discarded.
// Loopback hosts are reported as a flag rather than a hostname; IPv6 literals
// and templated URLs (`${input:host}`) yield nothing.
func RemoteHost(raw string) (host string, loopback bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return "", false
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https", "ws", "wss":
	default:
		return "", false
	}
	h := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if h == "localhost" || strings.HasSuffix(h, ".localhost") || h == "0.0.0.0" {
		return "", true
	}
	if ip := net.ParseIP(h); ip != nil {
		if ip.IsLoopback() || ip.IsUnspecified() {
			return "", true
		}
		if ip.To4() == nil {
			return "", false // IPv6 literal: not a reportable host
		}
		return h, false
	}
	// Shorthand numeric forms that resolvers accept but net.ParseIP does not
	// (127.1, 127.0.1): loopback when they start at 127; otherwise an
	// all-numeric host is not a name worth reporting.
	if numericHostRe.MatchString(h) {
		return "", h == "127" || strings.HasPrefix(h, "127.") || h == "2130706433"
	}
	if len(h) > 253 || !hostLabelRe.MatchString(h) {
		return "", false
	}
	// A label can carry a token (sk-….example.com, a hex tenant id, a tunnel
	// user name). Keep only the registrable part, or nothing.
	h = reduceHost(h)
	if h == "" {
		return "", false
	}
	return h, false
}

// Launcher categories. Anything else is "binary": a direct executable whose
// basename is not reported, because it is often a path into a home directory.
var launcherAliases = map[string]string{
	"npx": "npx", "bunx": "bunx", "pnpx": "pnpm", "pnpm": "pnpm", "yarn": "yarn",
	"npm": "npm", "node": "node", "bun": "bun", "deno": "deno",
	"uvx": "uvx", "uv": "uv", "pipx": "pipx",
	"python": "python", "python3": "python", "py": "python",
	"docker": "docker", "podman": "docker",
	"java": "java", "dotnet": "dotnet", "go": "go",
}

func launcherBase(command string) string {
	base := strings.TrimSpace(command)
	if i := strings.LastIndexAny(base, `/\`); i >= 0 {
		base = base[i+1:]
	}
	base = strings.ToLower(base)
	for _, ext := range []string{".exe", ".cmd", ".bat", ".ps1"} {
		base = strings.TrimSuffix(base, ext)
	}
	// python3.12, python3.11 …
	if strings.HasPrefix(base, "python3.") {
		base = "python3"
	}
	return base
}

// launcherAndPackage classifies the command and, for package-runner
// launchers, extracts the package id. Every other arg is read only to skip
// past it and is never returned.
func launcherAndPackage(command string, args []string) (string, string) {
	base := launcherBase(command)

	// Windows configs wrap launchers in `cmd /c npx …`.
	if base == "cmd" && len(args) >= 2 && strings.EqualFold(args[0], "/c") {
		return launcherAndPackage(args[1], args[2:])
	}

	launcher, known := launcherAliases[base]
	if !known {
		return "binary", ""
	}

	switch launcher {
	case "npx", "bunx":
		return launcher, npmPackageFromArgs(args)
	case "pnpm", "yarn":
		// pnpm dlx / yarn dlx; `pnpx` arrives here with no subcommand.
		if base == "pnpx" {
			return launcher, npmPackageFromArgs(args)
		}
		if len(args) > 0 && args[0] == "dlx" {
			return launcher, npmPackageFromArgs(args[1:])
		}
	case "npm":
		if len(args) > 0 && (args[0] == "exec" || args[0] == "x") {
			return "npx", npmPackageFromArgs(args[1:])
		}
	case "bun":
		if len(args) > 0 && args[0] == "x" {
			return "bunx", npmPackageFromArgs(args[1:])
		}
	case "uvx":
		return launcher, pypiPackageFromArgs(args)
	case "uv":
		if len(args) >= 2 && args[0] == "tool" && args[1] == "run" {
			return "uvx", pypiPackageFromArgs(args[2:])
		}
	case "pipx":
		if len(args) > 0 && args[0] == "run" {
			return launcher, pypiPackageFromArgs(args[1:])
		}
	case "docker":
		return launcher, imageFromArgs(args)
	}
	return launcher, ""
}

// npm/npx flags that consume the next arg as a value.
var npmValueFlags = map[string]bool{
	"--registry": true, "--cache": true, "--userconfig": true, "--prefix": true,
	"-c": true, "--call": true, "--workspace": true, "-w": true, "--loglevel": true,
}

// npm/npx flags known to take no value. Any other `--flag` without `=` makes
// the parser give up rather than guess: `npx -y --token <hex> @scope/pkg`
// would otherwise report the token as the package.
var npmBoolFlags = map[string]bool{
	"-y": true, "--yes": true, "--no": true, "-q": true, "--quiet": true, "-s": true,
	"--silent": true, "--no-install": true, "--ignore-existing": true,
	"--prefer-offline": true, "--prefer-online": true, "--offline": true,
	"--no-update-notifier": true, "--legacy-peer-deps": true, "-d": true, "--verbose": true,
}

func npmPackageFromArgs(args []string) string {
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			continue
		}
		if strings.HasPrefix(arg, "-") {
			// --package names the package explicitly.
			if arg == "-p" || arg == "--package" {
				if i+1 < len(args) {
					return NormalizeNPMPackage(args[i+1])
				}
				return ""
			}
			if strings.HasPrefix(arg, "--package=") {
				return NormalizeNPMPackage(strings.TrimPrefix(arg, "--package="))
			}
			switch {
			case strings.Contains(arg, "="):
			case npmValueFlags[arg]:
				i++
			case npmBoolFlags[arg]:
			default:
				return "" // unknown flag: its value could be anything
			}
			continue
		}
		return NormalizeNPMPackage(arg)
	}
	return ""
}

// NormalizeNPMPackage strips a version/tag and validates the result as an npm
// package name. Paths, URLs, git/file specs and tarballs return "".
func NormalizeNPMPackage(spec string) string {
	s := strings.TrimSpace(spec)
	if s == "" || strings.ContainsAny(s, `:\ `) || strings.HasPrefix(s, ".") || strings.HasPrefix(s, "~") {
		return ""
	}
	if strings.HasPrefix(s, "@") {
		slash := strings.Index(s, "/")
		if slash < 0 {
			return ""
		}
		if at := strings.Index(s[slash:], "@"); at >= 0 {
			s = s[:slash+at]
		}
	} else if at := strings.Index(s, "@"); at >= 0 {
		s = s[:at]
	}
	if len(s) > maxPackageLen || !npmPackageRe.MatchString(s) || looksLikeSecret(s) {
		return ""
	}
	return s
}

// uvx/pipx flags that consume the next arg.
var pypiValueFlags = map[string]bool{
	"--with": true, "-w": true, "--python": true, "-p": true, "--index": true,
	"--index-url": true, "--extra-index-url": true, "--default-index": true,
	"--with-editable": true, "--with-requirements": true, "--constraints": true,
	"-c": true, "--overrides": true, "--directory": true, "--spec": true,
	"--pip-args": true, "--env-file": true, "--cache-dir": true, "--prerelease": true,
	"--resolution": true, "--exclude-newer": true, "--refresh-package": true,
	"--reinstall-package": true, "--upgrade-package": true, "--index-strategy": true,
	"--keyring-provider": true, "--config-setting": true, "-C": true, "--link-mode": true,
	"--color": true, "--python-preference": true, "--config-file": true, "--project": true,
	"--no-binary-package": true, "--no-build-package": true,
}

// uvx/pipx flags known to take no value; see npmBoolFlags for why any other
// flag stops the parse.
var pypiBoolFlags = map[string]bool{
	"--isolated": true, "--no-cache": true, "-n": true, "--offline": true, "-q": true,
	"--quiet": true, "-v": true, "--verbose": true, "--refresh": true, "--native-tls": true,
	"--no-progress": true, "--no-python-downloads": true, "--no-config": true,
	"--system": true, "--upgrade": true, "-U": true, "--reinstall": true,
	"--no-build": true, "--no-binary": true, "--no-sources": true, "--no-env-file": true,
}

func pypiPackageFromArgs(args []string) string {
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			continue
		}
		if strings.HasPrefix(arg, "-") {
			if arg == "--from" {
				if i+1 < len(args) {
					return NormalizePyPIPackage(args[i+1])
				}
				return ""
			}
			if strings.HasPrefix(arg, "--from=") {
				return NormalizePyPIPackage(strings.TrimPrefix(arg, "--from="))
			}
			switch {
			case strings.Contains(arg, "="):
			case pypiValueFlags[arg]:
				i++
			case pypiBoolFlags[arg]:
			default:
				return "" // unknown flag: its value could be anything
			}
			continue
		}
		return NormalizePyPIPackage(arg)
	}
	return ""
}

// NormalizePyPIPackage strips extras, version specifiers and markers, and
// returns the PEP 503 normalized name. URLs, paths and git specs return "".
func NormalizePyPIPackage(spec string) string {
	s := strings.TrimSpace(spec)
	if s == "" || strings.Contains(s, "://") || strings.ContainsAny(s, `/\`) || strings.HasPrefix(s, "git+") {
		return ""
	}
	if i := strings.IndexAny(s, "[=<>!~;@ "); i >= 0 {
		s = s[:i]
	}
	if len(s) > maxPackageLen || !pypiPackageRe.MatchString(s) || looksLikeSecret(s) {
		return ""
	}
	return pypiSeparators.ReplaceAllString(strings.ToLower(s), "-")
}

// docker run flags that consume the next arg as a value. An unknown flag is
// treated as boolean; if it actually took a value, that value is then
// mistaken for the image and has to survive NormalizeImage, which rejects
// anything with `=`, uppercase, or a secret shape.
var dockerValueFlags = map[string]bool{
	"-e": true, "--env": true, "--env-file": true, "-v": true, "--volume": true,
	"--mount": true, "--name": true, "-p": true, "--publish": true, "--network": true,
	"--net": true, "-w": true, "--workdir": true, "-u": true, "--user": true,
	"--entrypoint": true, "-l": true, "--label": true, "--platform": true,
	"--add-host": true, "--cpus": true, "-m": true, "--memory": true, "--pull": true,
	"--dns": true, "-h": true, "--hostname": true, "--cap-add": true, "--cap-drop": true,
	"--security-opt": true, "--device": true, "--ulimit": true, "--log-driver": true,
	"--log-opt": true, "--restart": true, "--tmpfs": true, "--gpus": true, "--ipc": true,
	"--pid": true, "--runtime": true, "--shm-size": true, "--stop-signal": true,
	"--label-file": true, "--cidfile": true, "--group-add": true, "--expose": true,
	"-a": true, "--attach": true, "--volumes-from": true, "--memory-swap": true,
	"--memory-reservation": true, "--memory-swappiness": true, "--kernel-memory": true,
	"--link": true, "--ip": true, "--ip6": true, "--userns": true, "--uts": true,
	"-c": true, "--cpu-shares": true, "--cpuset-cpus": true, "--cpuset-mems": true,
	"--cpu-period": true, "--cpu-quota": true, "--cpu-rt-period": true, "--cpu-rt-runtime": true,
	"--sysctl": true, "--storage-opt": true, "--health-cmd": true, "--health-interval": true,
	"--health-retries": true, "--health-timeout": true, "--health-start-period": true,
	"--dns-option": true, "--dns-search": true, "--domainname": true, "--mac-address": true,
	"--network-alias": true, "--blkio-weight": true, "--blkio-weight-device": true,
	"--device-read-bps": true, "--device-write-bps": true, "--device-read-iops": true,
	"--device-write-iops": true, "--device-cgroup-rule": true, "--cgroup-parent": true,
	"--cgroupns": true, "--isolation": true, "--oom-score-adj": true, "--pids-limit": true,
	"--stop-timeout": true, "--volume-driver": true, "--annotation": true, "--detach-keys": true,
	"--link-local-ip": true, "--log-level": true,
}

func imageFromArgs(args []string) string {
	i := 0
	if i < len(args) && args[i] == "container" {
		i++
	}
	if i >= len(args) || args[i] != "run" {
		return ""
	}
	for i++; i < len(args); i++ {
		arg := args[i]
		if strings.HasPrefix(arg, "-") {
			if !strings.Contains(arg, "=") && dockerValueFlags[arg] {
				i++
			}
			continue
		}
		return NormalizeImage(arg)
	}
	return ""
}

// NormalizeImage strips the registry host, tag and digest, keeping at most
// `namespace/name`. `ghcr.io/github/github-mcp-server:latest` becomes
// `github/github-mcp-server`; `mcp/fetch@sha256:…` becomes `mcp/fetch`.
func NormalizeImage(ref string) string {
	s := strings.TrimSpace(ref)
	if s == "" || strings.ContainsAny(s, `=\ `) || strings.Contains(s, "://") ||
		strings.HasPrefix(s, "/") || strings.HasPrefix(s, ".") || strings.HasPrefix(s, "~") {
		return ""
	}
	if i := strings.Index(s, "@"); i >= 0 {
		s = s[:i]
	}
	parts := strings.Split(s, "/")
	for _, part := range parts {
		if part == "" {
			return "" // a//b or a trailing slash: a path, not an image
		}
	}
	if last := parts[len(parts)-1]; strings.Contains(last, ":") {
		parts[len(parts)-1] = last[:strings.Index(last, ":")]
	}
	if len(parts) > 1 && (strings.ContainsAny(parts[0], ".:") || parts[0] == "localhost") {
		parts = parts[1:]
	}
	if len(parts) > 2 {
		parts = parts[len(parts)-2:]
	}
	for _, part := range parts {
		if !imagePartRe.MatchString(part) {
			return ""
		}
	}
	out := strings.Join(parts, "/")
	if len(out) > maxPackageLen || looksLikeSecret(out) {
		return ""
	}
	return out
}
