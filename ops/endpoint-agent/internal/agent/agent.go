package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"runtime"
	"time"

	"github.com/certifid/urnammu-endpoint-agent/internal/api"
	"github.com/certifid/urnammu-endpoint-agent/internal/collect"
	"github.com/certifid/urnammu-endpoint-agent/internal/machineid"
)

// Agent is the supervised run loop: enroll once, then collect, spool and flush
// on the cadence the server dictates.
type Agent struct {
	cfg     *Config
	store   *Store
	client  *api.Client
	state   *State
	version string
	log     *log.Logger
}

// New builds an agent from a validated config.
func New(cfg *Config, version string, logger *log.Logger) (*Agent, error) {
	store, err := NewStore(cfg.StateDir)
	if err != nil {
		return nil, fmt.Errorf("state dir: %w", err)
	}
	state, err := store.Load()
	if err != nil {
		return nil, fmt.Errorf("load state: %w", err)
	}
	return &Agent{
		cfg:     cfg,
		store:   store,
		client:  api.New(cfg.ConsoleURL, version),
		state:   state,
		version: version,
		log:     logger,
	}, nil
}

// Run collects and reports until the context is cancelled.
//
// The interval is whatever the manifest says, so cadence is a console-side
// decision. Until the first manifest arrives it falls back to 15 minutes.
func (a *Agent) Run(ctx context.Context) error {
	if err := a.ensureEnrolled(ctx); err != nil {
		// A revoked device must exit *successfully*. launchd and the Windows
		// service manager both restart a process that exits non-zero, so
		// returning the error here would turn a deliberate revocation into a
		// permanent crash loop that re-hits the enroll endpoint forever.
		if errors.Is(err, api.ErrRevoked) {
			a.log.Printf("device revoked by the console; stopping")
			return nil
		}
		return err
	}

	for {
		interval := a.interval()
		if err := a.cycle(ctx); err != nil {
			if errors.Is(err, api.ErrRevoked) {
				// Terminal by design. Exiting cleanly lets the service manager
				// see a normal stop rather than a crash loop, and the machine
				// stops collecting immediately.
				a.log.Printf("device revoked by the console; stopping")
				return nil
			}
			a.log.Printf("cycle error: %v", err)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(jitter(interval)):
		}
	}
}

// RunOnce performs a single cycle. Used by `--once` for MDM smoke tests.
func (a *Agent) RunOnce(ctx context.Context) error {
	if err := a.ensureEnrolled(ctx); err != nil {
		return err
	}
	return a.cycle(ctx)
}

func (a *Agent) interval() time.Duration {
	seconds := a.state.Manifest.ReportIntervalSeconds
	if seconds < 60 {
		return 15 * time.Minute
	}
	return time.Duration(seconds) * time.Second
}

// jitter spreads a fleet's reports out.
//
// Without it, a few thousand agents installed by the same MDM push would wake
// on the same schedule and arrive as a thundering herd every interval. Up to
// 10% of the interval is enough to smear them.
func jitter(d time.Duration) time.Duration {
	var b [2]byte
	if _, err := rand.Read(b[:]); err != nil {
		return d
	}
	spread := float64(d) * 0.1
	fraction := float64(uint16(b[0])<<8|uint16(b[1])) / float64(math.MaxUint16)
	return d + time.Duration(spread*fraction)
}

// ensureEnrolled obtains a device token if there is not already one.
func (a *Agent) ensureEnrolled(ctx context.Context) error {
	if a.state.DeviceToken != "" {
		return nil
	}

	id, err := machineid.ID()
	if err != nil {
		return fmt.Errorf("machine id: %w", err)
	}
	hostname, _ := os.Hostname()

	resp, err := a.client.Enroll(ctx, a.cfg.EnrollmentSecret, api.EnrollRequest{
		MachineID:    id,
		Hostname:     hostname,
		Platform:     runtime.GOOS,
		OSVersion:    machineid.OSVersion(),
		Arch:         runtime.GOARCH,
		AgentVersion: a.version,
		UserEmail:    a.cfg.UserEmail,
		UserName:     a.cfg.UserName,
	})
	if err != nil {
		return fmt.Errorf("enroll: %w", err)
	}

	a.state.DeviceID = resp.DeviceID
	a.state.DeviceToken = resp.Token
	a.state.EnrolledAt = time.Now().UTC()
	if err := a.store.Save(a.state); err != nil {
		return fmt.Errorf("persist enrollment: %w", err)
	}

	a.log.Printf("enrolled as device %s (re-enrolled=%t)", resp.DeviceID, resp.ReEnrolled)
	return nil
}

