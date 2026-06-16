# Hexnode -> Windows "Custom Script" (PowerShell, runs as SYSTEM) — enforces
# the Claude Code OTel telemetry config by writing the managed-settings.json
# that users cannot override from their personal settings.
#
# Deploy in Hexnode:
#   1. Admin Console -> Scripts -> Add Custom Script -> Platform: Windows,
#      Type: PowerShell.
#   2. Paste this script with the two placeholders below filled in.
#   3. Assign to your Windows device group / policy. Hexnode runs Windows
#      custom scripts as SYSTEM, so it can write to C:\ProgramData.
#   4. (Optional) schedule a periodic re-run for drift correction — the
#      script is idempotent and simply rewrites the file each run.
#
# SECURITY: the filled-in copy contains the ingest bearer token. Keep the
# real token in the Hexnode console copy only — this committed file uses
# placeholders. Rotate via ops/otel-collector/rotate-secrets.sh rotate-ingest
# and update the Hexnode script.

$ErrorActionPreference = "Stop"

# ── Fill these in the Hexnode console copy ───────────────────────────────
$CollectorFqdn = "__COLLECTOR_FQDN__"   # e.g. cc-otel-app.<region>.azurecontainerapps.io
$IngestToken   = "__INGEST_TOKEN__"
# ─────────────────────────────────────────────────────────────────────────

if ($CollectorFqdn -eq "__COLLECTOR_FQDN__" -or $IngestToken -eq "__INGEST_TOKEN__") {
  Write-Error "Fill in CollectorFqdn and IngestToken before deploying"
  exit 1
}

$DestDir = "C:\ProgramData\ClaudeCode"
$Dest    = Join-Path $DestDir "managed-settings.json"

# Build as an object so the output is always valid JSON.
$config = [ordered]@{
  env = [ordered]@{
    CLAUDE_CODE_ENABLE_TELEMETRY    = "1"
    OTEL_METRICS_EXPORTER           = "otlp"
    OTEL_LOGS_EXPORTER              = "otlp"
    OTEL_EXPORTER_OTLP_PROTOCOL     = "http/protobuf"
    OTEL_EXPORTER_OTLP_ENDPOINT     = "https://$CollectorFqdn"
    OTEL_EXPORTER_OTLP_HEADERS      = "Authorization=Bearer $IngestToken"
    OTEL_METRIC_EXPORT_INTERVAL     = "60000"
    OTEL_LOGS_EXPORT_INTERVAL       = "5000"
    OTEL_LOG_USER_PROMPTS           = "1"
    OTEL_METRICS_INCLUDE_ENTRYPOINT = "1"
  }
}

New-Item -ItemType Directory -Path $DestDir -Force | Out-Null

# Write UTF-8 WITHOUT a BOM — Claude Code's JSON parser rejects a leading BOM.
$json = $config | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($Dest, $json, (New-Object System.Text.UTF8Encoding($false)))

# Lock down so it's a true managed file: SYSTEM + Administrators full control,
# Users read-only, inheritance disabled.
icacls $Dest /inheritance:r /grant:r "SYSTEM:(F)" "BUILTIN\Administrators:(F)" "BUILTIN\Users:(RX)" | Out-Null

Write-Output "Deployed $Dest"
exit 0
