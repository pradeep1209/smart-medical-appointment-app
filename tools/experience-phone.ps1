param([string[]]$Tap=@(),[switch]$Back,[switch]$Scroll,[string]$Capture,[string]$InputLabel,[string]$InputText,[string]$Resource,[string]$EvidenceDirectory='qa/shared/experience')
$ErrorActionPreference='Stop'
$adbTask='C:\Users\USER\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$device='10BD770XGP0003B'
function Screen {
 & $adbTask -s $device shell uiautomator dump /sdcard/careslot-experience.xml | Out-Null
 if ($LASTEXITCODE) { throw 'Phone hierarchy unavailable' }
 [xml]$screen=(& $adbTask -s $device shell cat /sdcard/careslot-experience.xml | Out-String)
 return $screen
}
function Touch($n){$b=[regex]::Matches($n.GetAttribute('bounds'),'\d+');if($b.Count -ne 4){throw 'Missing bounds'};& $adbTask -s $device shell input tap ([int](([int]$b[0].Value+[int]$b[2].Value)/2)) ([int](([int]$b[1].Value+[int]$b[3].Value)/2)) | Out-Null}
if($Back){& $adbTask -s $device shell input keyevent KEYCODE_BACK | Out-Null}
if($Scroll){& $adbTask -s $device shell input swipe 850 1850 850 1000 350 | Out-Null}
foreach($label in $Tap){
 $found=$null
 for($i=0;$i -lt 10;$i++){
  $xml=Screen
  $found=$xml.SelectNodes('//node') | Where-Object { ($_.GetAttribute('text') -eq $label -or $_.GetAttribute('content-desc') -eq $label) -and $_.GetAttribute('enabled') -eq 'true' } | Select-Object -First 1
  if($found){break}
  & $adbTask -s $device shell input swipe 850 1850 850 1000 350 | Out-Null
 }
 if(!$found){throw "Control not visible: $label"}
 Touch $found
}
if($InputLabel -or $Resource){
 $xml=Screen
 $field=$xml.SelectNodes('//node') | Where-Object { $_.GetAttribute('class') -eq 'android.widget.EditText' -and $(if($Resource){$_.GetAttribute('resource-id') -eq $Resource}else{$_.GetAttribute('content-desc') -eq $InputLabel}) } | Select-Object -First 1
 if(!$field){throw "Input not visible: $InputLabel $Resource"};Touch $field
 & $adbTask -s $device shell input keyevent KEYCODE_MOVE_END | Out-Null
 & $adbTask -s $device shell input keyevent --longpress KEYCODE_DEL | Out-Null
 # Select all through Android's keyboard shortcut; only the focused test form is changed.
 & $adbTask -s $device shell input keycombination 113 29 | Out-Null
 & $adbTask -s $device shell input text ($InputText.Replace(' ','%s')) | Out-Null
 & $adbTask -s $device shell input keyevent KEYCODE_BACK | Out-Null
}
$xml=Screen
if($Capture){& $adbTask -s $device shell screencap -p /sdcard/careslot-experience.png | Out-Null;& $adbTask -s $device pull /sdcard/careslot-experience.png (Join-Path $PSScriptRoot "../$EvidenceDirectory/$Capture.png") | Out-Null}
$xml.SelectNodes('//node') | Where-Object { $_.GetAttribute('text') -or $_.GetAttribute('content-desc') } | ForEach-Object { [pscustomobject]@{text=$_.GetAttribute('text');label=$_.GetAttribute('content-desc');id=$_.GetAttribute('resource-id');type=$_.GetAttribute('class');bounds=$_.GetAttribute('bounds')} } | ConvertTo-Json -Depth 3
