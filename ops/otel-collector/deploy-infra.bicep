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

@description('Absolute URL of the UrNammu ingestion endpoint, e.g. https://nammu.certifid.com/api/telemetry/claude-code')
param urnammuTelemetryUrl string

@description('Pinned collector image. Bump deliberately. Verify tag exists at https://hub.docker.com/r/otel/opentelemetry-collector-contrib/tags before changing.')
param collectorImage string = 'otel/opentelemetry-collector-contrib:0.150.1'

@description('Min replicas. 0 = scale-to-zero; cold starts ~5–10s on first request.')
@minValue(0)
@maxValue(5)
param minReplicas int = 0

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
      grpc:
        endpoint: 0.0.0.0:4317
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
        metric_names:
          - '^claude_code\\..*'
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
  batch:
    timeout: 10s
    send_batch_size: 1000
    send_batch_max_size: 1500

exporters:
  otlp_http/urnammu:
    endpoint: $${env:URNAMMU_TELEMETRY_URL}
    encoding: json
    compression: gzip
    headers:
      Authorization: "Bearer $${env:FORWARD_BEARER_TOKEN}"
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