// DryRun collects one cycle and writes the report to w without sending or
// spooling it.
//
// This is the privacy review tool: a works council, a security reviewer or a
// sceptical employee can run it on their own machine and read the exact bytes
// the agent would transmit. Anything the agent could send but this does not
// show would be a bug.
//
// It still enrolls, because the manifest — the allowlist that decides what is
// collectable at all — is server-issued and there is no honest way to preview
// collection without it.
func (a *Agent) DryRun(ctx context.Context, w io.Writer) error {
	if err := a.ensureEnrolled(ctx); err != nil {
		return err
	}
	if err := a.refreshManifest(ctx); err != nil && a.state.Manifest.Version == "" {
		return fmt.Errorf("no manifest available: %w", err)
	}

	report, err := a.collect(ctx)
	if err != nil {
		return err
	}

	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}

// cycle is one full pass: refresh the manifest, collect, spool, flush.
func (a *Agent) cycle(ctx context.Context) error {
	if err := a.refreshManifest(ctx); err != nil {
		if errors.Is(err, api.ErrRevoked) {
			return err
		}
		// A stale manifest is fine; a missing one is not. Collecting with no
		// allowlist at all would mean either reporting everything or nothing,
		// and reporting everything is not a thing this agent may do.
		if a.state.Manifest.Version == "" {
			return fmt.Errorf("no manifest available: %w", err)
		}
		a.log.Printf("manifest refresh failed, using cached %s: %v", a.state.Manifest.Version, err)
	}

	report, err := a.collect(ctx)
	if err != nil {
		return err
	}
	if err := a.store.Spool(report); err != nil {
		return fmt.Errorf("spool: %w", err)
	}

	return a.flush(ctx)
}

func (a *Agent) refreshManifest(ctx context.Context) error {
	manifest, err := a.client.Manifest(ctx, a.state.DeviceToken, a.state.ManifestVersion)
	if errors.Is(err, api.ErrNotModified) {
		return nil
	}
	if errors.Is(err, api.ErrUnauthorized) {
		// The console re-issued or dropped our token. Clear it and enroll
		// again on the next cycle rather than going permanently silent.
		a.log.Printf("device token rejected; re-enrolling")
		a.state.DeviceToken = ""
		_ = a.store.Save(a.state)
		return a.ensureEnrolled(ctx)
	}
	if err != nil {
		return err
	}

	a.state.Manifest = *manifest
	a.state.ManifestVersion = manifest.Version
	return a.store.Save(a.state)
}

