//go:build windows

package machineid

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// ID returns the machine's MachineGuid.
//
// MachineGuid is written at OS install and is stable across hostname changes
// and domain joins. It changes on reimage, which forks a new device row — the
// correct outcome, since a reimaged machine has no continuity of state.
func ID() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	const script = `(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid`
	out, err := exec.CommandContext(ctx, "powershell.exe",
		"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", script).Output()
	if err != nil {
		return "", err
	}
	id := strings.TrimSpace(string(out))
	if id == "" {
		return "", errNoMachineID
	}
	return id, nil
}

// OSVersion returns the Windows build string, e.g. "10.0.22631".
func OSVersion() string {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, "powershell.exe",
		"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", "[System.Environment]::OSVersion.Version.ToString()").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
