param([Parameter(Mandatory=$true)][ValidateSet('start','stop')][string]$Action)
$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$recordPath=Join-Path $projectPath 'qa/device-session.json'
$adb='C:/Users/USER/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$serial='10BD770XGP0003B'
if($Action -eq 'start'){
    $record=if(Test-Path -LiteralPath $recordPath){Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json}else{$null}
    if(-not $record -or -not $record.active){
        $original=((& $adb -s $serial shell settings get global stay_on_while_plugged_in)-join '').Trim()
        if($LASTEXITCODE -ne 0 -or $original -notmatch '^\d+$' -or [int]$original -gt 31){throw 'Cannot read original device stay-awake setting'}
        $record=[ordered]@{serial=$serial;originalStayAwake=$original;active=$true;startedUtc=[DateTime]::UtcNow.ToString('o')}
        $record|ConvertTo-Json|Set-Content -LiteralPath $recordPath -Encoding utf8
    }
    & $adb -s $serial shell svc power stayon true
    if($LASTEXITCODE -ne 0){throw 'Cannot keep the connected test phone awake'}
    'USB test session active. The user must unlock any credential lock manually.'
}else{
    if(-not(Test-Path -LiteralPath $recordPath)){throw 'No recorded device session to restore'}
    $record=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json
    if(-not $record.active){'No active test session; device setting left unchanged.';return}
    & $adb -s $serial shell settings put global stay_on_while_plugged_in $record.originalStayAwake
    if($LASTEXITCODE -ne 0){throw 'Device setting restoration remains pending'}
    $record.active=$false
    $record|ConvertTo-Json|Set-Content -LiteralPath $recordPath -Encoding utf8
    'Original device stay-awake setting restored.'
}
