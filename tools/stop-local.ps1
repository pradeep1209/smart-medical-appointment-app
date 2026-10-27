$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$manifest=Join-Path $projectPath '.local/local-services/processes.json'
if (!(Test-Path -LiteralPath $manifest)) { Write-Output 'No helper-managed services are recorded.'; return }
$records=Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
foreach ($record in $records) {
 $managedProcessId=0
 if (![int]::TryParse([string]$record.processId,[ref]$managedProcessId) -or $managedProcessId -le 0) { throw 'Invalid recorded process ID. No unrelated process was stopped.' }
 $process=Get-Process -Id $managedProcessId -ErrorAction SilentlyContinue
 if (!$process) { continue }
 $details=Get-CimInstance Win32_Process -Filter "ProcessId=$managedProcessId"
 $entry=[IO.Path]::GetFullPath($record.entry)
 if (!$entry.StartsWith(([IO.Path]::GetFullPath($projectPath)+'\'),[StringComparison]::OrdinalIgnoreCase) -or !$details -or !$details.CommandLine -or $details.CommandLine.IndexOf($entry,[StringComparison]::OrdinalIgnoreCase) -lt 0 -or $process.StartTime.ToUniversalTime().Ticks -ne ([DateTime]$record.startedAt).ToUniversalTime().Ticks) { throw 'Recorded process identity changed. No unrelated process was stopped.' }
 Stop-Process -Id $managedProcessId
 Write-Output "Stopped helper-managed $($record.name)."
}
Remove-Item -LiteralPath $manifest
Write-Output 'Global PostgreSQL was left running.'
