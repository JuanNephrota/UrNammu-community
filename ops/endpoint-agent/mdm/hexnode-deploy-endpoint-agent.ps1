# Deploy the UrNammu endpoint agent to a managed Windows machine (Hexnode).
#
# Mirrors the macOS script: idempotent, safe on every check-in, and it fails
# loudly only on a genuine problem.
#
# The agent runs as a Scheduled Task in the logged-on user's context rather
# than as a Windows service under SYSTEM. Browser profiles live under the
# user's own AppData, so a SYSTEM service would either see nothing or need
# privilege this agent has no business holding.

$ErrorActionPreference = 'Stop'

$ConsoleUrl       = $env:CONSOLE_URL       ; if (-not $ConsoleUrl)       { $ConsoleUrl       = 'https://REPLACE-ME.vercel.app' }
$EnrollmentSecret = $env:ENROLLMENT_SECRET ; if (-not $EnrollmentSecret) { $EnrollmentSecret = 'REPLACE-ME' }
$BinaryUrl        = $env:BINARY_URL        ; if (-not $BinaryUrl)        { $BinaryUrl        = 'https://REPLACE-ME/urnammu-agent-windows-amd64.exe' }
# Thumbprint of the Authenticode certificate that signs the agent.
$ExpectedThumbprint = $env:EXPECTED_THUMBPRINT ; if (-not $ExpectedThumbprint) { $ExpectedThumbprint = 'REPLACE-ME' }

if ($ConsoleUrl -eq 'https://REPLACE-ME.vercel.app' -or $EnrollmentSecret -eq 'REPLACE-ME') {
    Write-Error 'CONSOLE_URL and ENROLLMENT_SECRET must be set before deploying'
    exit 1
}

$SupportDir = Join-Path $env:ProgramData 'UrNammu'
$ConfigPath = Join-Path $SupportDir 'agent.json'
$BinaryPath = Join-Path $SupportDir 'urnammu-agent.exe'
$TaskName   = 'UrNammu Endpoint Agent'

if ($BinaryUrl -notmatch '^https://') {
    Write-Error 'BinaryUrl must be an https:// URL'
    exit 1
}
if (-not $ExpectedThumbprint -or $ExpectedThumbprint -eq 'REPLACE-ME') {
    Write-Error 'ExpectedThumbprint (the Authenticode signing certificate thumbprint) must be set before deploying'
    exit 1
}

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
    # Pin the signer, not just "validly signed": any Authenticode-signed binary
    # (including an attacker's) reports Valid.
    $actualThumbprint = ($signature.SignerCertificate.Thumbprint -replace '\s', '').ToUpper()
    if ($actualThumbprint -ne ($ExpectedThumbprint -replace '\s', '').ToUpper()) {
        Write-Error "downloaded binary is signed by $actualThumbprint, not the pinned certificate; refusing to install"
        exit 1
    }

    # Stopping the task first avoids a file-in-use failure on upgrade.
    Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Copy-Item -Path $TempBinary -Destination $BinaryPath -Force
}
finally {
    Remove-Item -Path $TempBinary -Force -ErrorAction SilentlyContinue
}

# ─── Config ──────────────────────────────────────────────
# The logged-on user, so endpoint findings attribute to a person. On a
# domain-joined or Entra-joined machine this resolves to their work identity.
$loggedOnUser = (Get-CimInstance Win32_ComputerSystem).UserName
$userEmail = $env:USER_EMAIL
if (-not $userEmail -and $loggedOnUser) {
    try {
        $userEmail = ([adsi]"LDAP://<SID=$((New-Object System.Security.Principal.NTAccount($loggedOnUser)).Translate([System.Security.Principal.SecurityIdentifier]).Value)>").mail
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

Write-Output "urnammu-agent installed at $BinaryPath and scheduled as '$TaskName'"
