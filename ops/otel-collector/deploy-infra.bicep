// Azure Container App: OTel Collector gateway for Claude Code telemetry.
//
// Deploy this template via the `deploy-infra.sh` wrapper, which reads
// existing secret values from ACA (via `az containerapp secret show`) and
// passes them as parameters, so you don't have to re-type the bearer
// tokens on every redeploy. You CAN call Bicep directly if you want —
// you'll just need to pass both @secure params explicitly.
//
// Why a wrapper: Bicep does not support calling listSecrets() on a
// resource it is also declaring in the same template (circular
// dependency — BCP422). The wrapper moves the "read existing secrets"
// step out of Bicep into plain `az` calls that run first.
//
// Resources:
//   Log Analytics Workspace  (required host for Container Apps Environment)
//   Container Apps Environment
//   Container App            (otel/opentelemetry-collector-contrib)
//
// ─── Usage ──────────────────────────────────────────────────────────
//
// Any deploy (first or subsequent):
//   ./deploy-infra.sh
//
// Rotate tokens (no Bicep involvement):
//   ./rotate-secrets.sh rotate-ingest | rotate-forward | rotate-all

@description('Azure region for all resources. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Name prefix used for all resources. Keep short — ACA names have tight limits.')
param namePrefix string = 'cc-otel'

@description('Bearer token Claude Code clients present to the Collector. Normally supplied by the deploy-infra.sh wrapper, which reads the existing value from ACA. Only set directly if you are bootstrapping outside the wrapper.')
@secure()
param ingestBearerToken string

@description('Bearer token the Collector presents to UrNammu. Must match the claude_code_telemetry_secret AppSetting (or CLAUDE_CODE_TELEMETRY_SECRET env) on UrNammu.')
@secure()
param forwardBearerToken string

@description('Bearer token the Collector presents to UrNammu for the CURSOR endpoints. Must match the cursor_telemetry_secret AppSetting (or CURSOR_TELEMETRY_SECRET env) on UrNammu. Rotated independently of forwardBearerToken.')
@secure()
param cursorForwardBearerToken string

@description('Vercel Protection Bypass for Automation secret. UrNammu is behind Vercel Deployment Protection (SSO), which 401s machine-to-machine calls at the edge. The Collector sends this as the x-vercel-protection-bypass header so its forwards reach the route handler. Find/rotate it in Vercel → Project → Settings → Deployment Protection → Protection Bypass for Automation.')
@secure()
param vercelProtectionBypass string

@description('Absolute URL of the UrNammu metrics ingestion endpoint, e.g. https://nammu.certifid.com/api/telemetry/claude-code')
param urnammuTelemetryUrl string

@description('Absolute URL of the UrNammu events (logs) ingestion endpoint, e.g. https://nammu.certifid.com/api/telemetry/claude-code-events')
param urnammuEventsUrl string

@description('Absolute URL of the UrNammu Cursor metrics endpoint, e.g. https://nammu.certifid.com/api/telemetry/cursor')
param urnammuCursorMetricsUrl string

@description('Absolute URL of the UrNammu Cursor traces (spans) endpoint, e.g. https://nammu.certifid.com/api/telemetry/cursor-traces')
param urnammuCursorTracesUrl string

@description('Pinned collector image. Bump deliberately. Verify tag exists at https://hub.docker.com/r/otel/opentelemetry-collector-contrib/tags before changing.')
param collectorImage string = 'otel/opentelemetry-collector-contrib:0.150.1'

@description('Min replicas. 1 = always warm (recommended — OTLP exporter timeout is shorter than ACA cold-start). 0 = scale-to-zero, which causes silent export failures when the container is idle.')
@minValue(0)
@maxValue(5)
param minReplicas int = 1

@description('Max replicas for HTTP scale rule.')
@minValue(1)
@maxValue(10)
param maxReplicas int = 3

