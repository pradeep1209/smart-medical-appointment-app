$ErrorActionPreference='Stop'
$adb='C:/Users/USER/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$serial='10BD770XGP0003B'
function Adb { & $adb -s $serial @args; if($LASTEXITCODE -ne 0){throw "ADB failed: $args"} }
function Refresh-Ui {
    for($attempt=1;$attempt -le 3;$attempt++) {
        try {
            $dump=Adb shell uiautomator dump /sdcard/careslot-window.xml
            if(($dump -join '') -notmatch 'dumped to:'){throw 'UI dump failed; no stale XML accepted'}
            $xml=Adb shell cat /sdcard/careslot-window.xml
            [xml]$script:ui=$xml -join ''
            return
        } catch {
            if($attempt -eq 3){throw}
            Start-Sleep -Milliseconds 350
        }
    }
}
function Capture([string]$name,[switch]$AllowSystem) {
    Refresh-Ui
    if(-not $AllowSystem -and -not @($ui.SelectNodes('//node')|Where-Object{$_.package -eq 'com.careslot.app'}).Count){throw 'CareSlot not foreground; refusing unrelated screen capture'}
    New-Item -ItemType Directory -Path $out -Force | Out-Null
    $ui.OuterXml | Set-Content -LiteralPath "$out/$name.xml" -Encoding utf8
    Adb shell screencap -p /sdcard/careslot-shot.png
    Adb pull /sdcard/careslot-shot.png "$out/$name.png" | Out-Null
    Write-Output "Captured $name"
}
function Find-Ui([string]$label) {
    $ui.SelectNodes('//node')|Where-Object{($_.text).Trim() -eq $label -or ($_.'content-desc').Trim() -eq $label}|Select-Object -First 1
}
function Tap([string]$label) {
    $n=Find-Ui $label
    if(-not $n){throw "UI label not visible: $label"}
    if($n.enabled -eq 'false'){throw "UI label disabled: $label"}
    $v=[regex]::Matches($n.bounds,'\d+')|ForEach-Object{[int]$_.Value}
    Adb shell input tap ([int](($v[0]+$v[2])/2)) ([int](($v[1]+$v[3])/2))
}
function Assert-Text([string]$label) {if(-not (Find-Ui $label)){throw "Expected text not visible: $label"}}
function Scroll-To([string]$label) {
    for($i=0;$i -lt 10;$i++){
        Refresh-Ui
        if(Find-Ui $label){return}
        Adb shell input swipe 530 1730 530 650 350
    }
    throw "Text not found after scroll: $label"
}
function TapInput([int]$index=0) {
    $n=@($ui.SelectNodes('//node')|Where-Object{$_.class -eq 'android.widget.EditText'})[$index]
    if(-not $n){throw "Input not visible: $index"}
    $v=[regex]::Matches($n.bounds,'\d+')|ForEach-Object{[int]$_.Value}
    Adb shell input tap ([int](($v[0]+$v[2])/2)) ([int](($v[1]+$v[3])/2))
    Start-Sleep -Milliseconds 300
}
function Start-CareSlot {
    Adb shell input keyevent 224
    Adb shell am start -W -n com.careslot.app/.MainActivity | Out-Null
    Start-Sleep -Milliseconds 700
    Refresh-Ui
}
function Set-Input([int]$index,[string]$value) {
    Refresh-Ui
    $node=@($ui.SelectNodes('//node')|Where-Object{$_.class -eq 'android.widget.EditText'})[$index]
    $length=($node.text).Length
    TapInput $index
    Adb shell input keyevent 123
    if($length -gt 0){$keys=@('shell','input','keyevent')+@((1..$length)|ForEach-Object{'67'});Adb @keys}
    if($value.Length -gt 0){Adb shell input text ($value.Replace(' ','%s'))}
}
function Run-DomainChecks([int]$phase) {
    $result=Adb shell am instrument -w -e phase $phase com.careslot.app/.QaInstrumentation
    $result|Set-Content -LiteralPath "$out/domain-tests.txt" -Encoding utf8
    if(($result -join '') -notmatch 'Failures: 0'){throw "Device domain checks failed: $result"}
    Write-Output ($result -join "`n")
}
