package collect

import (
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Browser history collection.
//
// What leaves the machine: a hostname that is already on the server-issued
// allowlist, a visit count, and a time window. The URL, its path, its query
// and the page title are read into memory to extract the hostname and are
// never retained, never logged, and never transmitted. Everything funnels
// through Matcher.MatchHost, which drops anything that is not an allowlisted
// bare host.
//
// Profiles are copied before reading. Chrome-family browsers hold the history
// database open in WAL mode, so reading the main file in place both risks
// SQLITE_BUSY and silently misses the most recent visits — exactly the ones
// that matter. The copy takes the -wal and -shm sidecars so SQLite can recover
// the full picture from a private snapshot.

type browserProfile struct {
	browser string
	// path to the history database
	path string
	// kind selects the schema: "chromium", "firefox" or "safari"
	kind string
}

// CollectBrowser walks every discoverable profile and returns allowlisted
// hostname visits newer than `since`.
//
// `since` makes each run incremental: a laptop with years of history reports
// only what happened in the last cycle, which keeps reports small and keeps
// the agent from re-asserting ancient activity as if it were current.
func CollectBrowser(m *Matcher, since time.Time) ([]BrowserVisit, Status) {
	profiles := discoverBrowserProfiles()
	if len(profiles) == 0 {
		return nil, FailStatus("no_profiles")
	}

	type agg struct {
		visits    int
		firstSeen time.Time
		lastSeen  time.Time
	}
	// Keyed by browser + host so two browsers reporting the same tool stay
	// distinguishable in the console.
	totals := map[string]*agg{}
	browserOf := map[string]string{}
	hostOf := map[string]string{}

	scanned := 0
	denied := 0
	readOK := 0

	for _, profile := range profiles {
		rows, err := readProfile(profile, since)
		if err != nil {
			if os.IsPermission(err) {
				denied++
			}
			continue
		}
		readOK++
		for _, row := range rows {
			scanned++
			host, ok := m.MatchHost(row.url)
			if !ok {
				continue
			}
			key := profile.browser + "\x1f" + host
			entry := totals[key]
			if entry == nil {
				entry = &agg{firstSeen: row.at, lastSeen: row.at}
				totals[key] = entry
				browserOf[key] = profile.browser
				hostOf[key] = host
			}
			entry.visits += row.count
			if row.at.Before(entry.firstSeen) {
				entry.firstSeen = row.at
			}
			if row.at.After(entry.lastSeen) {
				entry.lastSeen = row.at
			}
		}
	}

	if readOK == 0 {
		if denied > 0 {
			// The common macOS case: Safari's History.db needs Full Disk
			// Access, which MDM can grant with a PPPC profile.
			return nil, FailStatus("no_access")
		}
		return nil, FailStatus("unreadable")
	}

	out := make([]BrowserVisit, 0, len(totals))
	for key, entry := range totals {
		out = append(out, BrowserVisit{
			Domain:    hostOf[key],
			Browser:   browserOf[key],
			Visits:    entry.visits,
			FirstSeen: entry.firstSeen.UTC(),
			LastSeen:  entry.lastSeen.UTC(),
		})
	}
	status := OKStatus(scanned)
	if denied > 0 {
		// Partial success: some profiles read, at least one refused. Say so,
		// rather than let the console read a partial picture as a full one.
		status.Reason = "partial_no_access"
	}
	return out, status
}

type historyRow struct {
	url   string
	at    time.Time
	count int
}

// discoverBrowserProfiles finds every browser profile for the current user.
func discoverBrowserProfiles() []browserProfile {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}

	var roots []struct {
		browser string
		glob    string
		kind    string
	}

	if runtime.GOOS == "windows" {
		local := os.Getenv("LOCALAPPDATA")
		roaming := os.Getenv("APPDATA")
		roots = append(roots,
			entry("chrome", filepath.Join(local, "Google", "Chrome", "User Data", "*", "History"), "chromium"),
			entry("edge", filepath.Join(local, "Microsoft", "Edge", "User Data", "*", "History"), "chromium"),
			entry("brave", filepath.Join(local, "BraveSoftware", "Brave-Browser", "User Data", "*", "History"), "chromium"),
			entry("vivaldi", filepath.Join(local, "Vivaldi", "User Data", "*", "History"), "chromium"),
			entry("opera", filepath.Join(roaming, "Opera Software", "Opera Stable", "History"), "chromium"),
			entry("firefox", filepath.Join(roaming, "Mozilla", "Firefox", "Profiles", "*", "places.sqlite"), "firefox"),
		)
	} else {
		support := filepath.Join(home, "Library", "Application Support")
		roots = append(roots,
			entry("chrome", filepath.Join(support, "Google", "Chrome", "*", "History"), "chromium"),
			entry("edge", filepath.Join(support, "Microsoft Edge", "*", "History"), "chromium"),
			entry("brave", filepath.Join(support, "BraveSoftware", "Brave-Browser", "*", "History"), "chromium"),
			entry("arc", filepath.Join(support, "Arc", "User Data", "*", "History"), "chromium"),
			entry("vivaldi", filepath.Join(support, "Vivaldi", "*", "History"), "chromium"),
			entry("firefox", filepath.Join(support, "Firefox", "Profiles", "*", "places.sqlite"), "firefox"),
			entry("safari", filepath.Join(home, "Library", "Safari", "History.db"), "safari"),
		)
	}

	var profiles []browserProfile
	for _, root := range roots {
		matches, err := filepath.Glob(root.glob)
		if err != nil {
			continue
		}
		for _, match := range matches {
			// Chrome's "User Data" root holds non-profile dirs that also
			// contain a History file in some versions; a stat is enough to
			// skip anything that is not a regular file.
			if info, err := os.Stat(match); err != nil || info.IsDir() {
				continue
			}
			profiles = append(profiles, browserProfile{
				browser: root.browser,
				path:    match,
				kind:    root.kind,
			})
		}
	}
	return profiles
}

