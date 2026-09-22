//go:build darwin

package collect

import "context"

// macOS DNS observation — deliberately not implemented.
//
// There is no unprivileged, stable way to enumerate resolved hostnames on a
// modern macOS machine:
//
//   - `dscacheutil -cachedump -entries Host` requires root and has returned
//     an empty cache since mDNSResponder stopped exposing one.
//   - `scutil --dns` describes resolver *configuration*, not what was resolved.
//   - Sampling established connections with `lsof` yields remote IP addresses.
//     Reverse-resolving them gives the PTR of whatever CDN or cloud front the
//     provider sits behind — "api.openai.com" comes back as a Cloudflare or
//     Azure name that matches nothing in the manifest. The lookups are slow,
//     they are network-visible, and the yield is approximately zero.
//   - Anything better (NEDNSProxyProvider, an Endpoint Security client) means
//     a system extension, a kernel-adjacent entitlement, and an install the
//     user must approve — which is the EDR this agent is explicitly not.
//
// So rather than ship a collector that burns cycles to report nothing, macOS
// reports the collector as unsupported and the console says so. On macOS the
// browser collector carries AI web traffic and the app and runtime collectors
// carry everything local, which is the overwhelming majority of the signal.
// Windows, where `Get-DnsClientCache` is a real and unprivileged API, keeps
// the full network collector.
func CollectNetwork(_ context.Context, _ *Matcher) ([]NetworkHit, Status) {
	return nil, FailStatus("unsupported_platform")
}
