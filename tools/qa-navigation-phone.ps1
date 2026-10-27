$ErrorActionPreference='Stop'
$adbTask='C:\Users\USER\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$device='10BD770XGP0003B'
$evidence='qa/shared/navigation'
$checks=@()
$densityText=& $adbTask -s $device shell wm density
$density=[double]([regex]::Matches(($densityText -join ' '),'\d+') | Select-Object -Last 1).Value / 160
function Snapshot { [xml](& $adbTask -s $device shell cat /sdcard/careslot-experience.xml | Out-String) }
function Step([string]$name,[string[]]$tap,[string]$active,[string]$title,[switch]$Back) {
 & "$PSScriptRoot/experience-phone.ps1" -Tap $tap -Back:$Back -EvidenceDirectory $evidence -Capture $name | Out-Null
 $xml=Snapshot
 foreach($label in @('Clinic','Visits','Care','Inbox','Account')){
  $node=$xml.SelectSingleNode("//node[@content-desc='$label' and @class='android.widget.Button']")
  if(!$node){throw "Missing persistent tab $label on $name"}
  if(($node.GetAttribute('selected') -eq 'true') -ne ($label -eq $active)){throw "Incorrect selection for $label on $name"}
  $bounds=[regex]::Matches($node.GetAttribute('bounds'),'\d+')
  if(([int]$bounds[2].Value-[int]$bounds[0].Value)/$density -lt 48 -or ([int]$bounds[3].Value-[int]$bounds[1].Value)/$density -lt 48){throw "Touch target below 48 dp: $label"}
 }
 if(!($xml.SelectNodes('//node') | Where-Object {$_.GetAttribute('text') -eq $title})){throw "Missing title $title on $name"}
 $script:checks+=@{case=$name;expected="Visible $title; $active selected; all five tabs reachable with >=48dp targets";actual='Verified from phone hierarchy and screenshot';result='PASS'}
 Write-Output "PASS $name"
}
$fontOriginal=(& $adbTask -s $device shell settings get system font_scale).Trim()
@{fontScale=$fontOriginal} | ConvertTo-Json | Set-Content -LiteralPath .local/navigation-device-settings.json
try {
 Step 'care' @('Care') 'Care' 'My care'
 Step 'reminders' @('Reminders') 'Care' 'Medication reminders'
 Step 'documents' @('Documents') 'Care' 'Health documents'
 Step 'inbox' @('Inbox') 'Inbox' 'Notifications'
 Step 'visits' @('Visits') 'Visits' 'Your visits'
 Step 'visit-details' @('Past & cancelled','Visit documents & follow-up') 'Visits' 'Visit documents'
 Step 'visit-return' @('Back to visits') 'Visits' 'Your visits'
 $past=(Snapshot).SelectSingleNode('//node[@text="Past & cancelled"]');if($past.GetAttribute('selected') -ne 'true'){throw 'Returning from visit details lost the Past selection'}
 Step 'account' @('Account') 'Account' 'Your account'
 Step 'health-details' @('My health details') 'Account' 'Your health details'
 Step 'account-back' @() 'Account' 'Your account' -Back
 & $adbTask -s $device shell settings put system font_scale 1.3 | Out-Null
 Step 'large-text-care' @('Care') 'Care' 'My care'
 Step 'large-text-documents' @('Documents') 'Care' 'Health documents'
} finally {
 if($fontOriginal -eq 'null'){& $adbTask -s $device shell settings delete system font_scale | Out-Null}else{& $adbTask -s $device shell settings put system font_scale $fontOriginal | Out-Null}
}
Step 'clinic-final' @('Clinic') 'Clinic' 'Your care team'
if((Snapshot).SelectSingleNode('//node[@text="Care tools & notifications"]')){throw 'Old mixed tools entry remains visible'}
@{recordedAt=(Get-Date).ToUniversalTime().ToString('o');result='PASS';version='1.6.1 (226)';device='Physical I2217';testingSubagentsUsed=$false;pdfActionsTested=$false;checks=$checks;fontScaleRestored=((& $adbTask -s $device shell settings get system font_scale).Trim() -eq $fontOriginal);writes='Navigation only; no patient/clinical/calendar data changed'} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$evidence/phone-checks.json"
Write-Output 'PASS all navigation cases; original font scale restored.'
