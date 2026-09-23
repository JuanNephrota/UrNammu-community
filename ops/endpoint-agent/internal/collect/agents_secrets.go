package collect

import "strings"

// Credential-shape detection for the `agents` collector. Mirrored, rule for
// rule, by `looksLikeSecret` / `hostLooksSecret` in
// src/lib/validations/endpoint-agent.ts — change one, change the other.
//
// It is deliberately trigger-happy: a false positive costs a hashed server
// name, a dropped package id or a shortened hostname; a false negative ships a
// credential.

// secretPrefixes are token formats common in MCP configs. A prefix counts at
// the start of the value or after any separator ("Bearer sk-ant-…",
// "github ghp_…"), and only when what follows it carries a digit and is long
// enough to be a token, so words like "asia-pacific" do not trip it.
var secretPrefixes = []string{
	"sk-", "sk_", "pk_", "rk_", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_",
	"glpat-", "xoxb-", "xoxp-", "xoxa-", "xoxs-", "akia", "asia", "aiza", "ya29.",
	"eyj", "shpat_", "ntn_", "secret_", "lin_api_", "dop_v1_", "hf_",
}

// minSecretRun is the length at which an unbroken alphanumeric run with a
// digit in it is treated as a key or token (hex digests, base62 API keys).
const minSecretRun = 20

func isSecretSeparator(c byte) bool {
	switch c {
	case ' ', '\t', '.', '_', '-', '/', ':', '@', '=', '+', ',', ';':
		return true
	}
	return false
}

func isAlnum(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
}

func isHexByte(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

// looksLikeSecret flags strings shaped like credentials:
//   - a known token prefix at the start or after a separator;
//   - an alphanumeric run of minSecretRun+ characters containing a digit, or a
//     pure-hex run of 32+ (a digest with no digits is still a digest);
//   - a 32+ character mixed-case alphanumeric value with no spaces.
func looksLikeSecret(value string) bool {
	lower := strings.ToLower(value)
	for i := 0; i < len(lower); i++ {
		if i > 0 && !isSecretSeparator(lower[i-1]) {
			continue
		}
		for _, prefix := range secretPrefixes {
			if !strings.HasPrefix(lower[i:], prefix) {
				continue
			}
			rest := lower[i+len(prefix):]
			if j := strings.IndexAny(rest, " \t"); j >= 0 {
				rest = rest[:j]
			}
			if len(rest) >= 8 && strings.IndexAny(rest, "0123456789") >= 0 {
				return true
			}
		}
	}

	if hasSecretRun(value, minSecretRun, 32) {
		return true
	}

	if len(value) >= 32 && !strings.Contains(value, " ") {
		var upper, low, digit bool
		for i := 0; i < len(value); i++ {
			c := value[i]
			switch {
			case c >= 'A' && c <= 'Z':
				upper = true
			case c >= 'a' && c <= 'z':
				low = true
			case c >= '0' && c <= '9':
				digit = true
			}
		}
		if upper && low && digit {
			return true
		}
	}
	return false
}

// hasSecretRun reports whether `value` contains an alphanumeric run of at
// least `withDigit` characters that includes a digit, or a pure-hex run of at
// least `pureHex` characters.
func hasSecretRun(value string, withDigit, pureHex int) bool {
	start := 0
	for i := 0; i <= len(value); i++ {
		if i < len(value) && isAlnum(value[i]) {
			continue
		}
		run := value[start:i]
		if len(run) >= withDigit && strings.IndexAny(run, "0123456789") >= 0 {
			return true
		}
		if len(run) >= pureHex {
			allHex := true
			for j := 0; j < len(run); j++ {
				if !isHexByte(run[j]) {
					allHex = false
					break
				}
			}
			if allHex {
				return true
			}
		}
		start = i + 1
	}
	return false
}

// tunnelSuffixes are tunnelling services whose subdomains are per-user or
// per-session identifiers (jdoe.ngrok.io, a1b2-c3d4.trycloudflare.com). The
// service is worth reporting; the subdomain is not.
var tunnelSuffixes = []string{
	"ngrok.io", "ngrok.app", "ngrok-free.app", "ngrok.dev", "ngrok-free.dev",
	"trycloudflare.com", "loca.lt", "localtunnel.me", "serveo.net",
	"pagekite.me", "devtunnels.ms", "tunnelmole.net", "localhost.run", "lhr.life",
}

// hostLabelSuspicious flags a DNS label that could be carrying a credential
// or an identifier: credential-shaped, or holding a 16+ character
// alphanumeric run with a digit (or 16+ pure hex).
func hostLabelSuspicious(label string) bool {
	return looksLikeSecret(label) || hasSecretRun(label, 16, 16)
}

// reduceHost keeps a reportable hostname, or cuts it down to its last two
// labels when a label looks like a secret or the host is a tunnel endpoint.
func reduceHost(host string) string {
	for _, suffix := range tunnelSuffixes {
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			return suffix
		}
	}
	labels := strings.Split(host, ".")
	for _, label := range labels {
		if hostLabelSuspicious(label) {
			if len(labels) <= 2 {
				// Even the registrable part is suspicious: report nothing.
				if hostLabelSuspicious(labels[0]) {
					return ""
				}
				return host
			}
			reduced := strings.Join(labels[len(labels)-2:], ".")
			if hostLabelSuspicious(labels[len(labels)-2]) {
				return ""
			}
			return reduced
		}
	}
	return host
}
