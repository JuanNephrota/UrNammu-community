# Hexnode -> Windows "Custom Script" (PowerShell, runs as SYSTEM) - configures
# cursor-otel-hook for the active interactive user so Cursor activity is
# reported to UrNammu.
#
# PREREQ (separate Hexnode step): the cursor-otel-hook **.msi must already be
# installed system-wide** - push it as a Hexnode *app/package*. This script
# does NOT install the hook binary; it writes the per-user config + hook
# registration that points the installed hook at your collector. Cursor stores
# hook config per-user under %USERPROFILE%\.cursor, and there is no enforced
# system tier (unlike Claude Code), so this targets the logged-in user.
#
# Deploy in Hexnode:
#   1. Admin Console -> Scripts -> Add Custom Script -> Platform: Windows,
#      Type: PowerShell.
#   2. Paste this script AS-IS (no edits) and set the script Arguments to:
#        -CollectorFqdn "<fqdn>" -IngestToken "<ingest-bearer-token>"
#   3. Assign to your Windows device group / policy (runs as SYSTEM).
#   4. Schedule a periodic re-run - it's idempotent and re-targets whoever is
#      currently logged in.
#
# SECURITY: the filled-in copy contains the ingest bearer token. Keep the real
# token in the Hexnode console copy only - this committed file uses
# placeholders. Rotate via ops/otel-collector/rotate-secrets.sh rotate-ingest.
#
# TOKEN: IngestToken is the CLIENT->COLLECTOR ingest token (the collector's
# `ingest-bearer-token` ACA secret). It is NOT the cursor_telemetry_secret /
# cursor-forward-bearer-token (COLLECTOR->UrNammu). Mixing them up yields a 401
# at the collector. Read it with:
#   az containerapp secret show -g certifid-ai-governance -n cc-otel-app `
#     --secret-name ingest-bearer-token --query value -o tsv
#
# CURSOR_OTEL_MASK_PROMPTS=false sends prompt text to the collector so UrNammu
# can run dangerous-prompt detection in-memory (raw prompt never stored). Set
# it to "true" to keep prompts off the wire entirely (disables prompt-risk).

param(
  [string]$CollectorFqdn   = "",   # e.g. cc-otel-app.<region>.azurecontainerapps.io
  [string]$IngestToken     = "",   # collector ingest-bearer-token (NOT the forward secret)
  [string]$EmailDomain     = "certifid.com",  # user.email=<user>@<domain>; blank = user.id only
  [string]$HookBinOverride = ""    # optional: absolute path to the installed hook exe
)

$ErrorActionPreference = "Stop"

# Values are passed as Hexnode script ARGUMENTS so no secret lives in the script
# body (Hexnode can mangle/strip inline values; arguments avoid that). In the
# Hexnode custom-script "Arguments" field set:
#   -CollectorFqdn "cc-otel-app.<region>.azurecontainerapps.io" -IngestToken "<ingest-bearer-token>"
if ([string]::IsNullOrWhiteSpace($CollectorFqdn) -or [string]::IsNullOrWhiteSpace($IngestToken)) {
  Write-Error "Pass -CollectorFqdn and -IngestToken as Hexnode script arguments."; exit 1
}

# Resolve the interactive user (SYSTEM has no profile of its own).
$activeUser = (Get-CimInstance Win32_ComputerSystem).UserName  # DOMAIN\user or PC\user
if ([string]::IsNullOrWhiteSpace($activeUser)) {
  Write-Output "No interactive user logged in. Nothing to configure; will re-run on next schedule."
  exit 0
}

# Map the account -> SID -> profile directory (handles domain + local accounts).
try {
  $sid = (New-Object System.Security.Principal.NTAccount($activeUser)).Translate(
    [System.Security.Principal.SecurityIdentifier]).Value
} catch {
  Write-Error "Could not resolve SID for ${activeUser}: $_"
  exit 1
}
$userProfile = (Get-CimInstance Win32_UserProfile -Filter "SID='$sid'").LocalPath
if ([string]::IsNullOrWhiteSpace($userProfile) -or -not (Test-Path $userProfile)) {
  Write-Error "Could not resolve profile path for $activeUser"
  exit 1
}

