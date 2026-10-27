$ErrorActionPreference='Stop'
$adbPath='C:\Users\USER\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$serial='10BD770XGP0003B'
$output=Join-Path (Split-Path -Parent $PSScriptRoot) 'qa/shared/cancellation'
function Screen {
  & $adbPath -s $serial shell uiautomator dump /sdcard/careslot-cancellation.xml | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Device hierarchy unavailable' }
  [xml]$xml=(& $adbPath -s $serial shell cat /sdcard/careslot-cancellation.xml | Out-String)
  if (!$xml.SelectSingleNode('//node[@package="com.careslot.app"]')) { throw 'Unlock the phone and keep CareSlot open' }
  return $xml
}
function Tap($node) {
  $points=[regex]::Matches($node.GetAttribute('bounds'),'\d+')
  if ($points.Count -ne 4) { throw 'Visible control bounds missing' }
  & $adbPath -s $serial shell input tap ([int](([int]$points[0].Value+[int]$points[2].Value)/2)) ([int](([int]$points[1].Value+[int]$points[3].Value)/2)) | Out-Null
}
function Capture([string]$name) {
  & $adbPath -s $serial shell screencap -p /sdcard/careslot-cancellation.png
  & $adbPath -s $serial pull /sdcard/careslot-cancellation.png (Join-Path $output $name) | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Evidence screenshot failed' }
}
$checks=@()
foreach ($case in @(@('reception','Cancelled by reception'),@('administrator','Cancelled by clinic administrator'),@('patient','Cancelled by you'),@('doctor','Cancelled by doctor · QA Cancellation Doctor'))) {
  $screen=Screen
  for ($attempt=0;$attempt -lt 10;$attempt++) {
    $label=$screen.SelectNodes('//node') | Where-Object { $_.GetAttribute('text') -eq $case[1] } | Select-Object -First 1
    if ($label) { break }
    & $adbPath -s $serial shell input swipe 880 1860 880 1010 400 | Out-Null
    $screen=Screen
  }
  if (!$label) { throw "Cancellation card label missing: $($case[1])" }
  for ($adjust=0;$adjust -lt 4;$adjust++) {
    $card=$label.ParentNode
    $history=$card.SelectSingleNode('.//node[@text="Visit history"]')
    if ($history) { break }
    & $adbPath -s $serial shell input swipe 880 1800 880 1450 350 | Out-Null
    $screen=Screen
    $label=$screen.SelectNodes('//node') | Where-Object { $_.GetAttribute('text') -eq $case[1] } | Select-Object -First 1
    if (!$label) { throw "Card label moved out of view for $($case[0])" }
  }
  $stamp=$card.SelectNodes('.//node') | Where-Object { $_.GetAttribute('text') -match '^Cancelled .+\d{4}.+\d{1,2}:\d{2}' } | Select-Object -First 1
  if (!$stamp) { throw "Cancellation timestamp missing for $($case[0])" }
  if (!$history) { throw "Card history control is not visible for $($case[0])" }
  Capture "mobile-$($case[0]).png"
  Tap $history
  $dialog=Screen
  $message=$dialog.SelectNodes('//node') | Where-Object { $_.GetAttribute('text').Contains($case[1]) } | Select-Object -First 1
  if (!$message) { throw "History lacks cancellation attribution for $($case[0])" }
  Capture "mobile-$($case[0])-history.png"
  $close=$dialog.SelectNodes('//node') | Where-Object { $_.GetAttribute('text') -eq 'Close' } | Select-Object -First 1
  if (!$close) { throw 'Expected history dialog Close control missing' }
  Tap $close
  $checks+=@{role=$case[0];expected=$case[1];actual=$label.GetAttribute('text');timestamp=$stamp.GetAttribute('text');card='PASS';history='PASS'}
}
@{recordedAt=(Get-Date).ToUniversalTime().ToString('o');result='PASS';device='Physical Android phone';version='1.5.2 (224)';checks=$checks;transport='Wi-Fi; no ADB reverse'} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output 'phone-checks.json')
Write-Output 'PASS: all four cancellation card labels, timestamps and history entries on the physical phone.'
