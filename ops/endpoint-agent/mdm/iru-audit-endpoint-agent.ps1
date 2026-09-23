# Iru (formerly Kandji) — Windows Custom Script, AUDIT half.
#
# Paste this as the Audit Script of a "Windows Custom Script" Library Item, and
# iru-remediate-endpoint-agent.ps1 as its Remediation Script.
#
#   Library → Add Library Item → Windows Custom Script
#   Run in 64-bit PowerShell.
#
# Contract: exit 0 = pass (Iru does nothing), any non-zero exit = failure,
# which makes Iru run the remediation script. This file only decides whether
# the agent needs attention; it never installs anything.
#
# Set $ExpectedVersion to roll out an upgrade: bump it here, the audit starts
# failing across the fleet, and remediation installs the new build.

$ErrorActionPreference = 'Stop'

$ExpectedVersion = '0.5.0'
$ConsoleUrl      = 'https://REPLACE-ME.example.com'

$SupportDir = Join-Path $env:ProgramData 'UrNammu'
$ConfigPath = Join-Path $SupportDir 'agent.json'
$BinaryPath = Join-Path $SupportDir 'urnammu-agent.exe'
$TaskName   = 'UrNammu Endpoint Agent'

function Fail([string]$Message) {
    Write-Output $Message
    exit 1
}

if (-not (Test-Path $BinaryPath)) { Fail "agent binary missing at $BinaryPath" }
if (-not (Test-Path $ConfigPath)) { Fail "agent config missing at $ConfigPath" }

# Version. & is used rather than Start-Process so stdout comes back directly.
$installedVersion = $null
try {
    $installedVersion = (& $BinaryPath --version 2>$null | Select-Object -First 1)
} catch {
    Fail 'agent binary will not execute; likely corrupt'
}
if ([string]::IsNullOrWhiteSpace($installedVersion)) {
    Fail 'agent binary will not report a version; likely corrupt'
}
$installedVersion = $installedVersion.Trim()
if ($installedVersion -ne $ExpectedVersion) {
    Fail "agent is $installedVersion, expected $ExpectedVersion"
}

# Point the fleet at a new console by editing $ConsoleUrl here: a mismatch
# fails the audit and remediation rewrites the config.
try {
    $config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
} catch {
    Fail 'agent config is not valid JSON'
}
if ($config.consoleUrl -ne $ConsoleUrl) {
    Fail "agent config points at $($config.consoleUrl), expected $ConsoleUrl"
}

# Authenticode signature still valid? Catches a partially-written binary from
# an interrupted download, and a build replaced by something unsigned.
$signature = Get-AuthenticodeSignature -FilePath $BinaryPath
if ($signature.Status -ne 'Valid') {
    Fail "agent binary signature is $($signature.Status), expected Valid"
}

# The scheduled task must exist and be enabled. Deliberately not a check that
# the process is currently running: a revoked device exits cleanly by design,
# so testing liveness would fight revocation forever — reinstalling a machine
# the console has deliberately cut off. It is also normal for the task to be
# idle between logons.
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { Fail "scheduled task '$TaskName' not registered" }
if ($task.State -eq 'Disabled') { Fail "scheduled task '$TaskName' is disabled" }

Write-Output "urnammu-agent $installedVersion installed, task '$TaskName' is $($task.State)"
exit 0
