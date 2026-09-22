// Package agent wires the collectors, the local state store and the UrNammu
// API client into a supervised run loop.
package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Config is what MDM writes to disk next to the binary. It holds no secrets
// beyond the enrollment secret, which is traded for a per-device token on
// first run and is not needed afterwards.
type Config struct {
	// ConsoleURL is the UrNammu origin, e.g. https://urnammu.example.com.
	ConsoleURL string `json:"consoleUrl"`
	// EnrollmentSecret authenticates the one-time enrollment call.
	EnrollmentSecret string `json:"enrollmentSecret"`
	// StateDir overrides where the device token and watermarks are kept.
	StateDir string `json:"stateDir,omitempty"`
	// UserEmail identifies the console user. MDM substitutes this at deploy
	// time; without it, endpoint findings cannot be attributed to a person.
	UserEmail string `json:"userEmail,omitempty"`
	UserName  string `json:"userName,omitempty"`
	// Insecure permits a plain-http console URL. Development only — the
	// agent refuses to start with it set against a non-loopback host.
	Insecure bool `json:"insecure,omitempty"`
}

// DefaultConfigPaths lists where the agent looks for its config, in order.
func DefaultConfigPaths() []string {
	if runtime.GOOS == "windows" {
		programData := os.Getenv("ProgramData")
		if programData == "" {
			programData = `C:\ProgramData`
		}
		return []string{filepath.Join(programData, "UrNammu", "agent.json")}
	}
	return []string{
		"/Library/Application Support/UrNammu/agent.json",
		"/etc/urnammu/agent.json",
	}
}

// DefaultStateDir is where the device token and watermarks live.
//
// State is machine-scoped, not user-scoped, because the device token belongs
// to the machine. On macOS it sits under /Library rather than the user's home
// so a re-enrollment is not triggered by a home-directory migration.
func DefaultStateDir() string {
	if runtime.GOOS == "windows" {
		programData := os.Getenv("ProgramData")
		if programData == "" {
			programData = `C:\ProgramData`
		}
		return filepath.Join(programData, "UrNammu", "state")
	}
	return "/Library/Application Support/UrNammu/state"
}

// LoadConfig reads and validates the agent config.
//
// Environment overrides exist for development and for MDM systems that find it
// easier to set a variable than to template a file. Ordinary deployments
// should use the file, which MDM can lock down to 0600 root-owned.
func LoadConfig(explicitPath string) (*Config, error) {
	paths := DefaultConfigPaths()
	if explicitPath != "" {
		paths = []string{explicitPath}
	}

	cfg := &Config{}
	loaded := false
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("config %s: %w", path, err)
		}
		loaded = true
		break
	}

	if v := os.Getenv("URNAMMU_CONSOLE_URL"); v != "" {
		cfg.ConsoleURL = v
		loaded = true
	}
	if v := os.Getenv("URNAMMU_ENROLLMENT_SECRET"); v != "" {
		cfg.EnrollmentSecret = v
		loaded = true
	}
	if v := os.Getenv("URNAMMU_STATE_DIR"); v != "" {
		cfg.StateDir = v
	}
	if v := os.Getenv("URNAMMU_USER_EMAIL"); v != "" {
		cfg.UserEmail = v
	}

	if !loaded {
		return nil, fmt.Errorf("no config found (looked in %s)", strings.Join(paths, ", "))
	}
	if cfg.StateDir == "" {
		cfg.StateDir = DefaultStateDir()
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) validate() error {
	if c.ConsoleURL == "" {
		return errors.New("consoleUrl is required")
	}
	parsed, err := url.Parse(c.ConsoleURL)
	if err != nil {
		return fmt.Errorf("consoleUrl is not a valid URL: %w", err)
	}
	if parsed.Host == "" {
		return errors.New("consoleUrl must include a host")
	}
	// The agent carries a bearer token and reports where people work. Sending
	// either over cleartext would be indefensible, so plain http is refused
	// outright except against loopback for local development.
	if parsed.Scheme != "https" {
		isLoopback := parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1"
		if !(c.Insecure && isLoopback) {
			return errors.New("consoleUrl must use https")
		}
	}
	if c.EnrollmentSecret == "" {
		return errors.New("enrollmentSecret is required")
	}
	c.ConsoleURL = strings.TrimRight(c.ConsoleURL, "/")
	return nil
}
