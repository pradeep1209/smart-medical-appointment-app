param([switch]$Build)
$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$node=(Get-Command node.exe).Source
$apiEntry=Join-Path $projectPath 'apps/api/dist/main.js'
$webEntry=Join-Path $projectPath 'node_modules/next/dist/bin/next'
$logs=Join-Path $projectPath '.local/local-services'
$manifest=Join-Path $logs 'processes.json'
Set-Location -LiteralPath $projectPath
if ((Get-Service postgresql-x64-18).Status -ne 'Running') { throw 'Start postgresql-x64-18 in Windows Services first.' }
& $node (Join-Path $PSScriptRoot 'check-runtime-dependencies.cjs')
if ($LASTEXITCODE) { throw 'Runtime dependency verification failed.' }
if ($Build) {
 if (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -In @(3000,3001)) { throw 'Stop the local API/dashboard before rebuilding. Use stop-local.ps1 for services started by this helper.' }
 & npm.cmd run build:api; if ($LASTEXITCODE) { throw 'API build failed.' }
 & npm.cmd run build:web; if ($LASTEXITCODE) { throw 'Dashboard build failed.' }
}
if (!(Test-Path -LiteralPath $apiEntry) -or !(Test-Path -LiteralPath (Join-Path $projectPath 'apps/web/.next/BUILD_ID'))) { throw 'Build first with .\tools\start-local.ps1 -Build.' }
New-Item -ItemType Directory -Force $logs | Out-Null
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $logs '/inheritance:r' '/grant:r' "*$($sid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE) { throw 'Could not restrict local service logs.' }
$records=@()
if (Test-Path -LiteralPath $manifest) { $records=@(@(Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json) | Where-Object { Get-Process -Id $_.processId -ErrorAction SilentlyContinue }) }
function Launch([string]$name,[string]$entry,[string]$arguments,[string]$directory,[int]$port,[string]$probe) {
 $listener=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
 if ($listener) {
  try { $response=Invoke-WebRequest -Uri $probe -TimeoutSec 5; if ($response.StatusCode -ne 200) { throw 'Unavailable' }; if ($name -eq 'api' -and ($response.Content | ConvertFrom-Json).service -ne 'CareSlot API') { throw 'Unexpected service' } }
  catch { throw "Port $port is occupied by an unavailable or unexpected service. Nothing was stopped." }
  Write-Output "$name is already running on port $port; reused without adopting its process."
  return
 }
 $process=Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $directory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs "$name-out.log") -RedirectStandardError (Join-Path $logs "$name-error.log") -PassThru
 $script:records=@($script:records)+@([pscustomobject]@{name=$name;processId=$process.Id;entry=$entry;startedAt=$process.StartTime.ToUniversalTime().ToString('o')})
 $script:records | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifest
 for ($attempt=0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 500
  if ($process.HasExited) { throw "$name stopped. Check its private error log in .local/local-services." }
  try { if ((Invoke-WebRequest -Uri $probe -TimeoutSec 2).StatusCode -eq 200) { Write-Output "$name ready on port $port."; return } } catch {}
 }
 throw "$name did not become ready. Review its private logs."
}
Launch 'api' $apiEntry ('"{0}"' -f $apiEntry) $projectPath 3001 'http://127.0.0.1:3001/api/v1/health'
Launch 'web' $webEntry ('"{0}" start --hostname 127.0.0.1 --port 3000' -f $webEntry) (Join-Path $projectPath 'apps/web') 3000 'http://127.0.0.1:3000/login'
$lanSetting=Get-Content -LiteralPath (Join-Path $projectPath '.env') | Select-String '^API_LAN_ADDRESS=([0-9.]+)$' | Select-Object -Last 1
$lanEnabled=Get-Content -LiteralPath (Join-Path $projectPath '.env') | Select-String '^ALLOW_LAN_DEV=true\s*$'
if ($lanSetting -and $lanEnabled) { Write-Output "CareSlot dashboard: http://127.0.0.1:3000/login. Mobile Wi-Fi API: http://$($lanSetting.Matches[0].Groups[1].Value):3001/api/v1. Keep both devices on the same trusted Wi-Fi; no USB forwarding is needed for the Wi-Fi APK." }
else { Write-Output 'CareSlot is local only. Dashboard: http://127.0.0.1:3000/login. Phone forwarding: adb reverse tcp:3001 tcp:3001.' }
