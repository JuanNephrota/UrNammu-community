//go:build windows

package collect

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"time"
)

// Windows application inventory.
//
// Installed software comes from the per-user and per-machine Uninstall keys —
// the same source Add/Remove Programs reads — and running software from the
// process list. MSIX/Store apps are not enumerated: they need the AppX
// PowerShell module, which is slow enough to be noticeable on a user's
// machine, and the AI tools in scope ship as classic installers.

// CollectApps returns AI applications installed or running on this machine.
func CollectApps(ctx context.Context, m *Matcher) ([]App, Status) {
	now := time.Now().UTC()
	byID := map[string]*App{}

	installed, scanned, err := installedPrograms(ctx)
	if err != nil {
		return nil, FailStatus("registry_unavailable")
	}

	for _, program := range installed {
		if !m.MatchApp(program.Name, program.Publisher) {
			continue
		}
		key := strings.ToLower(program.Name)
		byID[key] = &App{
			Name:      program.Name,
			Publisher: program.Publisher,
			Version:   program.Version,
			Count:     1,
			FirstSeen: now,
			LastSeen:  now,
		}
	}

	running, runningScanned := runningProcesses(ctx, m)
	scanned += runningScanned
	for _, proc := range running {
		key := strings.ToLower(proc.Name)
		if existing, ok := byID[key]; ok {
			existing.Running = true
			continue
		}
		copied := proc
		copied.FirstSeen = now
		copied.LastSeen = now
		byID[key] = &copied
	}

	out := make([]App, 0, len(byID))
	for _, app := range byID {
		out = append(out, *app)
	}
	return out, OKStatus(scanned)
}

type installedProgram struct {
	Name      string `json:"DisplayName"`
	Publisher string `json:"Publisher"`
	Version   string `json:"DisplayVersion"`
}

// installedPrograms reads both Uninstall hives via PowerShell.
//
// Reading the registry directly with golang.org/x/sys/windows/registry would
// avoid spawning a shell, but it is an extra dependency for an endpoint binary
// where the dependency list is itself a security property. One PowerShell call
// per cycle, at a 15-minute cadence, is not a cost worth a new module for.
func installedPrograms(ctx context.Context) ([]installedProgram, int, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	const script = `
$paths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
Get-ItemProperty $paths -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName } |
  Select-Object DisplayName, Publisher, DisplayVersion |
  ConvertTo-Json -Compress -Depth 2
`

	out, err := exec.CommandContext(cmdCtx, "powershell.exe",
		"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", script).Output()
	if err != nil {
		return nil, 0, err
	}

	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" {
		return nil, 0, nil
	}

	// ConvertTo-Json emits a bare object, not an array, when exactly one
	// program matches. Both shapes have to be accepted.
	var programs []installedProgram
	if err := json.Unmarshal([]byte(trimmed), &programs); err != nil {
		var single installedProgram
		if err := json.Unmarshal([]byte(trimmed), &single); err != nil {
			return nil, 0, err
		}
		programs = []installedProgram{single}
	}
	return programs, len(programs), nil
}

// runningProcesses lists AI-matching process image names.
func runningProcesses(ctx context.Context, m *Matcher) ([]App, int) {
	cmdCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// Image names only. Command lines are deliberately not read: they routinely
	// carry file paths, and on this fleet they would carry API keys too.
	out, err := exec.CommandContext(cmdCtx, "tasklist.exe", "/fo", "csv", "/nh").Output()
	if err != nil {
		return nil, 0
	}

	seen := map[string]struct{}{}
	var apps []App
	scanned := 0
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// CSV: "image.exe","PID","Session","Session#","Mem Usage"
		fields := strings.SplitN(line, "\",\"", 2)
		name := strings.Trim(fields[0], "\"")
		if name == "" {
			continue
		}
		scanned++
		if _, dup := seen[name]; dup {
			continue
		}
		if !m.MatchApp(name) {
			continue
		}
		seen[name] = struct{}{}
		apps = append(apps, App{Name: name, Running: true, Count: 1})
	}
	return apps, scanned
}
