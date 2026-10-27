$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$manifest=Join-Path $projectPath '.local/local-services/processes.json'
if (!(Test-Path -LiteralPath $manifest)) { Write-Output 'No helper-managed services are recorded.'; return }
$records=@(Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json)
foreach ($record in $records) {
 $process=Get-Process -Id $record.processId -ErrorAction SilentlyContinue
 if (!$process) { continue }
 $details=Get-CimInstance Win32_Process -Filter "ProcessId=$($record.processId)"
 $entry=[IO.Path]::GetFullPath($record.entry)
 if (!$entry.StartsWith(([IO.Path]::GetFullPath($projectPath)+'\'),[StringComparison]::OrdinalIgnoreCase) -or $details.CommandLine.IndexOf($entry,[StringComparison]::OrdinalIgnoreCase) -lt 0 -or $process.StartTime.ToUniversalTime().Ticks -ne ([DateTime]$record.startedAt).ToUniversalTime().Ticks) { throw 'Recorded process identity changed. No unrelated process was stopped.' }
 Stop-Process -Id $record.processId
 Write-Output "Stopped helper-managed $($record.name)."
}
Remove-Item -LiteralPath $manifest
Write-Output 'Global PostgreSQL was left running.'
