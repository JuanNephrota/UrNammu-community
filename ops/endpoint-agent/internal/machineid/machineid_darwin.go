//go:build darwin

package machineid

import (
	"context"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var uuidPattern = regexp.MustCompile(`"IOPlatformUUID"\s*=\s*"([^"]+)"`)

// ID returns the machine's hardware UUID.
//
// IOPlatformUUID is the right identifier here: it survives OS reinstall and
// hostname changes, so a reimaged laptop re-enrolls onto its existing device
// row rather than forking a duplicate. It is not a secret and is not derived
// from anything about the user.
func ID() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, "ioreg", "-rd1", "-c", "IOPlatformExpertDevice").Output()
	if err != nil {
		return "", err
	}
	match := uuidPattern.FindSubmatch(out)
	if len(match) < 2 {
		return "", errNoMachineID
	}
	return strings.TrimSpace(string(match[1])), nil
}

// OSVersion returns the macOS product version, e.g. "15.2".
func OSVersion() string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, "sw_vers", "-productVersion").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
