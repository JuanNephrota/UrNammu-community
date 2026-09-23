package collect

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The secrets below are planted in every fixture. None of them may appear
// anywhere in what the collector returns — that is the property these tests
// exist to pin, more than any individual parse.
var plantedSecrets = []string{
	"ghp_PLANTEDsecretTOKEN0123456789abcdef",
	"sk-ant-PLANTED-api-key-000000000000",
	"hunter2-db-password",
	"/Users/alice/Private/clients",
	"C:\\Users\\alice\\secret",
	"super-secret-query-token",
	"Bearer PLANTEDBEARER",
	"PLANTED_ENV_VALUE",
}

func writeFile(t *testing.T, dir, name, body string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func assertNoSecrets(t *testing.T, v interface{}) {
	t.Helper()
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range plantedSecrets {
		if strings.Contains(string(out), secret) {
			t.Fatalf("output leaked %q: %s", secret, out)
		}
	}
	// Belt and braces: no reported field may hold a path separator other than
	// the single slash of an npm scope or a docker namespace.
	for _, bad := range []string{`\\`, "://", "?", "=", "Bearer"} {
		if strings.Contains(string(out), bad) {
			t.Fatalf("output contains %q: %s", bad, out)
		}
	}
}

func find(servers []MCPServer, client, name string) *MCPServer {
	for i := range servers {
		if servers[i].Client == client && servers[i].Name == name {
			return &servers[i]
		}
	}
	return nil
}

func TestParsesEveryConfigShapeAndLeaksNothing(t *testing.T) {
	dir := t.TempDir()

	claudeDesktop := writeFile(t, dir, "claude_desktop_config.json", `{
	  "mcpServers": {
	    "filesystem": {
	      "command": "npx",
	      "args": ["-y", "@modelcontextprotocol/server-filesystem@2025.1.0", "/Users/alice/Private/clients"]
	    },
	    "github": {
	      "command": "docker",
	      "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server:v1.2"],
	      "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_PLANTEDsecretTOKEN0123456789abcdef"}
	    },
	    "win-wrapped": {"command": "cmd", "args": ["/c", "npx", "-y", "@upstash/context7-mcp@latest"]},
	    "local-script": {"command": "/Users/alice/Private/clients/server.py", "args": ["--token", "hunter2-db-password"]},
	    "off": {"command": "npx", "args": ["x"], "disabled": true}
	  }
	}`)

	claudeJSON := writeFile(t, dir, "claude.json", `{
	  "numStartups": 12,
	  "mcpServers": {
	    "stripe": {"type": "http", "url": "https://mcp.stripe.com/v1?key=super-secret-query-token", "headers": {"Authorization": "Bearer PLANTEDBEARER"}}
	  },
	  "projects": {
	    "/Users/alice/Private/clients": {
	      "mcpServers": {
	        "postgres": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://u:hunter2-db-password@db.internal/x"]},
	        "in-proc": {"type": "sdk"}
	      }
	    }
	  }
	}`)

	vscodeSettings := writeFile(t, dir, "settings.json", `{
	  // comments are legal here
	  "editor.fontSize": 13,
	  "mcp": {
	    "servers": {
	      "fetch": {"type": "stdio", "command": "uvx", "args": ["mcp-server-fetch==0.6.2"]}, /* trailing comma follows */
	    },
	  },
	}`)

	vscodeMCP := writeFile(t, dir, "mcp.json", `{
	  "inputs": [{"id": "tok", "type": "promptString", "password": true}],
	  "servers": {
	    "gh-remote": {"type": "http", "url": "https://api.githubcopilot.com/mcp/", "headers": {"Authorization": "Bearer ${input:tok}"}}
	  }
	}`)

	zed := writeFile(t, dir, "zed.json", `{
	  "context_servers": {
	    "new-shape": {"command": "npx", "args": ["-y", "@playwright/mcp"], "env": {"X": "PLANTED_ENV_VALUE"}},
	    "old-shape": {"command": {"path": "uvx", "args": ["--from", "git-mcp-server[all]>=1.0", "serve"]}},
	    "from-extension": {"source": "extension", "settings": {"token": "PLANTED_ENV_VALUE"}},
	    "remote": {"url": "https://mcp.linear.app/sse"}
	  }
	}`)

	gemini := writeFile(t, dir, "gemini.json", `{
	  "mcpServers": {
	    "sse-one": {"url": "https://mcp.example-sse.com/events"},
	    "http-one": {"httpUrl": "https://mcp.notion.com/mcp"}
	  }
	}`)

	windsurf := writeFile(t, dir, "windsurf.json", `{
	  "mcpServers": {"figma": {"serverUrl": "https://user:hunter2-db-password@mcp.figma.com/mcp"}}
	}`)

	codex := writeFile(t, dir, "config.toml", `
model = "gpt-5"

[mcp_servers.context7]
command = "npx"
args = [
  "-y",   # comment inside an array
  "@upstash/context7-mcp",
]

[mcp_servers.context7.env]
API_KEY = "sk-ant-PLANTED-api-key-000000000000"

[mcp_servers."dotted.name"]
url = "https://mcp.sentry.dev/mcp"
bearer_token_env_var = "SENTRY_TOKEN"

[mcp_servers.disabled_one]
command = "npx"
enabled = false

[profiles.other]
command = "should-not-be-read"
`)

	continueYAML := writeFile(t, dir, "config.yaml", `name: my assistant
models:
  - name: x
mcpServers:
  - name: sqlite
    type: stdio
    command: npx
    args:
      - "@modelcontextprotocol/server-sqlite"
      - /Users/alice/Private/clients/db.sqlite
    env:
      TOKEN: PLANTED_ENV_VALUE
  - name: flow
    command: uvx
    args: ["mcp-server-time", "--local-timezone=America/Chicago"]
rules: []
`)

	continueBlock := writeFile(t, dir, "block.yaml", `mcpServers:
- name: column-zero
  command: docker
  args: [run, -i, --rm, mcp/fetch]
`)

	continueJSON := writeFile(t, dir, "continue.json", `{
	  "experimental": {"modelContextProtocolServers": [
	    {"transport": {"type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"]}}
	  ]}
	}`)

	files := []configFile{
		{client: ClientClaudeDesktop, path: claudeDesktop, format: formatMCPServers},
		{client: ClientClaudeCode, path: claudeJSON, format: formatClaudeJSON},
		{client: ClientVSCode, path: vscodeSettings, format: formatVSCodeSettings},
		{client: ClientVSCode, path: vscodeMCP, format: formatVSCodeMCP},
		{client: ClientZed, path: zed, format: formatZed},
		{client: ClientGeminiCLI, path: gemini, format: formatGemini},
		{client: ClientWindsurf, path: windsurf, format: formatMCPServers},
		{client: ClientCodex, path: codex, format: formatCodexTOML},
		{client: ClientContinue, path: continueYAML, format: formatContinueYAML},
		{client: ClientContinue, path: continueBlock, format: formatContinueYAML},
		{client: ClientContinue, path: continueJSON, format: formatContinueJSON},
		{client: ClientCursor, path: filepath.Join(dir, "missing.json"), format: formatMCPServers},
	}

	scan := collectMCPServers(files, time.Time{})
	servers, read, failed := scan.servers, scan.read, scan.failed
	if failed != 0 {
		t.Fatalf("failed = %d, want 0", failed)
	}
	if read != 11 {
		t.Fatalf("read = %d, want 11 (the missing file is not counted)", read)
	}
	assertNoSecrets(t, servers)

	want := []MCPServer{
		{Client: ClientClaudeDesktop, Name: "filesystem", Transport: "stdio", Launcher: "npx", Package: "@modelcontextprotocol/server-filesystem"},
		{Client: ClientClaudeDesktop, Name: "github", Transport: "stdio", Launcher: "docker", Package: "github/github-mcp-server"},
		{Client: ClientClaudeDesktop, Name: "win-wrapped", Transport: "stdio", Launcher: "npx", Package: "@upstash/context7-mcp"},
		{Client: ClientClaudeDesktop, Name: "local-script", Transport: "stdio", Launcher: "binary"},
		{Client: ClientClaudeCode, Name: "stripe", Transport: "http", Host: "mcp.stripe.com"},
		{Client: ClientClaudeCode, Name: "postgres", Transport: "stdio", Launcher: "npx", Package: "@modelcontextprotocol/server-postgres"},
		{Client: ClientVSCode, Name: "fetch", Transport: "stdio", Launcher: "uvx", Package: "mcp-server-fetch"},
		{Client: ClientVSCode, Name: "gh-remote", Transport: "http", Host: "api.githubcopilot.com"},
		{Client: ClientZed, Name: "new-shape", Transport: "stdio", Launcher: "npx", Package: "@playwright/mcp"},
		{Client: ClientZed, Name: "old-shape", Transport: "stdio", Launcher: "uvx", Package: "git-mcp-server"},
		{Client: ClientZed, Name: "from-extension", Transport: "stdio", Launcher: "extension"},
		{Client: ClientZed, Name: "remote", Transport: "sse", Host: "mcp.linear.app"},
		{Client: ClientGeminiCLI, Name: "sse-one", Transport: "sse", Host: "mcp.example-sse.com"},
		{Client: ClientGeminiCLI, Name: "http-one", Transport: "http", Host: "mcp.notion.com"},
		{Client: ClientWindsurf, Name: "figma", Transport: "http", Host: "mcp.figma.com"},
		{Client: ClientCodex, Name: "context7", Transport: "stdio", Launcher: "npx", Package: "@upstash/context7-mcp"},
		{Client: ClientCodex, Name: "dotted.name", Transport: "http", Host: "mcp.sentry.dev"},
		{Client: ClientContinue, Name: "sqlite", Transport: "stdio", Launcher: "npx", Package: "@modelcontextprotocol/server-sqlite"},
		{Client: ClientContinue, Name: "flow", Transport: "stdio", Launcher: "uvx", Package: "mcp-server-time"},
		{Client: ClientContinue, Name: "column-zero", Transport: "stdio", Launcher: "docker", Package: "mcp/fetch"},
		{Client: ClientContinue, Name: "server-1", Transport: "stdio", Launcher: "npx", Package: "@modelcontextprotocol/server-memory"},
	}
	for _, w := range want {
		got := find(servers, w.Client, w.Name)
		if got == nil {
			t.Errorf("missing %s/%s in %+v", w.Client, w.Name, servers)
			continue
		}
		if *got != w {
			t.Errorf("%s/%s = %+v, want %+v", w.Client, w.Name, *got, w)
		}
	}
	if len(servers) != len(want) {
		t.Errorf("got %d servers, want %d: %+v", len(servers), len(want), servers)
	}
	// Disabled and in-process servers are not reported.
	for _, name := range []string{"off", "in-proc", "disabled_one"} {
		for _, s := range servers {
			if s.Name == name {
				t.Errorf("%s should have been dropped", name)
			}
		}
	}
}

func TestServerNamesThatCouldCarryDataAreHashed(t *testing.T) {
	cases := []struct {
		in       string
		redacted bool
	}{
		{"github", false},
		{"My Server 2", false},
		{"context7.mcp", false},
		{"https://evil.example.com/?token=abc", true},
		{"/Users/alice/secret", true},
		{`C:\Users\alice`, true},
		{"API_KEY=sk-ant-123", true},
		{"@scope/pkg", true},
		{"user:password", true},
		{"ghp_PLANTEDsecretTOKEN0123456789abcdef", true},
		{"aVeryLongMixedCaseTokenWith123Numbers456", true},
		{strings.Repeat("a", 65), true},
		{"", true},
	}
	for _, tc := range cases {
		got := SanitizeServerName(tc.in)
		if tc.redacted {
			if !strings.HasPrefix(got, "redacted-") || len(got) != len("redacted-")+8 {
				t.Errorf("SanitizeServerName(%q) = %q, want a redacted placeholder", tc.in, got)
			}
		} else if got != tc.in {
			t.Errorf("SanitizeServerName(%q) = %q, want unchanged", tc.in, got)
		}
	}
	// Stable across calls, so the same server is one row over time.
	if SanitizeServerName("/a/b") != SanitizeServerName("/a/b") {
		t.Fatal("placeholder is not stable")
	}
}

func TestPackageNormalization(t *testing.T) {
	npm := map[string]string{
		"@modelcontextprotocol/server-github":       "@modelcontextprotocol/server-github",
		"@modelcontextprotocol/server-github@1.2.3": "@modelcontextprotocol/server-github",
		"mcp-remote@latest":                         "mcp-remote",
		"firecrawl-mcp":                             "firecrawl-mcp",
		"./local/server.js":                         "",
		"/abs/path/server.js":                       "",
		"github:alice/private-server":               "",
		"https://registry.example.com/pkg.tgz":      "",
		"file:../x":                                 "",
		"UPPER-case":                                "",
		"@scope":                                    "",
		"ghp_PLANTEDsecretTOKEN0123456789abcdef":    "",
		"pkg name with spaces":                      "",
		"@a/b/c":                                    "",
	}
	for in, want := range npm {
		if got := NormalizeNPMPackage(in); got != want {
			t.Errorf("NormalizeNPMPackage(%q) = %q, want %q", in, got, want)
		}
	}

	pypi := map[string]string{
		"mcp-server-fetch":            "mcp-server-fetch",
		"mcp_server_fetch==1.0":       "mcp-server-fetch",
		"awslabs.aws-docs-mcp-server": "awslabs-aws-docs-mcp-server",
		"Pkg[extra]>=2":               "pkg",
		"mcp-server-git@0.6":          "mcp-server-git",
		"git+https://github.com/x/y":  "",
		"./local":                     "",
		`C:\tools\server`:             "",
	}
	for in, want := range pypi {
		if got := NormalizePyPIPackage(in); got != want {
			t.Errorf("NormalizePyPIPackage(%q) = %q, want %q", in, got, want)
		}
	}

	images := map[string]string{
		"mcp/github":                                   "mcp/github",
		"mcp/fetch:latest":                             "mcp/fetch",
		"ghcr.io/github/github-mcp-server":             "github/github-mcp-server",
		"localhost:5000/team/tool:dev":                 "team/tool",
		"registry.example.com/a/b/c/server@sha256:abc": "c/server",
		"postgres":                  "postgres",
		"KEY=value":                 "",
		"Upper/Case":                "",
		"https://example.com/image": "",
	}
	for in, want := range images {
		if got := NormalizeImage(in); got != want {
			t.Errorf("NormalizeImage(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLauncherArgsAreOnlyReadForThePackage(t *testing.T) {
	cases := []struct {
		command  string
		args     []string
		launcher string
		pkg      string
	}{
		{"npx", []string{"-y", "--registry", "https://r.example.com", "@a/b"}, "npx", "@a/b"},
		{"npx", []string{"--package=@a/b", "bin-name"}, "npx", "@a/b"},
		{"/opt/homebrew/bin/npx", []string{"-p", "pkg", "cmd"}, "npx", "pkg"},
		{"npx.cmd", []string{"pkg@1"}, "npx", "pkg"},
		{"uvx", []string{"--python", "3.12", "--from", "mcp-server-git", "mcp-server-git"}, "uvx", "mcp-server-git"},
		{"uv", []string{"tool", "run", "mcp-server-time"}, "uvx", "mcp-server-time"},
		{"uv", []string{"run", "--directory", "/Users/alice/Private/clients", "server.py"}, "uv", ""},
		{"docker", []string{"run", "-i", "--rm", "-e", "TOKEN=abc", "-v", "/Users/alice:/data", "mcp/filesystem", "/data"}, "docker", "mcp/filesystem"},
		{"docker", []string{"compose", "up"}, "docker", ""},
		{"podman", []string{"run", "--env=A=b", "mcp/time"}, "docker", "mcp/time"},
		{"pnpm", []string{"dlx", "@a/b"}, "pnpm", "@a/b"},
		{"bun", []string{"x", "pkg"}, "bunx", "pkg"},
		{"node", []string{"/Users/alice/server.js"}, "node", ""},
		{"python3.12", []string{"-m", "server"}, "python", ""},
		{"/Users/alice/bin/my-secret-tool", []string{"--key", "x"}, "binary", ""},
		{`C:\Program Files\nodejs\node.exe`, []string{"s.js"}, "node", ""},
		{"cmd", []string{"/c", "uvx", "mcp-server-fetch"}, "uvx", "mcp-server-fetch"},
	}
	for _, tc := range cases {
		launcher, pkg := launcherAndPackage(tc.command, tc.args)
		if launcher != tc.launcher || pkg != tc.pkg {
			t.Errorf("launcherAndPackage(%q, %q) = (%q, %q), want (%q, %q)",
				tc.command, tc.args, launcher, pkg, tc.launcher, tc.pkg)
		}
	}
}

func TestRemoteHostKeepsOnlyTheHostname(t *testing.T) {
	cases := []struct {
		in       string
		host     string
		loopback bool
	}{
		{"https://mcp.notion.com/mcp", "mcp.notion.com", false},
		{"https://user:pass@mcp.figma.com:8443/mcp?token=abc#x", "mcp.figma.com", false},
		{"wss://MCP.Example.COM./ws", "mcp.example.com", false},
		{"http://localhost:3845/mcp", "", true},
		{"http://127.0.0.1:8080/sse", "", true},
		{"http://[::1]:9000/mcp", "", true},
		{"http://[2001:db8::1]/mcp", "", false},
		{"http://10.1.2.3/mcp", "10.1.2.3", false},
		{"${input:serverUrl}", "", false},
		{"file:///etc/passwd", "", false},
		{"https://bad_host.example.com/x", "", false},
		{"not a url", "", false},
	}
	for _, tc := range cases {
		host, loopback := RemoteHost(tc.in)
		if host != tc.host || loopback != tc.loopback {
			t.Errorf("RemoteHost(%q) = (%q, %v), want (%q, %v)", tc.in, host, loopback, tc.host, tc.loopback)
		}
	}
}

func TestMaliciousAndOversizedConfigs(t *testing.T) {
	dir := t.TempDir()

	// Oversized file: refused without being parsed, and counted as a failure
	// so the console shows the collector as partial.
	big := filepath.Join(dir, "big.json")
	if err := os.WriteFile(big, make([]byte, maxConfigBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	// A directory where a file is expected.
	asDir := filepath.Join(dir, "dir.json")
	if err := os.Mkdir(asDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Garbage and pathological nesting.
	garbage := writeFile(t, dir, "garbage.json", "{not json at all")
	nested := writeFile(t, dir, "nested.json", strings.Repeat("[", 20000)+strings.Repeat("]", 20000))
	// Wrong types everywhere: must not panic, bad entries are skipped.
	wrongTypes := writeFile(t, dir, "types.json", `{"mcpServers": {
	  "a": "just a string",
	  "b": {"command": 42, "args": [1, {"x": 1}, "ok"]},
	  "c": {"url": ["array"]},
	  "d": {"command": "npx", "args": ["-y", "good-pkg"]}
	}}`)
	// Too many servers in one file: capped.
	var many strings.Builder
	many.WriteString(`{"mcpServers": {`)
	for i := 0; i < 500; i++ {
		if i > 0 {
			many.WriteString(",")
		}
		many.WriteString(`"s` + strings.Repeat("x", i%5) + strconv.Itoa(i) + `": {"command": "node"}`)
	}
	many.WriteString(`}}`)
	manyPath := writeFile(t, dir, "many.json", many.String())
	// mcpServers of the wrong JSON type.
	wrongRoot := writeFile(t, dir, "root.json", `{"mcpServers": ["x", "y"]}`)
	// Garbage TOML and YAML must parse to nothing, not fail loudly.
	badTOML := writeFile(t, dir, "bad.toml", "[mcp_servers.x\ncommand = \"unterminated\nargs = [\"a\", ")
	badYAML := writeFile(t, dir, "bad.yaml", "mcpServers:\n  - : :\n  -\n    args:\n      - - -\n")

	files := []configFile{
		{client: ClientCursor, path: big, format: formatMCPServers},
		{client: ClientCursor, path: asDir, format: formatMCPServers},
		{client: ClientCursor, path: garbage, format: formatMCPServers},
		{client: ClientCursor, path: nested, format: formatMCPServers},
		{client: ClientCursor, path: wrongTypes, format: formatMCPServers},
		{client: ClientClaudeDesktop, path: manyPath, format: formatMCPServers},
		{client: ClientCursor, path: wrongRoot, format: formatMCPServers},
		{client: ClientCodex, path: badTOML, format: formatCodexTOML},
		{client: ClientContinue, path: badYAML, format: formatContinueYAML},
	}
	scan := collectMCPServers(files, time.Time{})
	servers, read, failed := scan.servers, scan.read, scan.failed
	if failed != 4 {
		t.Fatalf("failed = %d, want 4 (big, dir, garbage, nested)", failed)
	}
	if read != 5 {
		t.Fatalf("read = %d, want 5", read)
	}
	var fromMany, fromWrongTypes int
	for _, s := range servers {
		switch s.Client {
		case ClientClaudeDesktop:
			fromMany++
		case ClientCursor:
			fromWrongTypes++
			if s.Name != "d" || s.Package != "good-pkg" {
				t.Errorf("unexpected server from wrong-types file: %+v", s)
			}
		default:
			t.Errorf("garbage TOML/YAML produced a server: %+v", s)
		}
	}
	if fromMany != maxServersPerFile {
		t.Errorf("servers from oversized list = %d, want cap %d", fromMany, maxServersPerFile)
	}
	if fromWrongTypes != 1 {
		t.Errorf("servers from wrong-types file = %d, want 1", fromWrongTypes)
	}
}

func TestReportCapAcrossFiles(t *testing.T) {
	dir := t.TempDir()
	var files []configFile
	for f := 0; f < 6; f++ {
		var b strings.Builder
		b.WriteString(`{"mcpServers": {`)
		for i := 0; i < maxServersPerFile; i++ {
			if i > 0 {
				b.WriteString(",")
			}
			b.WriteString(`"f` + strconv.Itoa(f) + `s` + strconv.Itoa(i) + `": {"command": "node"}`)
		}
		b.WriteString(`}}`)
		files = append(files, configFile{
			client: ClientCursor,
			path:   writeFile(t, dir, "f"+strconv.Itoa(f)+".json", b.String()),
			format: formatMCPServers,
		})
	}
	scan := collectMCPServers(files, time.Time{})
	servers := scan.servers
	if len(servers) != maxServersPerReport {
		t.Fatalf("got %d servers, want the report cap %d", len(servers), maxServersPerReport)
	}
	if !scan.truncated {
		t.Fatal("hitting the report cap must mark the scan truncated")
	}
}

func TestStripJSONC(t *testing.T) {
	in := `{
	  // line comment with "quotes"
	  "a": "keep // this and /* this */", /* block
	  comment */
	  "b": [1, 2,],
	  "c": {"d": "escaped \" quote, }",},
	}`
	var parsed map[string]interface{}
	if err := json.Unmarshal(StripJSONC([]byte(in)), &parsed); err != nil {
		t.Fatalf("stripped JSONC did not parse: %v\n%s", err, StripJSONC([]byte(in)))
	}
	if parsed["a"] != "keep // this and /* this */" {
		t.Fatalf("string content was altered: %q", parsed["a"])
	}
	if c := parsed["c"].(map[string]interface{}); c["d"] != `escaped " quote, }` {
		t.Fatalf("escaped string altered: %q", c["d"])
	}
}

func TestFrameworkDetection(t *testing.T) {
	dir := t.TempDir()
	mk := func(parts ...string) {
		if err := os.MkdirAll(filepath.Join(append([]string{dir}, parts...)...), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// Two pipx venvs, one with langgraph + langchain_core, one with crewai.
	mk("pipx", "venvs", "tool-a", "site-packages", "langgraph-0.2.1.dist-info")
	mk("pipx", "venvs", "tool-a", "site-packages", "langchain_core-0.3.0.dist-info")
	mk("pipx", "venvs", "tool-a", "site-packages", "requests-2.32.0.dist-info")
	mk("pipx", "venvs", "tool-b", "site-packages", "CrewAI-0.80.0.dist-info")
	mk("pipx", "venvs", "tool-b", "site-packages", "langgraph-0.2.1.dist-info")
	// User site with an egg-info install and a lookalike that must not match.
	mk("user", "site-packages", "pydantic_ai_slim-1.0.egg-info")
	mk("user", "site-packages", "langchainlike-1.0.dist-info")
	mk("user", "site-packages", "langgraph")
	// Global node_modules.
	mk("npm", "node_modules", "@anthropic-ai", "claude-agent-sdk")
	writeFile(t, dir, filepath.Join("npm", "node_modules", "@anthropic-ai", "claude-agent-sdk", "package.json"), "{}")
	mk("npm", "node_modules", "@openai", "agents") // no package.json: not counted

	frameworks, scanned, _ := collectFrameworks([]frameworkLocation{
		{pattern: filepath.Join(dir, "pipx", "venvs", "*", "site-packages"), ecosystem: "python", source: "pipx"},
		{pattern: filepath.Join(dir, "user", "site-packages"), ecosystem: "python", source: "user_site"},
		{pattern: filepath.Join(dir, "npm", "node_modules"), ecosystem: "node", source: "npm_global"},
		{pattern: filepath.Join(dir, "does-not-exist", "*"), ecosystem: "python", source: "conda"},
	}, time.Time{})
	if scanned != 4 {
		t.Fatalf("scanned = %d, want 4", scanned)
	}
	want := []AgentFramework{
		{Framework: "claude_agent_sdk", Ecosystem: "node", Source: "npm_global", Count: 1},
		{Framework: "crewai", Ecosystem: "python", Source: "pipx", Count: 1},
		{Framework: "langchain", Ecosystem: "python", Source: "pipx", Count: 1},
		{Framework: "langgraph", Ecosystem: "python", Source: "pipx", Count: 2},
		{Framework: "pydantic_ai", Ecosystem: "python", Source: "user_site", Count: 1},
	}
	if len(frameworks) != len(want) {
		t.Fatalf("got %+v, want %+v", frameworks, want)
	}
	for i := range want {
		if frameworks[i] != want[i] {
			t.Errorf("frameworks[%d] = %+v, want %+v", i, frameworks[i], want[i])
		}
	}
	// No path fragment of the temp dir may appear in the output.
	out, _ := json.Marshal(frameworks)
	if strings.Contains(string(out), dir) || strings.Contains(string(out), "tool-a") {
		t.Fatalf("framework output leaked a path or env name: %s", out)
	}
}

// A nil slice marshals as `null`, which the server's schema rejects. The
// collector's outputs feed report fields that must always be arrays.
func TestCollectAgentsNeverFailsOnARealMachine(t *testing.T) {
	servers, frameworks, status := CollectAgents()
	if !status.OK {
		t.Fatalf("collector status not OK: %+v", status)
	}
	assertNoSecrets(t, servers)
	for _, s := range servers {
		if strings.ContainsAny(s.Name, `/\=:`) && !strings.HasPrefix(s.Name, "redacted-") {
			t.Fatalf("unsanitized name %q", s.Name)
		}
	}
	_ = frameworks
}