// collect runs every enabled collector and assembles a report.
func (a *Agent) collect(ctx context.Context) (*collect.Report, error) {
	manifest := a.state.Manifest
	matcher := collect.NewMatcher(manifest)
	statuses := map[string]collect.Status{}
	now := time.Now().UTC()

	report := &collect.Report{
		ReportID:     newReportID(),
		MachineID:    "",
		AgentVersion: a.version,
		OSVersion:    machineid.OSVersion(),
		UserEmail:    a.cfg.UserEmail,
		UserName:     a.cfg.UserName,
		CollectedAt:  now,
	}
	if hostname, err := os.Hostname(); err == nil {
		report.Hostname = hostname
	}
	id, err := machineid.ID()
	if err != nil {
		return nil, fmt.Errorf("machine id: %w", err)
	}
	report.MachineID = id

	if manifest.Collectors["apps"] {
		apps, status := collect.CollectApps(ctx, matcher)
		report.Apps = apps
		statuses["apps"] = status
	}

	if manifest.Collectors["browser"] {
		// Watermark keeps each cycle incremental. The first run after install
		// deliberately looks back 30 days: enough to establish what a machine
		// actually uses, short enough not to resurrect years of history.
		since := a.state.BrowserWatermark
		if since.IsZero() {
			since = now.AddDate(0, 0, -30)
		}
		visits, status := collect.CollectBrowser(matcher, since)
		report.Browser = visits
		statuses["browser"] = status
		if status.OK {
			// Advance only on success, so a permissions failure does not skip
			// a window. One second of overlap is cheap and avoids losing a
			// visit that landed in the same second as the read.
			a.state.BrowserWatermark = now.Add(-time.Second)
		}
	}

	if manifest.Collectors["network"] {
		hits, status := collect.CollectNetwork(ctx, matcher)
		report.Network = hits
		statuses["network"] = status
	}

	if manifest.Collectors["runtimes"] {
		runtimes, status := collect.CollectRuntimes(ctx, manifest)
		report.Runtimes = runtimes
		statuses["runtimes"] = status
	}

	if manifest.Collectors["agents"] {
		servers, frameworks, status := collect.CollectAgents()
		report.MCPServers = servers
		report.Frameworks = frameworks
		statuses["agents"] = status
	}

	report.Collectors = statuses

	// Go marshals a nil slice as `null`, and the server's schema defaults only
	// fire on an absent key — a `null` is a validation error. A cycle that
	// found no local runtimes is the common case, so without this every such
	// report would be rejected with a 400 and dropped as permanently bad.
	if report.Apps == nil {
		report.Apps = []collect.App{}
	}
	if report.Browser == nil {
		report.Browser = []collect.BrowserVisit{}
	}
	if report.Network == nil {
		report.Network = []collect.NetworkHit{}
	}
	if report.Runtimes == nil {
		report.Runtimes = []collect.Runtime{}
	}
	if report.MCPServers == nil {
		report.MCPServers = []collect.MCPServer{}
	}
	if report.Frameworks == nil {
		report.Frameworks = []collect.AgentFramework{}
	}

	if err := a.store.Save(a.state); err != nil {
		a.log.Printf("could not persist watermark: %v", err)
	}
	return report, nil
}

// flush sends the spooled backlog oldest-first.
//
// It stops at the first transient failure rather than continuing, so reports
// arrive in order and a console outage does not turn into a retry storm.
func (a *Agent) flush(ctx context.Context) error {
	paths, err := a.store.SpooledReports()
	if err != nil {
		return err
	}

	for _, path := range paths {
		report, err := a.store.ReadSpooled(path)
		if err != nil {
			continue // ReadSpooled already dropped the unparseable file
		}

		err = a.client.SendReport(ctx, a.state.DeviceToken, report)
		switch {
		case err == nil:
			if err := a.store.DropSpooled(path); err != nil {
				a.log.Printf("could not drop accepted report: %v", err)
			}

		case errors.Is(err, api.ErrRevoked):
			return err

		case errors.Is(err, api.ErrUnauthorized):
			a.log.Printf("device token rejected during flush; re-enrolling")
			a.state.DeviceToken = ""
			_ = a.store.Save(a.state)
			return a.ensureEnrolled(ctx)

		default:
			var permanent *api.PermanentError
			if errors.As(err, &permanent) {
				// The server will never take this body. Drop it so it cannot
				// block the reports behind it forever.
				a.log.Printf("dropping report the console rejected: %v", permanent)
				_ = a.store.DropSpooled(path)
				continue
			}
			return fmt.Errorf("send report: %w", err)
		}
	}
	return nil
}

func newReportID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// A time-derived fallback still gives the server a distinct id; the
		// value only needs to be unique per report, not unguessable.
		return fmt.Sprintf("%08x-0000-4000-8000-%012x", time.Now().Unix(), time.Now().UnixNano()&0xffffffffffff)
	}
	// RFC 4122 version 4.
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b[:])
	return fmt.Sprintf("%s-%s-%s-%s-%s", h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])
}
