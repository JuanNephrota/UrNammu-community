package collect

import "testing"

// NormalizeHost is the funnel every browser-history URL passes through before
// anything can be reported. If it ever lets a path, a query string or a
// credential survive, the agent's core promise is broken — so these cases are
// about what must NOT come out, not just what must.
func TestNormalizeHostStripsEverythingButTheHost(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"bare host", "chatgpt.com", "chatgpt.com"},
		{"scheme", "https://chatgpt.com", "chatgpt.com"},
		{"www stripped", "https://www.chatgpt.com", "chatgpt.com"},
		{"uppercase", "https://ChatGPT.COM", "chatgpt.com"},
		{"trailing dot", "chatgpt.com.", "chatgpt.com"},
		{"port", "claude.ai:443", "claude.ai"},
		{"subdomain kept", "api.openai.com", "api.openai.com"},

		// The ones that matter: a conversation id in a path, a prompt in a
		// query string, and a token in userinfo must all be discarded.
		{"path dropped", "https://chatgpt.com/c/6f3a-secret-conversation", "chatgpt.com"},
		{"query dropped", "https://claude.ai/chat?q=my+secret+prompt", "claude.ai"},
		{"fragment dropped", "https://gemini.google.com/app#thread-42", "gemini.google.com"},
		{"userinfo dropped", "https://user:pa55w0rd@claude.ai/x", "claude.ai"},
		{"path without scheme", "chatgpt.com/c/private", "chatgpt.com"},

		// Non-reportable inputs.
		{"empty", "", ""},
		{"bare label", "localhost", ""},
		{"ipv6", "[::1]", ""},
		{"file url", "file:///Users/someone/secrets.txt", ""},
		{"whitespace only", "   ", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := NormalizeHost(tc.in); got != tc.want {
				t.Fatalf("NormalizeHost(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// No output of NormalizeHost may ever contain a path separator or whitespace,
// whatever it is fed. This is the invariant the server's hostname schema also
// enforces, checked here so a regression fails at the source.
func TestNormalizeHostNeverEmitsPathCharacters(t *testing.T) {
	inputs := []string{
		"https://chatgpt.com/c/abc def",
		"http://x.com/a/b/c?d=e#f",
		"weird://claude.ai/../../etc/passwd",
		"claude.ai/path with spaces",
		"a@b@claude.ai/x",
	}
	for _, in := range inputs {
		got := NormalizeHost(in)
		for _, bad := range []rune{'/', ' ', '\t', '?', '#', '@'} {
			for _, r := range got {
				if r == bad {
					t.Fatalf("NormalizeHost(%q) = %q, which contains %q", in, got, bad)
				}
			}
		}
	}
}

func TestMatchHostAllowlist(t *testing.T) {
	m := NewMatcher(Manifest{
		Domains: []string{"openai.com", "claude.ai", "co.uk.example.com"},
	})

	t.Run("exact match", func(t *testing.T) {
		if got, ok := m.MatchHost("openai.com"); !ok || got != "openai.com" {
			t.Fatalf("got %q, %v", got, ok)
		}
	})

	t.Run("subdomain matches parent", func(t *testing.T) {
		if got, ok := m.MatchHost("https://api.openai.com/v1/chat"); !ok || got != "api.openai.com" {
			t.Fatalf("got %q, %v", got, ok)
		}
	})

	t.Run("unrelated host is refused", func(t *testing.T) {
		// The key privacy property: a host that is not a known AI tool is not
		// reportable at all, so ordinary browsing never leaves the machine.
		for _, host := range []string{
			"mybank.example.com",
			"internal-hr-portal.corp",
			"notopenai.com",       // must not match "openai.com" by suffix
			"openai.com.evil.net", // must not match by prefix
		} {
			if got, ok := m.MatchHost(host); ok {
				t.Fatalf("MatchHost(%q) matched as %q; should be refused", host, got)
			}
		}
	})
}

func TestMatchApp(t *testing.T) {
	m := NewMatcher(Manifest{
		AppPatterns: []string{"ollama", "com.anthropic", "lm studio"},
	})

	if !m.MatchApp("Ollama") {
		t.Fatal("expected Ollama to match")
	}
	if !m.MatchApp("Claude", "com.anthropic.claudefordesktop", "") {
		t.Fatal("expected bundle id to match")
	}
	if m.MatchApp("Slack", "com.tinyspeck.slackmacgap", "Slack Technologies") {
		t.Fatal("Slack should not match an AI pattern")
	}
	if m.MatchApp("", "", "") {
		t.Fatal("empty input must not match")
	}
}

// Short patterns would match nearly every app on a machine, so the matcher
// drops them at compile time rather than trusting the manifest.
func TestShortPatternsAreDropped(t *testing.T) {
	m := NewMatcher(Manifest{AppPatterns: []string{"ai", "x", "ollama"}})
	if m.MatchApp("Mail") {
		t.Fatal(`the 2-char pattern "ai" must not be active (it matches "Mail")`)
	}
	if !m.MatchApp("Ollama") {
		t.Fatal("a long pattern must still match")
	}
}
