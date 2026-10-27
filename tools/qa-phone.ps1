param(
  [ValidateSet('Inspect','Tap','Capture','Scroll','Type')][string]$Action='Inspect',
  [string]$Target,
  [string]$Screenshot,
  [string]$Expected
)
$ErrorActionPreference='Stop'
$adbPath='C:\Users\USER\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$serial='10BD770XGP0003B'
function Screen {
  & $adbPath -s $serial shell uiautomator dump /sdcard/careslot-booking.xml | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Phone hierarchy unavailable' }
  $raw=& $adbPath -s $serial shell cat /sdcard/careslot-booking.xml
  [xml]$xml=$raw
  if (!$xml.SelectSingleNode('//node[@package="com.careslot.app"]')) { throw 'CareSlot is not accessible; unlock and open it before continuing' }
  return $xml
}
$screen=Screen
if ($Action -eq 'Scroll') {
  $points=[regex]::Matches($screen.SelectSingleNode('//node').GetAttribute('bounds'),'\d+')
  $width=[int]$points[2].Value; $height=[int]$points[3].Value
  $from=[int]($height*.77); $to=[int]($height*.35)
  if ($Target -eq 'backward') { $swap=$from; $from=$to; $to=$swap }
  & $adbPath -s $serial shell input swipe ([int]($width*.82)) $from ([int]($width*.82)) $to 450
  $screen=Screen
}
if ($Action -eq 'Type') {
  if ($Target -notmatch '^[A-Za-z0-9 .,!?-]+$') { throw 'This QA typing helper accepts simple fictional ASCII text only' }
  $editingName=!!($screen.SelectNodes('//node') | Where-Object { $_.GetAttribute('text') -eq 'Edit your name' })
  if (!$editingName -and !($screen.SelectNodes('//node') | Where-Object { $_.GetAttribute('text') -eq 'Request a refill?' })) { throw 'Supported fictional-data dialog not open' }
  $node=$screen.SelectNodes('//node[@package="com.careslot.app" and @class="android.widget.EditText"]') | Select-Object -First 1
  if (!$node) { throw 'Refill note input not found' }
  $points=[regex]::Matches($node.GetAttribute('bounds'),'\d+')
  & $adbPath -s $serial shell input tap ([int](([int]$points[0].Value+[int]$points[2].Value)/2)) ([int](([int]$points[1].Value+[int]$points[3].Value)/2))
  if ($editingName) {
    & $adbPath -s $serial shell input keyevent 123
    for ($index=0; $index -lt $node.GetAttribute('text').Length; $index++) { & $adbPath -s $serial shell input keyevent 67 }
  }
  & $adbPath -s $serial shell input text ($Target.Replace(' ','%s'))
  $screen=Screen
}
if ($Action -eq 'Tap') {
  $node=$screen.SelectNodes('//node') | Where-Object { $_.GetAttribute('text') -eq $Target -or $_.GetAttribute('content-desc') -eq $Target } | Select-Object -First 1
  if (!$node) { throw "CareSlot target not visible: $Target" }
  if ($node.GetAttribute('enabled') -ne 'true') { throw "CareSlot target is disabled: $Target" }
  $points=[regex]::Matches($node.GetAttribute('bounds'),'\d+')
  $tapX=([int]$points[0].Value+[int]$points[2].Value)/2
  $tapY=([int]$points[1].Value+[int]$points[3].Value)/2
  & $adbPath -s $serial shell input tap ([int]$tapX) ([int]$tapY)
  $screen=Screen
}
if ($Expected) {
  for ($attempt=0; $attempt -lt 20; $attempt++) {
    if ($screen.SelectNodes('//node') | Where-Object { $_.GetAttribute('text').Contains($Expected) }) { break }
    Start-Sleep -Milliseconds 500
    $screen=Screen
  }
  if (!($screen.SelectNodes('//node') | Where-Object { $_.GetAttribute('text').Contains($Expected) })) { throw "Expected CareSlot text not observed: $Expected" }
}
if ($Screenshot) {
  & $adbPath -s $serial shell screencap -p /sdcard/careslot-booking.png
  & $adbPath -s $serial pull /sdcard/careslot-booking.png $Screenshot | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Screenshot capture failed' }
}
$screen.SelectNodes('//node[@package="com.careslot.app" and (@text!="" or @content-desc!="")]') | ForEach-Object { '{0} | {1} | {2}' -f $_.GetAttribute('text'),$_.GetAttribute('content-desc'),$_.GetAttribute('bounds') }
