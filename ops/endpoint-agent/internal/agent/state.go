package agent

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/certifid/urnammu-endpoint-agent/internal/collect"
)

// State is everything the agent remembers between runs: its device
// credential, how far each collector has read, and any reports that have not
// been accepted yet.
type State struct {
	DeviceID    string    `json:"deviceId"`
	DeviceToken string    `json:"deviceToken"`
	EnrolledAt  time.Time `json:"enrolledAt"`

	// ManifestVersion drives the conditional manifest fetch.
	ManifestVersion string           `json:"manifestVersion,omitempty"`
	Manifest        collect.Manifest `json:"manifest,omitempty"`

	// BrowserWatermark is the newest visit already reported. Without it every
	// cycle would re-report the machine's entire history.
	BrowserWatermark time.Time `json:"browserWatermark,omitempty"`
}

// Store persists State and the spool to disk.
type Store struct {
	dir string
}

// NewStore prepares the state directory.
func NewStore(dir string) (*Store, error) {
	// 0700: the directory holds a bearer token. On a multi-user machine no
	// other user has any business reading it.
	if err := os.MkdirAll(filepath.Join(dir, "spool"), 0o700); err != nil {
		return nil, err
	}
	return &Store{dir: dir}, nil
}

func (s *Store) statePath() string { return filepath.Join(s.dir, "state.json") }

// Load reads persisted state. A missing file is not an error — it is a machine
// that has not enrolled yet.
func (s *Store) Load() (*State, error) {
	data, err := os.ReadFile(s.statePath())
	if errors.Is(err, os.ErrNotExist) {
		return &State{}, nil
	}
	if err != nil {
		return nil, err
	}
	state := &State{}
	if err := json.Unmarshal(data, state); err != nil {
		// Corrupt state is recoverable: discard it and re-enroll. Refusing to
		// start would leave the machine permanently dark over a truncated
		// write, which is a worse failure than a duplicate enrollment.
		return &State{}, nil
	}
	return state, nil
}

// Save writes state atomically so a crash mid-write cannot corrupt the token.
func (s *Store) Save(state *State) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.statePath() + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.statePath())
}

// ─── Spool ───────────────────────────────────────────────
// Reports are written to disk before they are sent and deleted only once the
// server has accepted them. A laptop that spends the afternoon on a plane
// reports the afternoon when it lands, rather than losing it.

// maxSpooledReports caps the backlog. Past this, the oldest are dropped: a
// machine that has been offline for weeks should report what it can rather
// than fill the user's disk, and the newest observations are the useful ones.
const maxSpooledReports = 96

func (s *Store) spoolDir() string { return filepath.Join(s.dir, "spool") }

// Spool writes a report to disk, pruning the backlog if it has grown too long.
func (s *Store) Spool(report *collect.Report) error {
	data, err := json.Marshal(report)
	if err != nil {
		return err
	}
	name := filepath.Join(s.spoolDir(), report.CollectedAt.UTC().Format("20060102T150405.000")+"-"+report.ReportID+".json")
	if err := os.WriteFile(name, data, 0o600); err != nil {
		return err
	}
	return s.prune()
}

// SpooledReports returns the backlog oldest-first.
func (s *Store) SpooledReports() ([]string, error) {
	entries, err := os.ReadDir(s.spoolDir())
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
			names = append(names, filepath.Join(s.spoolDir(), e.Name()))
		}
	}
	// Filenames are timestamp-prefixed, so lexical order is chronological.
	sort.Strings(names)
	return names, nil
}

// ReadSpooled loads one spooled report.
func (s *Store) ReadSpooled(path string) (*collect.Report, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	report := &collect.Report{}
	if err := json.Unmarshal(data, report); err != nil {
		// A report we cannot parse will never be accepted; drop it rather than
		// retry it forever and block the reports queued behind it.
		_ = os.Remove(path)
		return nil, err
	}
	return report, nil
}

// DropSpooled removes an accepted report.
func (s *Store) DropSpooled(path string) error {
	return os.Remove(path)
}

func (s *Store) prune() error {
	names, err := s.SpooledReports()
	if err != nil {
		return err
	}
	if len(names) <= maxSpooledReports {
		return nil
	}
	for _, name := range names[:len(names)-maxSpooledReports] {
		_ = os.Remove(name)
	}
	return nil
}
