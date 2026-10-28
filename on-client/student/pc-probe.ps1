# Fixed read-only probe for the PC status panel (student/pc-status.mjs runs it).
# - Section is one of three fixed names; no other input is read.
# - Only Get-* cmdlets with standard user rights. No Set-/New-/Remove-, no elevation.
# - Prints counts and states only. No IP, MAC, SSID, account names or log text.
# - Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less files as ANSI.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('network', 'firewall', 'events')]
  [string]$Section
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

function Get-FailureReason($err) {
  $ex = $err.Exception
  if ($err.CategoryInfo.Category -eq 'PermissionDenied' -or $ex -is [System.UnauthorizedAccessException]) { return 'access_denied' }
  if ($ex -is [System.Management.Automation.CommandNotFoundException]) { return 'not_supported' }
  if ($ex.GetType().Name -eq 'CimException' -and "$($ex.NativeErrorCode)" -eq 'AccessDenied') { return 'access_denied' }
  return 'failed'
}

function Read-Network {
  $adapters = @(Get-NetAdapter -ErrorAction Stop)
  $up = @($adapters | Where-Object { "$($_.Status)" -eq 'Up' }).Count
  $categories = $null
  try {
    $profiles = @(Get-NetConnectionProfile -ErrorAction Stop)
    $categories = @{
      public  = @($profiles | Where-Object { "$($_.NetworkCategory)" -eq 'Public' }).Count
      private = @($profiles | Where-Object { "$($_.NetworkCategory)" -eq 'Private' }).Count
      domain  = @($profiles | Where-Object { "$($_.NetworkCategory)" -eq 'DomainAuthenticated' }).Count
    }
  } catch { $categories = $null }
  return @{ status = 'ok'; adapterTotal = $adapters.Count; adapterUp = $up; categories = $categories }
}

function Read-Firewall {
  $profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop)
  $rows = @()
  foreach ($p in $profiles) { $rows += @{ name = "$($p.Name)"; enabled = "$($p.Enabled)".ToLower() } }
  return @{ status = 'ok'; profiles = $rows }
}

function Read-Events {
  $start = (Get-Date).AddHours(-24)
  $cap = 5000
  $logs = @()
  foreach ($name in @('System', 'Application')) {
    try {
      $errors = 0; $warnings = 0; $seen = 0
      try {
        Get-WinEvent -FilterHashtable @{ LogName = $name; Level = 2, 3; StartTime = $start } -MaxEvents $cap -ErrorAction Stop |
          ForEach-Object {
            $seen++
            if ($_.Level -eq 2) { $errors++ } else { $warnings++ }
          }
      } catch {
        # "no events found" is a real zero; anything else is a failure
        if ("$($_.FullyQualifiedErrorId)" -notlike 'NoMatchingEventsFound*') { throw }
      }
      $logs += @{ name = $name; status = 'ok'; errors = $errors; warnings = $warnings; truncated = ($seen -ge $cap) }
    } catch {
      $logs += @{ name = $name; status = 'unavailable'; reason = (Get-FailureReason $_) }
    }
  }
  return @{ status = 'ok'; windowHours = 24; logs = $logs }
}

try {
  switch ($Section) {
    'network'  { $result = Read-Network }
    'firewall' { $result = Read-Firewall }
    'events'   { $result = Read-Events }
  }
} catch {
  $result = @{ status = 'unavailable'; reason = (Get-FailureReason $_) }
}
[Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 5))
exit 0
