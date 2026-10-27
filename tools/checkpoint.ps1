param([Parameter(Mandatory=$true)][ValidateRange(1,14)][int]$Phase)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$phasePath = Join-Path $projectPath ('qa/phase-{0:D2}' -f $Phase)
New-Item -ItemType Directory -Path $phasePath -Force | Out-Null
$apkPath = Join-Path $projectPath 'app/build/outputs/apk/debug/app-debug.apk'
$apkItem = Get-Item -LiteralPath $apkPath
[ordered]@{
    phase = $Phase
    apk = $apkItem.FullName
    sha256 = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash
    bytes = $apkItem.Length
    capturedUtc = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $phasePath 'build.json') -Encoding utf8
