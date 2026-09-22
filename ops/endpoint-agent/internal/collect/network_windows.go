//go:build windows

package collect

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"os/exec"
)

// Windows DNS cache sampling.
//
// `Get-DnsClientCache` is a documented, unprivileged cmdlet that returns the
// resolver cache, which makes this collector genuinely reliable on Windows —
// unlike its macOS counterpart. It catches AI traffic that neither the browser
// nor the app collector sees: a script, a CI runner, an IDE plugin, anything
// talking to an API host directly.
//
// The cache is a *sample*, not a log. Entries expire on their TTL, so a hit
// means "resolved recently", and a miss means nothing at all. Counts are
// therefore reported as 1 per observation rather than as a request total.

// CollectNetwork samples the DNS resolver cache for allowlisted AI hostnames.
func CollectNetwork(ctx context.Context, m *Matcher) ([]NetworkHit, Status) {
	cmdCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	const script = `Get-DnsClientCache -ErrorAction SilentlyContinue |
	  Select-Object -ExpandProperty Entry -Unique |
	  ConvertTo-Json -Compress`

	out, err := exec.CommandContext(cmdCtx, "powershell.exe",
		"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", script).Output()
	if err != nil {
		return nil, FailStatus("dns_cache_unavailable")
	}

	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" {
		return nil, OKStatus(0)
	}

	var entries []string
	if err := json.Unmarshal([]byte(trimmed), &entries); err != nil {
		var single string
		if err := json.Unmarshal([]byte(trimmed), &single); err != nil {
			return nil, FailStatus("dns_cache_unparseable")
		}
		entries = []string{single}
	}

	now := time.Now().UTC()
	seen := map[string]struct{}{}
	var hits []NetworkHit
	for _, raw := range entries {
		host, ok := m.MatchHost(raw)
		if !ok {
			continue
		}
		if _, dup := seen[host]; dup {
			continue
		}
		seen[host] = struct{}{}
		hits = append(hits, NetworkHit{
			Domain:    host,
			Count:     1,
			FirstSeen: now,
			LastSeen:  now,
		})
	}
	return hits, OKStatus(len(entries))
}