# Per-user span attribution. Strip any DOMAIN\ prefix to the bare username;
# UrNammu reads user.email -> userEmail and user.id -> userId. Requires the hook
# to honor OTEL_RESOURCE_ATTRIBUTES (Resource.create() in the pkg build).
$userName = $activeUser.Split('\')[-1]
$otelResAttrs = "user.id=$userName"
if (-not [string]::IsNullOrWhiteSpace($EmailDomain)) {
  $otelResAttrs += ",user.email=$userName@$EmailDomain"
}

# Locate the hook executable the .msi installed.
$sysDir = "C:\Program Files\CursorOtelHook"
$hookBin = $HookBinOverride
if ([string]::IsNullOrWhiteSpace($hookBin)) {
  $candidates = @(
    (Join-Path $sysDir "cursor-otel-hook.exe"),
    (Join-Path $sysDir "bin\cursor-otel-hook.exe"),
    (Join-Path $sysDir "venv\Scripts\cursor-otel-hook.exe")
  )
  foreach ($c in $candidates) { if (Test-Path $c) { $hookBin = $c; break } }
}
if ([string]::IsNullOrWhiteSpace($hookBin) -or -not (Test-Path $hookBin)) {
  Write-Error "cursor-otel-hook.exe not found under $sysDir. Push the .msi as a Hexnode app first, or set HookBinOverride."
  exit 1
}

$cursorDir = Join-Path $userProfile ".cursor"
$hooksDir  = Join-Path $cursorDir "hooks"
$config    = Join-Path $hooksDir "otel_config.json"
$wrapper   = Join-Path $hooksDir "otel_hook.cmd"
$hooksJson = Join-Path $cursorDir "hooks.json"
$caBundle  = Join-Path $hooksDir "ca-bundle.pem"

New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null

$utf8 = New-Object System.Text.UTF8Encoding($false)  # no BOM - parsers reject it

# -- CA bundle - trust the corporate TLS-intercepting proxy ---------------
# A TLS-inspecting proxy's root CA lives in the Windows cert store (so Edge/
# curl trust it) but NOT in Python's certifi bundle, so the hook's OTLP/HTTPS
# export fails with CERTIFICATE_VERIFY_FAILED. Export LocalMachine Root + CA
# stores to a PEM the wrapper points the exporter at. Harmless un-proxied.
try {
  $sb = New-Object System.Text.StringBuilder
  foreach ($store in @("Cert:\LocalMachine\Root", "Cert:\LocalMachine\CA")) {
    Get-ChildItem $store -ErrorAction SilentlyContinue | ForEach-Object {
      $b64 = [System.Convert]::ToBase64String($_.RawData, [System.Base64FormattingOptions]::InsertLineBreaks)
      [void]$sb.AppendLine("-----BEGIN CERTIFICATE-----")
      [void]$sb.AppendLine($b64)
      [void]$sb.AppendLine("-----END CERTIFICATE-----")
    }
  }
  [System.IO.File]::WriteAllText($caBundle, $sb.ToString(), $utf8)
} catch {
  Write-Output "WARN: could not export Windows cert store to CA bundle: $_"
}

# -- otel_config.json - points the hook at our collector -----------------
# NOTE: the endpoint MUST include /v1/traces. The hook's http/protobuf branch
# passes the endpoint to OTLPSpanExporter as-is (no signal-path append, unlike
# its http/json branch); without /v1/traces the collector returns 404.
$cfg = [ordered]@{
  OTEL_EXPORTER_OTLP_ENDPOINT = "https://$CollectorFqdn/v1/traces"
  OTEL_SERVICE_NAME           = "cursor-agent"
  OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf"
  OTEL_EXPORTER_OTLP_INSECURE = "false"
  OTEL_EXPORTER_OTLP_HEADERS  = "Authorization=Bearer $IngestToken"
  CURSOR_OTEL_MASK_PROMPTS    = "false"
  OTEL_EXPORTER_OTLP_TIMEOUT  = "30"
}
[System.IO.File]::WriteAllText($config, ($cfg | ConvertTo-Json -Depth 5), $utf8)

# -- wrapper .cmd the hook registration invokes --------------------------
# Cursor runs the registered command and pipes the event JSON to its stdin,
# which cmd.exe forwards to the child process. The CA-bundle env vars make
# Python's OTLP/HTTPS export trust the corporate proxy root (certifi alone
# does not). Built as an array + join (no here-string) so Hexnode's editor /
# script transport can't mangle a here-string terminator.
$wrapperLines = @(
  '@echo off',
  ('if exist "' + $caBundle + '" ('),
  ('  set "REQUESTS_CA_BUNDLE=' + $caBundle + '"'),
  ('  set "SSL_CERT_FILE=' + $caBundle + '"'),
  ('  set "OTEL_EXPORTER_OTLP_CERTIFICATE=' + $caBundle + '"'),
  ')',
  ('set "OTEL_RESOURCE_ATTRIBUTES=' + $otelResAttrs + '"'),
  ('"' + $hookBin + '" --config "' + $config + '"')
)
[System.IO.File]::WriteAllText($wrapper, ($wrapperLines -join "`r`n") + "`r`n", $utf8)

# -- hooks.json registration (merge - never clobber other hooks) ---------
$events = @(
  "sessionStart", "sessionEnd", "beforeSubmitPrompt", "preToolUse",
  "postToolUse", "beforeShellExecution", "beforeMCPExecution",
  "afterFileEdit", "stop"
)

function ConvertTo-OrderedHashtable($obj) {
  $ht = [ordered]@{}
  if ($obj -is [System.Management.Automation.PSCustomObject]) {
    foreach ($p in $obj.PSObject.Properties) { $ht[$p.Name] = $p.Value }
  } elseif ($obj -is [System.Collections.IDictionary]) {
    foreach ($k in $obj.Keys) { $ht[$k] = $obj[$k] }
  }
  return $ht
}

$data = $null
if (Test-Path $hooksJson) {
  try { $data = Get-Content -Raw $hooksJson | ConvertFrom-Json } catch { $data = $null }
}
$root = if ($null -ne $data) { ConvertTo-OrderedHashtable $data } else { [ordered]@{} }
if (-not $root.Contains("version")) { $root["version"] = 1 }
$hooksObj = if ($root.Contains("hooks")) { ConvertTo-OrderedHashtable $root["hooks"] } else { [ordered]@{} }

foreach ($ev in $events) {
  $arr = @()
  if ($hooksObj.Contains($ev) -and $hooksObj[$ev]) { $arr = @($hooksObj[$ev]) }
  $already = $false
  foreach ($h in $arr) {
    $hc = if ($h -is [System.Management.Automation.PSCustomObject]) { $h.command }
          elseif ($h -is [System.Collections.IDictionary]) { $h["command"] } else { $null }
    if ($hc -eq $wrapper) { $already = $true; break }
  }
  if (-not $already) { $arr += [ordered]@{ command = $wrapper; timeout = 5 } }
  $hooksObj[$ev] = $arr
}
$root["hooks"] = $hooksObj
[System.IO.File]::WriteAllText($hooksJson, ($root | ConvertTo-Json -Depth 8), $utf8)

# -- ownership: files were created by SYSTEM inside the user's profile.
# Grant the interactive user FullControl (inherited) so Cursor (running as
# them) can read the config and Cursor can update hooks.json.
try {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $activeUser, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
  $acl = Get-Acl $hooksDir
  $acl.AddAccessRule($rule)
  Set-Acl $hooksDir $acl
} catch {
  Write-Output "WARN: could not adjust ACLs on ${hooksDir}: $_"
}

Write-Output "Configured cursor-otel-hook for $activeUser -> https://$CollectorFqdn"
exit 0
