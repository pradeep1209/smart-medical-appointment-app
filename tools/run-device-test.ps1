param([Parameter(Mandatory=$true)][ValidateRange(1,14)][int]$Phase,
    [ValidateSet('test','discover','recover')][string]$Step='test')
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectPath
$testFile = Join-Path $projectPath ('qa/phase-{0:D2}/{1}_device.ps1' -f $Phase,$Step)
if (-not (Test-Path -LiteralPath $testFile)) { throw "The dedicated tester has not prepared $testFile" }
& $testFile
if ($LASTEXITCODE -ne 0) { throw "Device test process returned $LASTEXITCODE" }
