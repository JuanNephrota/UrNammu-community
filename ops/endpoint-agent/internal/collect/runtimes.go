package collect

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

// Local inference runtime detection.
//
// This is the signal no other UrNammu source can produce. A model served from
// 127.0.0.1 never touches the proxy, never appears in a vendor admin API, and
// never resolves a domain the DNS logs could catch. From the network's point
// of view nothing happened at all.
//
// Detection is a TCP connect to a loopback port followed by one HTTP GET of
// the runtime's own model-listing endpoint. Nothing is sent to the model, no
// inference is requested, and only model *names* are read from the response.

const (
	probeDialTimeout = 300 * time.Millisecond
	probeHTTPTimeout = 2 * time.Second
)

// CollectRuntimes probes each runtime in the manifest and returns the ones
// that answered.
func CollectRuntimes(ctx context.Context, manifest Manifest) ([]Runtime, Status) {
	now := time.Now().UTC()
	var out []Runtime
	probed := 0

	for _, runtime := range manifest.Runtimes {
		for _, port := range runtime.Ports {
			probed++
			if !portOpen(ctx, port) {
				continue
			}

			// An open port is necessary but nowhere near sufficient. These are
			// ordinary high ports and plenty of non-AI software sits on them —
			// macOS runs the AirPlay Receiver on 5000, and a local dev server
			// on 8080 is the default state of a developer's laptop. Reporting
			// on the TCP connect alone raised a HIGH-severity "ungoverned local
			// model" alert for every Mac in the fleet during testing.
			//
			// So the service has to answer as a model server: a 200 on the
			// runtime's own model-listing path, parsing to a model list. A real
			// runtime with zero models pulled still answers with an empty list,
			// which is a valid response and counts.
			models, ok := fetchModels(ctx, port, runtime.ModelsPath)
			if !ok {
				continue
			}
			if models == nil {
				models = []string{}
			}

			out = append(out, Runtime{
				Runtime:   runtime.ID,
				Port:      port,
				Models:    models,
				FirstSeen: now,
				LastSeen:  now,
			})
			// One hit per runtime is enough — a second port answering the same
			// runtime is the same installation, not a second one.
			break
		}
	}

	return out, OKStatus(probed)
}

// portOpen is a plain TCP connect to loopback. Deliberately short: this runs
// on a user's laptop every cycle and must never be something they can feel.
func portOpen(ctx context.Context, port int) bool {
	dialer := net.Dialer{Timeout: probeDialTimeout}
	dialCtx, cancel := context.WithTimeout(ctx, probeDialTimeout)
	defer cancel()

	conn, err := dialer.DialContext(dialCtx, "tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// fetchModels reads the locally available model names.
//
// The bool is the confirmation that whatever is on this port is a model
// server, and it is what gates the detection — see the caller. It is true only
// when the endpoint returned 200 and a body that parses as one of the known
// model-list shapes.
func fetchModels(ctx context.Context, port int, path string) ([]string, bool) {
	if path == "" {
		// Presence-only runtime: the manifest is asserting that this port is
		// diagnostic on its own.
		return nil, true
	}

	reqCtx, cancel := context.WithTimeout(ctx, probeHTTPTimeout)
	defer cancel()

	url := fmt.Sprintf("http://127.0.0.1:%d%s", port, path)
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return nil, false
	}

	client := &http.Client{Timeout: probeHTTPTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, false
	}

	// A misidentified port could be any service at all, so the read is capped
	// rather than trusting the peer to be the runtime we expected.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, false
	}

	// Two shapes cover every runtime in the manifest:
	//   Ollama:            {"models":[{"name":"llama3:8b"}, ...]}
	//   OpenAI-compatible: {"data":[{"id":"..."}, ...]}
	var parsed struct {
		Models *[]struct {
			Name  string `json:"name"`
			Model string `json:"model"`
		} `json:"models"`
		Data *[]struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, false
	}

	// Both fields are pointers so their *absence* is distinguishable from an
	// empty list. Without this, any service returning a JSON object at all —
	// `{"status":"ok"}` from an unrelated dev server on 8080 — would unmarshal
	// without error and be reported as a local model runtime.
	if parsed.Models == nil && parsed.Data == nil {
		return nil, false
	}

	seen := map[string]struct{}{}
	var names []string
	add := func(name string) {
		if name == "" || len(names) >= 200 {
			return
		}
		if _, dup := seen[name]; dup {
			return
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}
	if parsed.Models != nil {
		for _, m := range *parsed.Models {
			if m.Name != "" {
				add(m.Name)
			} else {
				add(m.Model)
			}
		}
	}
	if parsed.Data != nil {
		for _, d := range *parsed.Data {
			add(d.ID)
		}
	}
	return names, true
}