func entry(browser, glob, kind string) struct {
	browser string
	glob    string
	kind    string
} {
	return struct {
		browser string
		glob    string
		kind    string
	}{browser, glob, kind}
}

// readProfile snapshots one profile and extracts visits newer than `since`.
func readProfile(profile browserProfile, since time.Time) ([]historyRow, error) {
	tmpDir, err := os.MkdirTemp("", "urnammu-hist-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmpDir)

	snapshot := filepath.Join(tmpDir, filepath.Base(profile.path))
	if err := copyFile(profile.path, snapshot); err != nil {
		return nil, err
	}
	// Sidecars are best-effort: a cleanly closed database has none, and their
	// absence is not an error. Their *presence* is what carries recent visits.
	for _, suffix := range []string{"-wal", "-shm"} {
		_ = copyFile(profile.path+suffix, snapshot+suffix)
	}

	db, err := sql.Open("sqlite", "file:"+snapshot+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query, args := historyQuery(profile.kind, since)
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []historyRow
	for rows.Next() {
		var rawURL string
		var rawTime int64
		var count int
		if err := rows.Scan(&rawURL, &rawTime, &count); err != nil {
			continue
		}
		if count < 1 {
			count = 1
		}
		out = append(out, historyRow{
			url:   rawURL,
			at:    decodeTimestamp(profile.kind, rawTime),
			count: count,
		})
	}
	return out, rows.Err()
}

// historyQuery returns the per-schema query. Each yields (url, time, count).
//
// The `since` bound is applied in SQL so a laptop with a decade of history
// does not stream every row through the process.
func historyQuery(kind string, since time.Time) (string, []interface{}) {
	switch kind {
	case "firefox":
		// Firefox stores microseconds since the Unix epoch.
		return `SELECT url, last_visit_date, visit_count
		        FROM moz_places
		        WHERE last_visit_date IS NOT NULL AND last_visit_date > ?`,
			[]interface{}{since.UnixMicro()}
	case "safari":
		// Safari stores seconds since 2001-01-01 (Core Data epoch), and keeps
		// visits in a separate table.
		return `SELECT i.url, MAX(v.visit_time), COUNT(*)
		        FROM history_items i
		        JOIN history_visits v ON v.history_item = i.id
		        WHERE v.visit_time > ?
		        GROUP BY i.id`,
			[]interface{}{float64(since.Unix() - cocoaEpochOffset)}
	default:
		// Chromium stores microseconds since 1601-01-01 (the Windows epoch).
		return `SELECT url, last_visit_time, visit_count
		        FROM urls
		        WHERE last_visit_time > ?`,
			[]interface{}{(since.Unix() + windowsEpochOffset) * 1_000_000}
	}
}

const (
	// Seconds between 1601-01-01 and 1970-01-01.
	windowsEpochOffset = 11644473600
	// Seconds between 1970-01-01 and 2001-01-01.
	cocoaEpochOffset = 978307200
)

func decodeTimestamp(kind string, raw int64) time.Time {
	switch kind {
	case "firefox":
		return time.UnixMicro(raw)
	case "safari":
		return time.Unix(raw+cocoaEpochOffset, 0)
	default:
		return time.Unix(raw/1_000_000-windowsEpochOffset, 0)
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	info, err := in.Stat()
	if err != nil {
		return err
	}
	// A history database on a well-used machine is tens of megabytes; a
	// hundreds-of-megabytes file is not one, and copying it would be a
	// self-inflicted disk and memory problem on a user's laptop.
	const maxHistoryBytes = 512 << 20
	if info.Size() > maxHistoryBytes {
		return fmt.Errorf("history database too large: %d bytes", info.Size())
	}

	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

// BrowserLabel maps an internal browser id to something presentable.
func BrowserLabel(id string) string {
	switch id {
	case "chrome":
		return "Google Chrome"
	case "edge":
		return "Microsoft Edge"
	case "brave":
		return "Brave"
	case "arc":
		return "Arc"
	case "firefox":
		return "Firefox"
	case "safari":
		return "Safari"
	case "vivaldi":
		return "Vivaldi"
	case "opera":
		return "Opera"
	default:
		return strings.ToUpper(id[:1]) + id[1:]
	}
}
