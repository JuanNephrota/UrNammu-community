// Package collect holds the endpoint collectors and the wire types they
// produce. Every type here is shaped to match the server's Zod schemas in
// src/lib/validations/endpoint-agent.ts — that file is the contract, and a
// change on either side must be mirrored on the other.
//
// The single rule this package exists to enforce: collectors emit
// *identifiers and counts only*. No prompt, no response, no URL path, no
// window title, no file path, no page title. A hostname is the most specific
// thing that may leave the machine.
package collect

import "time"

// Manifest is the server-issued detection filter. Collectors consult it before
// reporting anything, so an observation that matches nothing known never
// leaves the endpoint.
type Manifest struct {
	Version               string            `json:"version"`
	ReportIntervalSeconds int               `json:"reportIntervalSeconds"`
	Collectors            map[string]bool   `json:"collectors"`
	Domains               []string          `json:"domains"`
	AppPatterns           []string          `json:"appPatterns"`
	Runtimes              []ManifestRuntime `json:"runtimes"`
}

// ManifestRuntime describes one local inference runtime to probe.
type ManifestRuntime struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Ports      []int  `json:"ports"`
	ModelsPath string `json:"modelsPath"`
}

// App is an installed or running AI application.
type App struct {
	Name       string    `json:"name"`
	Identifier string    `json:"identifier,omitempty"`
	Publisher  string    `json:"publisher,omitempty"`
	Version    string    `json:"version,omitempty"`
	Running    bool      `json:"running"`
	Count      int       `json:"count"`
	FirstSeen  time.Time `json:"firstSeen"`
	LastSeen   time.Time `json:"lastSeen"`
}

// BrowserVisit is an allowlisted AI hostname seen in browser history.
// Only the hostname and a visit count travel — never the URL.
type BrowserVisit struct {
	Domain    string    `json:"domain"`
	Browser   string    `json:"browser"`
	Visits    int       `json:"visits"`
	FirstSeen time.Time `json:"firstSeen"`
	LastSeen  time.Time `json:"lastSeen"`
}

// NetworkHit is an allowlisted AI hostname seen in the DNS cache.
type NetworkHit struct {
	Domain    string    `json:"domain"`
	Count     int       `json:"count"`
	FirstSeen time.Time `json:"firstSeen"`
	LastSeen  time.Time `json:"lastSeen"`
}

// Runtime is a local inference server answering on the loopback interface.
type Runtime struct {
	Runtime   string    `json:"runtime"`
	Port      int       `json:"port"`
	Models    []string  `json:"models"`
	FirstSeen time.Time `json:"firstSeen"`
	LastSeen  time.Time `json:"lastSeen"`
}

// MCPServer is one MCP server configured in an MCP client on this machine.
//
// Identifiers only — see agents.go for exactly how each field is derived and
// what is discarded. Host is set for remote servers, Launcher and Package for
// stdio ones; Loopback marks a remote server on localhost.
type MCPServer struct {
	Client    string `json:"client"`
	Name      string `json:"name"`
	Transport string `json:"transport"`
	Host      string `json:"host,omitempty"`
	Loopback  bool   `json:"loopback,omitempty"`
	Launcher  string `json:"launcher,omitempty"`
	Package   string `json:"package,omitempty"`
}

// AgentFramework is an agent SDK installed in a well-known package location.
// Count is the number of environments of that kind that have it.
type AgentFramework struct {
	Framework string `json:"framework"`
	Ecosystem string `json:"ecosystem"`
	Source    string `json:"source"`
	Count     int    `json:"count"`
}

// Status is one collector's outcome, so the console can tell "found nothing"
// from "could not look" — the Safari/Full Disk Access case, mostly.
type Status struct {
	OK           bool   `json:"ok"`
	Reason       string `json:"reason,omitempty"`
	ItemsScanned *int   `json:"itemsScanned,omitempty"`
}

// Result is one full collection cycle.
type Result struct {
	Apps       []App             `json:"apps"`
	Browser    []BrowserVisit    `json:"browser"`
	Network    []NetworkHit      `json:"network"`
	Runtimes   []Runtime         `json:"runtimes"`
	Collectors map[string]Status `json:"collectors"`
}

// Report is the request body of POST /api/endpoint-agent/report.
type Report struct {
	ReportID     string            `json:"reportId"`
	MachineID    string            `json:"machineId"`
	AgentVersion string            `json:"agentVersion,omitempty"`
	OSVersion    string            `json:"osVersion,omitempty"`
	Hostname     string            `json:"hostname,omitempty"`
	UserEmail    string            `json:"userEmail,omitempty"`
	UserName     string            `json:"userName,omitempty"`
	CollectedAt  time.Time         `json:"collectedAt"`
	Apps         []App             `json:"apps"`
	Browser      []BrowserVisit    `json:"browser"`
	Network      []NetworkHit      `json:"network"`
	Runtimes     []Runtime         `json:"runtimes"`
	MCPServers   []MCPServer       `json:"mcpServers"`
	Frameworks   []AgentFramework  `json:"agentFrameworks"`
	Collectors   map[string]Status `json:"collectors"`
}

func intPtr(v int) *int { return &v }

// OKStatus is a successful collector outcome with a scanned count.
func OKStatus(scanned int) Status {
	return Status{OK: true, ItemsScanned: intPtr(scanned)}
}

// FailStatus is a collector that could not run. `reason` is a short
// machine-readable token ("no_access", "not_installed", "unsupported_os"),
// never an error string that might embed a path.
func FailStatus(reason string) Status {
	return Status{OK: false, Reason: reason}
}
