package collect

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Regression tests for the review findings on the agents collector.

func TestSecretShapesAreCaught(t *testing.T) {
	secrets := []string{
		"Bearer sk-ant-api03-abcdefgh12345678",
		"github ghp_abcdefghij1234567890",
		"3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c1e3b5d7f9a",
		"srv-3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c1e",
		"sk-ant-api03-abcdefgh12345678",
	}
	for _, s := range secrets {
		if !looksLikeSecret(s) {
			t.Errorf("looksLikeSecret(%q) = false, want true", s)
		}
		if name := SanitizeServerName(s); name == s || !strings.HasPrefix(name, "redacted-") {
			t.Errorf("SanitizeServerName(%q) = %q, want a redacted placeholder", s, name)
		}
	}
	for _, ok := range []string{"github", "asia-pacific", "filesystem", "postgres-prod", "my_server_2"} {
		if looksLikeSecret(ok) {
			t.Errorf("looksLikeSecret(%q) = true, want false", ok)
		}
	}
}

func TestUnknownLauncherFlagsNeverBecomeThePackage(t *testing.T) {
	hex := "3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c1e"
	cases := [][]string{
		{"-y", "--token", hex, "@scope/pkg"},
		{"--some-new-flag", hex, "@scope/pkg"},
	}
	for _, args := range cases {
		if pkg := npmPackageFromArgs(args); pkg != "" {
			t.Errorf("npmPackageFromArgs(%v) = %q, want empty", args, pkg)
		}
	}
	if pkg := pypiPackageFromArgs([]string{"--token", hex, "mcp-server-x"}); pkg != "" {
		t.Errorf("pypiPackageFromArgs = %q, want empty", pkg)
	}
	if pkg := npmPackageFromArgs([]string{"-y", "@modelcontextprotocol/server-github"}); pkg != "@modelcontextprotocol/server-github" {
		t.Errorf("known flag lost the package: %q", pkg)
	}
}

func TestRemoteHostDropsSecretLabelsAndTunnelUsers(t *testing.T) {
	cases := map[string]string{
		"https://sk-ant-api03-abcdefgh12345678.example.com/mcp":    "example.com",
		"https://3f9a1c7e5b2d4f6a8c0e1b3d5f7a.mcp.example.com/sse": "example.com",
		"https://jdoe.ngrok.io/mcp":                                "ngrok.io",
		"https://mcp.example.com/sse?key=abc":                      "mcp.example.com",
	}
	for raw, want := range cases {
		if got, _ := RemoteHost(raw); got != want {
			t.Errorf("RemoteHost(%q) = %q, want %q", raw, got, want)
		}
	}
	if host, loop := RemoteHost("http://127.1:8080/mcp"); host != "" || !loop {
		t.Errorf("127.1 = (%q, %v), want loopback", host, loop)
	}
}

func TestDockerPathsAreNotImages(t *testing.T) {
	for _, ref := range []string{"/home/jdoe/secretproj", "./local", "~/x", "a//b", "a/"} {
		if got := NormalizeImage(ref); got != "" {
			t.Errorf("NormalizeImage(%q) = %q, want empty", ref, got)
		}
	}
	if got := imageFromArgs([]string{"run", "--attach", "stdin", "-i", "mcp/fetch:latest"}); got != "mcp/fetch" {
		t.Errorf("imageFromArgs with --attach = %q, want mcp/fetch", got)
	}
}

func TestClaudeJSONDedupesBeforeCapping(t *testing.T) {
	dir := t.TempDir()
	var projects []string
	for i := 0; i < 40; i++ {
		projects = append(projects, fmt.Sprintf(`"/p/%02d": {"mcpServers": {"a": {"command":"npx","args":["-y","@modelcontextprotocol/server-github"]}, "b": {"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem"]}}}`, i))
	}
	projects = append(projects, `"/p/zz": {"mcpServers": {"rogue": {"type":"http","url":"https://rogue.example.net/mcp"}}}`)
	path := filepath.Join(dir, ".claude.json")
	if err := os.WriteFile(path, []byte(`{"projects": {`+strings.Join(projects, ",")+`}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	scan := collectMCPServers([]configFile{{client: ClientClaudeCode, path: path, format: formatClaudeJSON}}, time.Time{})
	found := false
	for _, s := range scan.servers {
		if s.Host == "rogue.example.net" {
			found = true
		}
	}
	if !found {
		t.Fatalf("server after 80 duplicate entries was dropped: %+v", scan.servers)
	}
	if scan.truncated {
		t.Fatal("3 distinct servers must not count as truncated")
	}
}

func TestExpiredDeadlineMarksScanTruncated(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mcp.json")
	if err := os.WriteFile(path, []byte(`{"mcpServers":{"a":{"command":"node"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	scan := collectMCPServers([]configFile{{client: ClientCursor, path: path, format: formatMCPServers}}, time.Now().Add(-time.Second))
	if !scan.truncated || len(scan.servers) != 0 {
		t.Fatalf("expired deadline: %+v", scan)
	}
}

func TestCodexTOMLUnclosedArrayIsFast(t *testing.T) {
	var b strings.Builder
	b.WriteString("[mcp_servers.x]\ncommand = \"npx\"\nargs = [\n")
	for b.Len() < 4<<20 {
		b.WriteString("  \"a\",\n")
	}
	start := time.Now()
	servers := parseCodexTOML(b.String())
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("4 MB unclosed array took %v", elapsed)
	}
	if len(servers) != 1 || len(servers[0].args) != 0 {
		t.Fatalf("unterminated args should be dropped: %+v", servers)
	}
	ok := parseCodexTOML("[mcp_servers.y]\ncommand = \"npx\"\nargs = [\n  \"-y\",\n  \"pkg\" # c\n]\n")
	if len(ok) != 1 || strings.Join(ok[0].args, " ") != "-y pkg" {
		t.Fatalf("multi-line array: %+v", ok)
	}
}
