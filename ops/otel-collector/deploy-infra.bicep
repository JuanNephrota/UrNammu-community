// Azure Container App: OTel Collector gateway for Claude Code telemetry.
//
// Infra-only template — secret VALUES are managed separately via
// rotate-secrets.sh. Redeploying this file (config changes, image bump,
// scaling) does NOT require re-passing the bearer tokens.
//
// Resources:
//   Log Analytics Workspace  (required host for Container Apps Environment)
//   Container Apps Environment
//   Container App            (otel/opentelemetry-collector-contrib)
//
// ─── Deploy flows ─────────────────────────────────────────────────────
//
// FIRST DEPLOY (one-time bootstrap):
//   INGEST=$(openssl rand -hex 32)
//   FORWARD=$(openssl rand -hex 32)   # must match CLAUDE_CODE_TELEMETRY_SECRET on UrNammu
//   az deployment group create \
//     --resource-group certifid-ai-governance \
//     --template-file deploy-infra.bicep \
//     --parameters \
//         isFirstDeploy=true \
//         ingestBearerToken="$INGEST" \
//         forwardBearerToken="$FORWARD" \
//         urnammuTelemetryUrl='https://nammu.certifid.com/api/telemetry/claude-code'
//
// REDEPLOY (any subsequent change — config, image, scaling, etc.):
//   az deployment group create \
//     --resource-group certifid-ai-governance \
//     --template-file deploy-infra.bicep \
//     --parameters urnammuTelemetryUrl='https://nammu.certifid.com/api/telemetry/claude-code'
//
//   → existing secret values are read via listSecrets() and preserved.
//   → No need to know the current bearer tokens.
//
// ROTATE SECRETS (no Bicep involvement needed):
//   ./rotate-secrets.sh rotate-ingest     # or rotate-forward / rotate-all

@description('Azure region for all resources. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Name prefix used for all resources. Keep short — ACA names have tight limits.')
param namePrefix string = 'cc-otel'

@description('Set to true ONLY on the first-ever deploy (when the Container App does not yet exist). Redeploys must leave this false — the template will then read existing secret values via listSecrets() and preserve them.')
param isFirstDeploy bool = false

@description('First-time bootstrap only. Required when isFirstDeploy=true; ignored otherwise.')
@secure()
param ingestBearerToken string = ''

@description('First-time bootstrap only. Required when isFirstDeploy=true; ignored otherwise. Must match CLAUDE_CODE_TELEMETRY_SECRET on UrNammu.')
@secure()
param forwardBearerToken string = ''

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

// Reference the existing Container App on redeploys to pull current secret
// values. Gated behind !isFirstDeploy so the `existing` reference is never
// evaluated on the first-ever deploy (when the resource doesn't exist yet).
resource existingApp 'Microsoft.App/containerApps@2024-03-01' existing = if (!isFirstDeploy) {
  name: '${namePrefix}-app'
}

// Short-circuit on the bootstrap flag so listSecrets() is only called when
// we know the resource exists. On first deploy we use the @secure params.
var bootstrapSecrets = [
  {
    name: 'ingest-bearer-token'
    value: ingestBearerToken
  }
  {
    name: 'forward-bearer-token'
    value: forwardBearerToken
  }
]

var secretsToApply = isFirstDeploy ? bootstrapSecrets : existingApp.listSecrets().value

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
      secrets: secretsToApply
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
