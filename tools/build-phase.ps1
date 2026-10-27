param([Parameter(Mandatory=$true)][ValidateRange(1,14)][int]$Phase)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& .\gradlew.bat assembleDebug --no-daemon "-ProadmapPhase=$Phase"
if ($LASTEXITCODE -ne 0) { throw 'APK build failed' }
& .\tools\checkpoint.ps1 -Phase $Phase
$installPath=Join-Path (Get-Location).Path 'app/build/outputs/apk/debug/app-debug.apk'
if($Phase -eq 14){
    $outputPath=Join-Path (Get-Location).Path 'output/apk'
    New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
    $installPath=Join-Path $outputPath 'CareSlot.apk'
    Copy-Item -LiteralPath 'app/build/outputs/apk/debug/app-debug.apk' -Destination $installPath -Force
    [ordered]@{
        apk=$installPath
        apkSha256=(Get-FileHash -LiteralPath $installPath -Algorithm SHA256).Hash
        versionName='0.14.0'
        versionCode=114
        bytes=(Get-Item -LiteralPath $installPath).Length
        builtUtc=[DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath 'build-record.json') -Encoding utf8
}
& 'C:/Users/USER/AppData/Local/Android/Sdk/platform-tools/adb.exe' -s 10BD770XGP0003B install -r $installPath
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed' }