var collectorConfig = '''
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        auth:
          authenticator: bearertokenauth

extensions:
  bearertokenauth:
    scheme: Bearer
    token: $${env:INGEST_BEARER_TOKEN}
  health_check:
    endpoint: 0.0.0.0:13133

processors:
  memory_limiter:
    check_interval: 2s
    limit_mib: 400
    spike_limit_mib: 100
  filter/claude_code_only:
    metrics:
      include:
        match_type: regexp
        # NOTE: Bicep multi-line strings and YAML single-quotes BOTH pass
        # backslashes through literally, so a double backslash here reaches
        # the regex engine as a literal-backslash matcher and drops every
        # real metric (claude_code.session.count has no backslash). Use a
        # single backslash so the engine sees an escaped dot.
        metric_names:
          - '^claude_code\..*'
  resource:
    attributes:
      - key: telemetry.sdk.name
        action: delete
      - key: telemetry.sdk.language
        action: delete
      - key: telemetry.sdk.version
        action: delete
      - key: service.name
        action: delete
  # Gateway content scrub for the events/logs pipeline. Deletes code- and
  # secret-bearing attributes so that even if a developer locally enables
  # OTEL_LOG_TOOL_DETAILS=1 or OTEL_LOG_RAW_API_BODIES, that content is
  # dropped here before it reaches UrNammu.
  #
  # NOTE: `prompt` is intentionally NOT stripped here. UrNammu's events
  # route analyzes user-prompt text in-memory for dangerous-prompt
  # detection (Option A) and persists only the verdict + a sanitized
  # excerpt on the alert — the raw prompt is never stored. Prompt text is
  # only emitted at all when OTEL_LOG_USER_PROMPTS=1 (set in
  # managed-settings.json); set it to 0 to disable prompt-risk on Claude
  # Code and keep prompts off the wire entirely.
  attributes/strip_log_content:
    actions:
      - key: tool_input
        action: delete
      - key: tool_parameters
        action: delete
      - key: error
        action: delete
      - key: body
        action: delete
  # Keep only Cursor spans on the Cursor pipelines. The hook sets
  # service.name=cursor-agent; drop anything else (e.g. Claude Code enhanced
  # traces, should that beta ever be enabled, report service.name=claude-code).
  filter/cursor_only:
    error_mode: ignore
    traces:
      span:
        - 'resource.attributes["service.name"] != "cursor-agent"'
  # Gateway content scrub for Cursor spans. Deletes code-, tool-arg-, and
  # completion-bearing attributes so source code never reaches UrNammu.
  #
  # NOTE: gen_ai.prompt / prompt are intentionally NOT stripped here — they
  # carry beforeSubmitPrompt user text, which UrNammu analyzes in-memory for
  # dangerous-prompt detection (Option A) and never stores (only the verdict
  # + a sanitized excerpt on the alert persist). To keep prompts entirely off
  # the wire, stop the hook from emitting them (or add `prompt` here).
  attributes/strip_cursor_content:
    actions:
      - key: gen_ai.tool.arguments
        action: delete
      - key: gen_ai.completion
        action: delete
      - key: gen_ai.content
        action: delete
      - key: tool_arguments
        action: delete
      - key: completion
        action: delete
      - key: input
        action: delete
      - key: output
        action: delete
      - key: body
        action: delete
  batch:
    timeout: 10s
    send_batch_size: 1000
    send_batch_max_size: 1500

# Derives activity metrics from the Cursor span stream. With namespace
# `cursor`, emits cursor.calls (Sum) + cursor.duration (Histogram), dimensioned
# by the attributes below. Cursor's hook carries no tokens/cost, so this is the
# only "metrics" surface available for Cursor.
connectors:
  spanmetrics:
    namespace: cursor
    histogram:
      explicit:
        buckets: [10ms, 100ms, 250ms, 500ms, 1s, 2s, 5s, 10s, 30s]
    dimensions:
      - name: gen_ai.tool.name
      - name: langsmith.span.kind
      - name: langsmith.metadata.hook_event
      - name: langsmith.trace.session_id
      - name: gen_ai.request.model
    # Keep series resettable so UrNammu sees per-window deltas.
    metrics_flush_interval: 30s

exporters:
  otlp_http/urnammu:
    metrics_endpoint: $${env:URNAMMU_TELEMETRY_URL}
    logs_endpoint: $${env:URNAMMU_EVENTS_URL}
    encoding: json
    # MUST stay 'none'. UrNammu's /api/telemetry/claude-code reads the body
    # with req.json(), which does NOT decompress a gzip-encoded request body
    # — a gzip body parses as invalid JSON (400) and the batch is silently
    # dropped. Telemetry volume is low (batch ≤1000 points), so the bandwidth
    # cost of uncompressed is negligible. If you want gzip back, first make
    # the route decompress Content-Encoding: gzip before req.json().
    compression: none
    headers:
      Authorization: "Bearer $${env:FORWARD_BEARER_TOKEN}"
      x-vercel-protection-bypass: $${env:VERCEL_PROTECTION_BYPASS}
    retry_on_failure:
      enabled: true
      initial_interval: 5s
      max_interval: 30s
      max_elapsed_time: 5m
    sending_queue:
      enabled: true
      num_consumers: 4
      queue_size: 5000
  # Cursor raw spans → UrNammu /api/telemetry/cursor-traces (CursorSpan).
  otlp_http/urnammu_cursor_traces:
    traces_endpoint: $${env:URNAMMU_CURSOR_TRACES_URL}
    encoding: json
    compression: none
    headers:
      Authorization: "Bearer $${env:CURSOR_FORWARD_BEARER_TOKEN}"
      x-vercel-protection-bypass: $${env:VERCEL_PROTECTION_BYPASS}
    retry_on_failure:
      enabled: true
      initial_interval: 5s
      max_interval: 30s
      max_elapsed_time: 5m
    sending_queue:
      enabled: true
      num_consumers: 4
      queue_size: 5000
  # Derived cursor.* metrics → UrNammu /api/telemetry/cursor (CursorMetric).
  otlp_http/urnammu_cursor_metrics:
    metrics_endpoint: $${env:URNAMMU_CURSOR_METRICS_URL}
    encoding: json
    compression: none
    headers:
      Authorization: "Bearer $${env:CURSOR_FORWARD_BEARER_TOKEN}"
      x-vercel-protection-bypass: $${env:VERCEL_PROTECTION_BYPASS}
    retry_on_failure:
      enabled: true
      initial_interval: 5s
      max_interval: 30s
      max_elapsed_time: 5m
    sending_queue:
      enabled: true
      num_consumers: 4
      queue_size: 5000

service:
  extensions: [bearertokenauth, health_check]
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, filter/claude_code_only, resource, batch]
      exporters: [otlp_http/urnammu]
    # Cursor spans: forward raw to UrNammu AND fan into the spanmetrics
    # connector. filter/cursor_only keeps non-Cursor spans out; the `resource`
    # processor is deliberately NOT run here (it deletes service.name, which we
    # need to tag Cursor). strip_cursor_content drops code/tool-arg content.
    traces/cursor:
      receivers: [otlp]
      processors: [memory_limiter, filter/cursor_only, attributes/strip_cursor_content, batch]
      exporters: [otlp_http/urnammu_cursor_traces, spanmetrics]
    # spanmetrics connector emits cursor.* metrics consumed here.
    metrics/cursor:
      receivers: [spanmetrics]
      processors: [memory_limiter, batch]
      exporters: [otlp_http/urnammu_cursor_metrics]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, attributes/strip_log_content, batch]
      exporters: [otlp_http/urnammu]
  telemetry:
    logs:
      level: info
'''

