// Package api is the agent's HTTP client for the UrNammu endpoint-agent API.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/certifid/urnammu-endpoint-agent/internal/collect"
)

// ErrRevoked means the console has revoked this device. It is terminal: the
// agent stops collecting and does not try to re-enroll, because re-enrolling
// a revoked machine is refused by design.
var ErrRevoked = errors.New("device revoked")

// ErrUnauthorized means the device token was rejected. Recoverable by
// re-enrolling — the usual cause is a console-side re-issue.
var ErrUnauthorized = errors.New("unauthorized")

// ErrNotModified means the manifest is unchanged since the cached version.
var ErrNotModified = errors.New("manifest not modified")

// Client talks to one UrNammu console.
type Client struct {
	baseURL string
	http    *http.Client
	version string
}

// New builds a client. The timeout is generous because a laptop flushing a
// spooled backlog over a hotel network is the normal bad case.
func New(baseURL, agentVersion string) *Client {
	return &Client{
		baseURL: baseURL,
		version: agentVersion,
		http: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// EnrollRequest is the body of POST /api/endpoint-agent/enroll.
type EnrollRequest struct {
	MachineID    string `json:"machineId"`
	Hostname     string `json:"hostname"`
	Platform     string `json:"platform"`
	OSVersion    string `json:"osVersion,omitempty"`
	Arch         string `json:"arch,omitempty"`
	AgentVersion string `json:"agentVersion,omitempty"`
	UserEmail    string `json:"userEmail,omitempty"`
	UserName     string `json:"userName,omitempty"`
}

// EnrollResponse carries the per-device token, returned exactly once.
type EnrollResponse struct {
	DeviceID   string `json:"deviceId"`
	Token      string `json:"token"`
	ReEnrolled bool   `json:"reEnrolled"`
}

// Enroll trades the org enrollment secret for a per-device token.
func (c *Client) Enroll(ctx context.Context, secret string, req EnrollRequest) (*EnrollResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/api/endpoint-agent/enroll", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+secret)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("User-Agent", c.userAgent())

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer drainAndClose(resp)

	switch resp.StatusCode {
	case http.StatusOK, http.StatusCreated:
		out := &EnrollResponse{}
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return nil, err
		}
		if out.Token == "" {
			return nil, errors.New("enrollment response contained no token")
		}
		return out, nil
	case http.StatusForbidden:
		return nil, ErrRevoked
	case http.StatusUnauthorized:
		return nil, ErrUnauthorized
	default:
		return nil, fmt.Errorf("enrollment failed: %s", resp.Status)
	}
}

// Manifest fetches the detection filter, conditionally on the cached version.
func (c *Client) Manifest(ctx context.Context, token, knownVersion string) (*collect.Manifest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.baseURL+"/api/endpoint-agent/manifest", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", c.userAgent())
	if knownVersion != "" {
		req.Header.Set("If-None-Match", `"`+knownVersion+`"`)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer drainAndClose(resp)

	switch resp.StatusCode {
	case http.StatusNotModified:
		return nil, ErrNotModified
	case http.StatusOK:
		manifest := &collect.Manifest{}
		if err := json.NewDecoder(resp.Body).Decode(manifest); err != nil {
			return nil, err
		}
		return manifest, nil
	case http.StatusUnauthorized:
		return nil, ErrUnauthorized
	default:
		return nil, fmt.Errorf("manifest fetch failed: %s", resp.Status)
	}
}

// SendReport posts one collection cycle.
//
// The error returned decides whether the caller keeps the report spooled. A
// 4xx other than 401 is permanent — the server will never accept this body, so
// retrying it forever would block everything queued behind it.
func (c *Client) SendReport(ctx context.Context, token string, report *collect.Report) error {
	body, err := json.Marshal(report)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/api/endpoint-agent/report", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", c.userAgent())

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer drainAndClose(resp)

	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	case resp.StatusCode == http.StatusUnauthorized:
		return ErrUnauthorized
	case resp.StatusCode == http.StatusForbidden:
		return ErrRevoked
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		return &PermanentError{Status: resp.StatusCode}
	default:
		return fmt.Errorf("report rejected: %s", resp.Status)
	}
}

// PermanentError marks a response the server will never accept on retry.
type PermanentError struct {
	Status int
}

func (e *PermanentError) Error() string {
	return fmt.Sprintf("permanent rejection: HTTP %d", e.Status)
}

func (c *Client) userAgent() string {
	return "urnammu-endpoint-agent/" + c.version
}

// drainAndClose lets the connection be reused instead of torn down.
func drainAndClose(resp *http.Response) {
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	_ = resp.Body.Close()
}
