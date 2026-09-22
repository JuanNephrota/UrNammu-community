//go:build darwin

package collect

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// macOS application inventory.
//
// Two passes: bundles on disk (what is installed) and running processes (what
// is actually being used). Installed-but-never-run is weak evidence; running
// is strong. Both are reported, with `Running` distinguishing them, because
// "Ollama is installed on 40 laptops but running on 2" is a different
// governance conversation from either number alone.

var appDirs = []string{
	"/Applications",
	"/Applications/Utilities",
}

// CollectApps returns AI applications installed or running for this user.
func CollectApps(ctx context.Context, m *Matcher) ([]App, Status) {
	now := time.Now().UTC()
	byID := map[string]*App{}
	scanned := 0

	dirs := append([]string{}, appDirs...)
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, "Applications"))
	}

	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !strings.HasSuffix(e.Name(), ".app") {
				continue
			}
			scanned++
			name := strings.TrimSuffix(e.Name(), ".app")
			bundleID, version, publisher := readBundleInfo(filepath.Join(dir, e.Name()))
			if !m.MatchApp(name, bundleID, publisher) {
				continue
			}
			key := bundleID
			if key == "" {
				key = name
			}
			byID[key] = &App{
				Name:       name,
				Identifier: bundleID,
				Publisher:  publisher,
				Version:    version,
				Count:      1,
				FirstSeen:  now,
				LastSeen:   now,
			}
		}
	}

	// Running processes. `ps` is used rather than a native API so the agent
	// stays a plain unprivileged binary with no Objective-C runtime linkage.
	running, runningCount := runningProcesses(ctx, m)
	scanned += runningCount
	for _, proc := range running {
		key := proc.Identifier
		if key == "" {
			key = proc.Name
		}
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

// readBundleInfo pulls the bundle id, version and publisher out of Info.plist.
//
// `plutil -convert json` is used instead of a plist parser because it ships
// with macOS and handles both the binary and XML plist encodings, which a
// hand-rolled reader would have to special-case.
func readBundleInfo(bundlePath string) (bundleID, version, publisher string) {
	plist := filepath.Join(bundlePath, "Contents", "Info.plist")
	if _, err := os.Stat(plist); err != nil {
		return "", "", ""
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, "plutil", "-convert", "json", "-o", "-", plist).Output()
	if err != nil {
		return "", "", ""
	}

	var info struct {
		BundleID    string `json:"CFBundleIdentifier"`
		ShortVersion string `json:"CFBundleShortVersionString"`
		Version     string `json:"CFBundleVersion"`
		Copyright   string `json:"NSHumanReadableCopyright"`
	}
	if err := json.Unmarshal(out, &info); err != nil {
		return "", "", ""
	}

	version = info.ShortVersion
	if version == "" {
		version = info.Version
	}
	// The copyright string is the only publisher-ish field a bundle reliably
	// carries. It is noisy, so it is truncated and used only as a match hint.
	publisher = strings.TrimSpace(info.Copyright)
	if len(publisher) > 120 {
		publisher = publisher[:120]
	}
	return info.BundleID, version, publisher
}

// helperSuffixes are the Chromium/Electron subprocess markers.
//
// An Electron app runs a swarm of helpers — "Claude Helper",
// "Claude Helper (Renderer)", "Claude Helper (GPU)" — and every one of them
// matches the same registry pattern as the app itself. Reporting them would
// turn one installed tool into six detection rows that all mean "Claude is
// open", burying the actual inventory. The parent process is reported; its
// children are not evidence of anything the parent is not.
var helperSuffixes = []string{
	" helper",
	"(renderer)",
	"(gpu)",
	"(plugin)",
	"(alerts)",
	"uiviewservice",
	"crashpad_handler",
	"webcontentsprocess",
}

func isHelperProcess(name string) bool {
	lower := strings.ToLower(name)
	for _, suffix := range helperSuffixes {
		if strings.Contains(lower, suffix) {
			return true
		}
	}
	return false
}

// runningProcesses lists AI-matching processes owned by the current user.
func runningProcesses(ctx context.Context, m *Matcher) ([]App, int) {
	cmdCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// -x includes processes without a controlling terminal; -o comm= prints
	// the executable path alone, with no arguments — command-line arguments
	// can carry file paths and API keys and are deliberately not read.
	out, err := exec.CommandContext(cmdCtx, "ps", "-axco", "command=").Output()
	if err != nil {
		return nil, 0
	}

	seen := map[string]struct{}{}
	var apps []App
	scanned := 0
	for _, line := range strings.Split(string(out), "\n") {
		name := strings.TrimSpace(line)
		if name == "" {
			continue
		}
		scanned++
		if _, dup := seen[name]; dup {
			continue
		}
		if isHelperProcess(name) {
			continue
		}
		if !m.MatchApp(name) {
			continue
		}
		seen[name] = struct{}{}
		apps = append(apps, App{
			Name:    name,
			Running: true,
			Count:   1,
		})
	}
	return apps, scanned
}
