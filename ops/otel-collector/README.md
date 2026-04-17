# Claude Code OTel Collector (Azure Container Apps)

A single-tenant OpenTelemetry Collector gateway that accepts OTLP/HTTP metrics
from Claude Code clients across the CertifID dev org, filters to
`claude_code.*` metrics, and forwards them to UrNammu's
`/api/telemetry/claude-code` ingestion endpoint. Rows land in the
`ClaudeCodeMetric` table and surface in the "Live telemetry" panel on
Oversight → Claude Code.

Complementary to — not replacing — the daily Admin-API pull that fills
`UsageBucket(provider="claude_code")`.

## Architecture

```
Dev machines (Claude Code)
      │  OTLP/HTTP  (Authorization: Bearer <INGEST_TOKEN>)
      ▼
ACA: otel/opentelemetry-collector-contrib
      │  memory_limiter → filter/claude_code_only → resource → batch
      │  otlphttp/urnammu  (Authorization: Bearer <FORWARD_TOKEN>)
      ▼
UrNammu  POST /api/telemetry/claude-code   (Vercel)
      ▼
Vercel Postgres  (ClaudeCodeMetric)
```

- **Metrics-only.** The filter processor drops anything not named
  `claude_code.*`, and no logs pipeline is configured — so if a client
  enables the logs exporter locally, events/prompts are dropped at the
  gateway.
- **Two tokens.** `INGEST_BEARER_TOKEN` faces developers; rotate freely.
  `FORWARD_BEARER_TOKEN` is the collector-to-UrNammu server-to-server
  token; it must match UrNammu's `claude_code_telemetry_secret` setting.

## Deploy

Prereqs: Bicep CLI (`az bicep install`), an Azure subscription, and the
`certifid-ai-governance` resource group (or change it below).

```bash
# Pick two fresh tokens (any high-entropy string)
INGEST=$(openssl rand -hex 32)
FORWARD=$(openssl rand -hex 32)

# Store FORWARD on UrNammu first — either as a Vercel env var
#   vercel env add CLAUDE_CODE_TELEMETRY_SECRET production
# or via Settings in the app (writes to AppSetting).

az deployment group create \
  --resource-group certifid-ai-governance \
  --template-file ops/otel-collector/deploy.bicep \
  --parameters \
      ingestBearerToken="$INGEST" \
      forwardBearerToken="$FORWARD" \
      urnammuTelemetryUrl="https://<your-urnammu>.vercel.app/api/telemetry/claude-code"

# Grab the collector URL from the deployment output
COLLECTOR_URL=$(az deployment group show \
  --resource-group certifid-ai-governance \
  --name deploy \
  --query properties.outputs.ingestEndpoint.value -o tsv)

echo "Collector: $COLLECTOR_URL"
echo "Hand devs the INGEST token: $INGEST"
```

Token rotation:

```bash
NEW=$(openssl rand -hex 32)
az containerapp secret set \
  --resource-group certifid-ai-governance \
  --name cc-otel-app \
  --secrets ingest-bearer-token=$NEW
az containerapp revision restart \
  --resource-group certifid-ai-governance \
  --name cc-otel-app
```

## Client setup (developer machines)

Drop this in your shell rc file. The **logs exporter is intentionally
unset** — metrics only.

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT="https://<collector-fqdn>"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <INGEST_TOKEN>"
export OTEL_METRIC_EXPORT_INTERVAL=60000
# Belt-and-braces: don't let events/prompts leave the machine
unset OTEL_LOGS_EXPORTER
export OTEL_LOG_USER_PROMPTS=0
```

## Smoke test

From any dev laptop after the env vars are set, run a single Claude Code
session; within ~60 s you should see:

1. Collector logs (Log Analytics) show `otlphttp/urnammu` exports.
2. UrNammu Oversight → Claude Code → **Live telemetry (last 60m)** populates.
3. `SELECT COUNT(*) FROM "ClaudeCodeMetric" WHERE "receivedAt" > NOW() - INTERVAL '5 min';`

## Retention

A daily Vercel cron (`/api/cron/prune-claude-code-metrics`, runs at 03:23)
deletes `ClaudeCodeMetric` rows older than the configured window. Default is
**30 days**. Override with the `claude_code_telemetry_retention_days`
AppSetting (or `CLAUDE_CODE_TELEMETRY_RETENTION_DAYS` env var). Set to `0`
to disable pruning entirely.

The job is guarded by `CRON_SECRET` (same as the other Vercel crons) and
operates on the OTel data-point `timestamp` column (client wall-clock) —
which is what the UI filters on — not `receivedAt`.

## Files

- `config.yaml` — reference copy of the Collector config (the deployed one
  is embedded inside `deploy.bicep` as a variable; keep them in sync).
- `deploy.bicep` — Azure Container Apps deployment (Log Analytics +
  Container Apps Env + Container App).
