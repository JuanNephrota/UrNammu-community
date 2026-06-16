# Hexnode -> Windows "Custom Script" (PowerShell) - enables per-user span
# attribution for cursor-otel-hook AFTER the MSI is installed.
#
# The MSI installs the hook and writes the base config + per-user hooks.json,
# but it does NOT set user identity. This script sets the per-user
# OTEL_RESOURCE_ATTRIBUTES env var; the hook (built with Resource.create())
# merges it into the span resource, so UrNammu attributes spans to the user
# (user.email -> userEmail, user.id -> userId).
#
# Run this AFTER the MSI app install. ASCII-only, no here-strings, PS 5.1-safe.
# Works run-as-SYSTEM (targets the logged-in console user's hive) or run-as-user.
# The user must restart Cursor (or sign out/in) for the env var to take effect.
#
# Optional argument: -EmailDomain "<domain>" (default certifid.com; blank ->
# attribute by user.id only).

param(
  [string]$EmailDomain = "certifid.com"
)
$ErrorActionPreference = "Stop"

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$isSystem = $identity -like "*NT AUTHORITY\SYSTEM*"

if ($isSystem) {
  # SYSTEM (Hexnode default): target the interactive console user's hive.
  $consoleUser = (Get-CimInstance Win32_ComputerSystem).UserName
  if ([string]::IsNullOrWhiteSpace($consoleUser)) {
    Write-Output "No interactive user logged in; nothing to set. Will re-run on next schedule."
    exit 0
  }
  $userName = $consoleUser.Split('\')[-1]
  try {
    $sid = (New-Object System.Security.Principal.NTAccount($consoleUser)).Translate([System.Security.Principal.SecurityIdentifier]).Value
  } catch {
    Write-Error "Could not resolve SID for ${consoleUser}: $_"; exit 1
  }
  $envKey = "Registry::HKEY_USERS\$sid\Environment"
  if (-not (Test-Path $envKey)) {
    Write-Error "User environment hive not loaded at $envKey (the user must be logged in)."; exit 1
  }
  $attrs = "user.id=$userName"
  if (-not [string]::IsNullOrWhiteSpace($EmailDomain)) { $attrs += ",user.email=$userName@$EmailDomain" }
  New-ItemProperty -Path $envKey -Name "OTEL_RESOURCE_ATTRIBUTES" -Value $attrs -PropertyType String -Force | Out-Null
  Write-Output "Set OTEL_RESOURCE_ATTRIBUTES=$attrs for $userName (HKU). Restart Cursor (or sign out/in) to apply."
} else {
  # Running as the user: .NET setter writes HKCU\Environment AND broadcasts
  # WM_SETTINGCHANGE, so a fresh Cursor launch inherits it.
  $userName = $env:USERNAME
  $attrs = "user.id=$userName"
  if (-not [string]::IsNullOrWhiteSpace($EmailDomain)) { $attrs += ",user.email=$userName@$EmailDomain" }
  [Environment]::SetEnvironmentVariable("OTEL_RESOURCE_ATTRIBUTES", $attrs, "User")
  Write-Output "Set OTEL_RESOURCE_ATTRIBUTES=$attrs for $userName. Restart Cursor to apply."
}
exit 0