resource logs 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource managedEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-app'
  location: location
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 4318
        transport: 'http'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      secrets: [
        {
          name: 'ingest-bearer-token'
          value: ingestBearerToken
        }
        {
          name: 'forward-bearer-token'
          value: forwardBearerToken
        }
        {
          name: 'cursor-forward-bearer-token'
          value: cursorForwardBearerToken
        }
        {
          name: 'vercel-protection-bypass'
          value: vercelProtectionBypass
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'otel-collector'
          image: collectorImage
          args: [
            '--config=env:OTEL_CONFIG'
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'OTEL_CONFIG'
              value: collectorConfig
            }
            {
              name: 'INGEST_BEARER_TOKEN'
              secretRef: 'ingest-bearer-token'
            }
            {
              name: 'FORWARD_BEARER_TOKEN'
              secretRef: 'forward-bearer-token'
            }
            {
              name: 'URNAMMU_TELEMETRY_URL'
              value: urnammuTelemetryUrl
            }
            {
              name: 'URNAMMU_EVENTS_URL'
              value: urnammuEventsUrl
            }
            {
              name: 'URNAMMU_CURSOR_METRICS_URL'
              value: urnammuCursorMetricsUrl
            }
            {
              name: 'URNAMMU_CURSOR_TRACES_URL'
              value: urnammuCursorTracesUrl
            }
            {
              name: 'CURSOR_FORWARD_BEARER_TOKEN'
              secretRef: 'cursor-forward-bearer-token'
            }
            {
              name: 'VERCEL_PROTECTION_BYPASS'
              secretRef: 'vercel-protection-bypass'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/'
                port: 13133
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

output ingestEndpoint string = 'https://${app.properties.configuration.ingress.fqdn}'
output containerAppName string = app.name
