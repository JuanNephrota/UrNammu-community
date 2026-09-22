package collect

import (
	"net/url"
	"strings"
)

// Matcher is the agent's local half of detection: a crude, fast "is this worth
// reporting" test built from the server manifest. It deliberately does not try
// to decide *which* tool something is — that runs server-side, where the full
// registry and its scoring live. Keeping the agent dumb means growing the
// registry never requires an agent release.
type Matcher struct {
	domains     map[string]struct{}
	appPatterns []string
}

// NewMatcher compiles a manifest into a matcher.
func NewMatcher(m Manifest) *Matcher {
	domains := make(map[string]struct{}, len(m.Domains))
	for _, d := range m.Domains {
		domains[strings.ToLower(strings.TrimSpace(d))] = struct{}{}
	}
	patterns := make([]string, 0, len(m.AppPatterns))
	for _, p := range m.AppPatterns {
		p = strings.ToLower(strings.TrimSpace(p))
		if len(p) >= 3 {
			patterns = append(patterns, p)
		}
	}
	return &Matcher{domains: domains, appPatterns: patterns}
}

// MatchHost reports whether a hostname is on the allowlist, and returns the
// normalized hostname to report.
//
// Subdomains match their registered parent, so a manifest entry of
// "openai.com" covers "api.openai.com" without enumerating every host. The
// walk is right-to-left over labels and stops at two labels, so a manifest
// entry can never be so short that it matches a whole TLD.
func (m *Matcher) MatchHost(host string) (string, bool) {
	h := NormalizeHost(host)
	if h == "" {
		return "", false
	}
	if _, ok := m.domains[h]; ok {
		return h, true
	}
	labels := strings.Split(h, ".")
	for i := 1; i < len(labels)-1; i++ {
		parent := strings.Join(labels[i:], ".")
		if _, ok := m.domains[parent]; ok {
			return h, true
		}
	}
	return "", false
}

// MatchApp reports whether an app name, bundle id or publisher looks like a
// known AI tool.
func (m *Matcher) MatchApp(fields ...string) bool {
	var b strings.Builder
	for _, f := range fields {
		if f == "" {
			continue
		}
		b.WriteString(strings.ToLower(f))
		b.WriteByte(' ')
	}
	haystack := b.String()
	if strings.TrimSpace(haystack) == "" {
		return false
	}
	for _, p := range m.appPatterns {
		if strings.Contains(haystack, p) {
			return true
		}
	}
	return false
}

// NormalizeHost reduces anything host-like to a bare lowercase hostname.
//
// This is a safety boundary as much as a convenience: the browser collector
// reads full URLs out of history databases, and this is the funnel that
// guarantees only the host survives. Paths, queries, fragments, ports,
// userinfo and trailing dots are all dropped, and anything still containing a
// slash, space or '@' afterwards is rejected outright rather than reported.
func NormalizeHost(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if strings.Contains(s, "://") {
		if u, err := url.Parse(s); err == nil && u.Hostname() != "" {
			s = u.Hostname()
		} else {
			return ""
		}
	}
	// Defensive: strip anything after the authority even if Parse was skipped.
	if i := strings.IndexAny(s, "/?#"); i >= 0 {
		s = s[:i]
	}
	if i := strings.LastIndex(s, "@"); i >= 0 {
		s = s[i+1:]
	}
	if strings.HasPrefix(s, "[") { // IPv6 literal — never a reportable host
		return ""
	}
	if i := strings.LastIndex(s, ":"); i >= 0 {
		s = s[:i]
	}
	s = strings.ToLower(strings.TrimSuffix(s, "."))
	s = strings.TrimPrefix(s, "www.")
	if s == "" || strings.ContainsAny(s, "/ \t@?#") {
		return ""
	}
	if !strings.Contains(s, ".") {
		return "" // bare labels ("localhost") are not reportable
	}
	return s
}
