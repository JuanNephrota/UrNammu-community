VERSION ?= 0.1.0
LDFLAGS := -s -w -X main.version=$(VERSION)
DIST := dist

.PHONY: all build clean test vet fmt darwin windows universal

all: darwin windows

# Both macOS architectures, then a universal binary so one payload covers
# Apple Silicon and the remaining Intel machines.
darwin: $(DIST)/urnammu-agent-darwin-universal

$(DIST)/urnammu-agent-darwin-arm64:
	@mkdir -p $(DIST)
	GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $@ ./cmd/urnammu-agent

$(DIST)/urnammu-agent-darwin-amd64:
	@mkdir -p $(DIST)
	GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $@ ./cmd/urnammu-agent

$(DIST)/urnammu-agent-darwin-universal: $(DIST)/urnammu-agent-darwin-arm64 $(DIST)/urnammu-agent-darwin-amd64
	lipo -create -output $@ $^
	@echo "built $@"

windows: $(DIST)/urnammu-agent-windows-amd64.exe

$(DIST)/urnammu-agent-windows-amd64.exe:
	@mkdir -p $(DIST)
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $@ ./cmd/urnammu-agent
	@echo "built $@"

# Local build for the host platform, for development.
build:
	go build -ldflags "$(LDFLAGS)" -o urnammu-agent ./cmd/urnammu-agent

test:
	go test ./...

vet:
	go vet ./...

fmt:
	gofmt -l -w .

clean:
	rm -rf $(DIST) urnammu-agent

# ─── Signing ────────────────────────────────────────────
# Unsigned binaries are Gatekeeper-blocked on macOS and SmartScreen-flagged on
# Windows, so neither MDM push works without these. Both need real certs:
#   DEVELOPER_ID   e.g. "Developer ID Application: CertifID LLC (TEAMID)"
#   NOTARY_PROFILE a notarytool keychain profile
.PHONY: sign-darwin notarize-darwin

sign-darwin: $(DIST)/urnammu-agent-darwin-universal
	@test -n "$(DEVELOPER_ID)" || (echo "DEVELOPER_ID is required" && exit 1)
	codesign --force --options runtime --timestamp \
		--sign "$(DEVELOPER_ID)" $(DIST)/urnammu-agent-darwin-universal
	codesign --verify --strict --verbose=2 $(DIST)/urnammu-agent-darwin-universal

notarize-darwin: sign-darwin
	@test -n "$(NOTARY_PROFILE)" || (echo "NOTARY_PROFILE is required" && exit 1)
	cd $(DIST) && zip -q urnammu-agent.zip urnammu-agent-darwin-universal
	xcrun notarytool submit $(DIST)/urnammu-agent.zip \
		--keychain-profile "$(NOTARY_PROFILE)" --wait
	@echo "notarized — a bare binary cannot be stapled; ship it inside the pkg"
