# Iru (formerly Kandji) — Windows Custom Script, REMEDIATION half.
#
# Paste this as the Remediation Script of the same Windows Custom Script
# Library Item that carries iru-audit-endpoint-agent.ps1 as its Audit Script.
# Iru runs it only when the audit exits non-zero, so it is an installer, not a
# check. Run in 64-bit PowerShell.
#
# Keep $ConsoleUrl in sync with the audit script, or audit and remediation will
# disagree and the item will reinstall on every check-in forever.
#
# The agent runs as a Scheduled Task in the logged-on user's context rather
# than as a SYSTEM service: browser profiles live under the user's own AppData,
# so a SYSTEM service would either see nothing or need privilege this agent has
# no business holding.

$ErrorActionPreference = 'Stop'

$ConsoleUrl       = 'https://REPLACE-ME.example.com'
$EnrollmentSecret = 'REPLACE-ME'
$BinaryUrl        = 'https://REPLACE-ME/urnammu-agent-windows-amd64.exe'

if ($ConsoleUrl -eq 'https://REPLACE-ME.example.com' -or $EnrollmentSecret -eq 'REPLACE-ME') {
    Write-Error 'ConsoleUrl and EnrollmentSecret must be set before deploying'
    exit 1
}

$SupportDir = Join-Path $env:ProgramData 'UrNammu'
$ConfigPath = Join-Path $SupportDir 'agent.json'
$BinaryPath = Join-Path $SupportDir 'urnammu-agent.exe'
$TaskName   = 'UrNammu Endpoint Agent'

New-Item -ItemType Directory -Force -Path $SupportDir | Out-Null

# ─── Binary ──────────────────────────────────────────────
$TempBinary = Join-Path $env:TEMP ('urnammu-agent-' + [guid]::NewGuid() + '.exe')
try {
    # TLS 1.2 is not the default on older PowerShell hosts and the download
    # fails obscurely without it.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $BinaryUrl -OutFile $TempBinary -UseBasicParsing

    # Refuse an unsigned binary rather than install something SmartScreen will
    # block and the user will be prompted about.
    $signature = Get-AuthenticodeSignature -FilePath $TempBinary
    if ($signature.Status -ne 'Valid') {
        Write-Error "downloaded binary is not validly signed ($($signature.Status)); refusing to install"
        exit 1
    }

    # Stop the task first, or the copy fails with the file in use.
    Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue |
        Stop-ScheduledTask -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Copy-Item -Path $TempBinary -Destination $BinaryPath -Force
}
finally {
    Remove-Item -Path $TempBinary -Force -ErrorAction SilentlyContinue
}

# ─── Config ──────────────────────────────────────────────
# The logged-on user, so endpoint findings attribute to a person. On an
# Entra-joined or domain-joined machine this resolves to their work identity.
$loggedOnUser = (Get-CimInstance Win32_ComputerSystem).UserName
$userEmail = $null
if ($loggedOnUser) {
    try {
        $sid = (New-Object System.Security.Principal.NTAccount($loggedOnUser)).Translate(
            [System.Security.Principal.SecurityIdentifier]).Value
        $userEmail = ([adsi]"LDAP://<SID=$sid>").mail
    } catch {
        # Not domain-joined, or no directory reachable. The console falls back
        # to hostname attribution, and directory sync can fill the gap later.
        $userEmail = $null
    }
}

$config = [ordered]@{
    consoleUrl       = $ConsoleUrl
    enrollmentSecret = $EnrollmentSecret
}
if ($userEmail) { $config.userEmail = [string]$userEmail }

$config | ConvertTo-Json -Depth 3 | Set-Content -Path $ConfigPath -Encoding UTF8

# ─── Scheduled task ──────────────────────────────────────
# At logon, in the user's own context, running indefinitely — the agent keeps
# its own interval loop on the cadence the console dictates.
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$action    = New-ScheduledTaskAction -Execute $BinaryPath
$trigger   = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited  # BUILTIN\Users
$settings  = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -Priority 7

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'Reports AI tool usage to the UrNammu governance console. Collects tool identifiers and counts only — never prompts, responses or URLs.' | Out-Null

Start-ScheduledTask -TaskName $TaskName

$installedVersion = (& $BinaryPath --version 2>$null | Select-Object -First 1)
Write-Output "urnammu-agent $($installedVersion) installed at $BinaryPath and scheduled as '$TaskName'"
