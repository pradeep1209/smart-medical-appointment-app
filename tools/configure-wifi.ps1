param([string]$Address, [string[]]$InterfaceAlias, [switch]$TrustPrivateNetwork)
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this setup script as administrator to configure the trusted network and scoped firewall rules.' }
$projectPath=Split-Path -Parent $PSScriptRoot
$envPath=Join-Path $projectPath '.env'
if (!(Test-Path -LiteralPath $envPath)) { throw 'Existing private .env is required. Run initialize-local.ps1 for a fresh installation.' }
function Is-PrivateIpv4([string]$Value) {
 $parsed=$null
 if (![Net.IPAddress]::TryParse($Value,[ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $parsed.ToString() -ne $Value) { return $false }
 $b=$parsed.GetAddressBytes()
 return ($b[0] -eq 10 -or ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) -or ($b[0] -eq 192 -and $b[1] -eq 168))
}
$candidates=@(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' -and (Is-PrivateIpv4 $_.IPAddress) })
if ($Address) {
 if (!(Is-PrivateIpv4 $Address)) { throw 'Use the private IPv4 address of the computer running CareSlot.' }
 $candidates=@($candidates | Where-Object IPAddress -EQ $Address)
} elseif ($InterfaceAlias) {
 $candidates=@($candidates | Where-Object { $_.InterfaceAlias -in $InterfaceAlias })
} else {
 # Include Windows Wi-Fi Direct adapters used by Mobile Hotspot, as well as ordinary Wi-Fi.
 $wireless=@(Get-NetAdapter -IncludeHidden | Where-Object { $_.Status -eq 'Up' -and ($_.Name -eq 'Wi-Fi' -or $_.InterfaceDescription -match 'Wireless|Wi-Fi|WiFi|802\.11') } | Select-Object -ExpandProperty InterfaceIndex)
 $candidates=@($candidates | Where-Object { $_.InterfaceIndex -in $wireless })
}
if (!$candidates.Count) { throw 'No active private Wi-Fi/hotspot address found. Connect the devices, or supply -InterfaceAlias with the network adapter name.' }
$aliases=@($candidates | Select-Object -ExpandProperty InterfaceAlias -Unique)
if ($aliases.Count -gt 8 -or @($aliases | Where-Object { $_ -match '[\r\n]' -or $_.Length -gt 128 }).Count) { throw 'Unsupported network adapter names.' }
foreach ($index in @($candidates | Select-Object -ExpandProperty InterfaceIndex -Unique)) {
 $profile=Get-NetConnectionProfile -InterfaceIndex $index -ErrorAction SilentlyContinue
 if ($profile -and $profile.NetworkCategory -ne 'Private') {
  if (!$TrustPrivateNetwork) { throw 'A selected network is not Private. Use -TrustPrivateNetwork only for a trusted network.' }
  Set-NetConnectionProfile -InterfaceIndex $index -NetworkCategory Private
 }
}
$nodePath=(Get-Command node.exe).Source
$common=@{Direction='Inbound';Action='Allow';Enabled='True';Profile='Private';RemoteAddress='LocalSubnet';InterfaceAlias=$aliases;Program=$nodePath;EdgeTraversalPolicy='Block'}
foreach ($name in @('CareSlot-Local-WiFi-API','CareSlot-Local-Discovery')) { if (Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -Name $name } }
New-NetFirewallRule @common -Name 'CareSlot-Local-WiFi-API' -DisplayName 'CareSlot API on trusted local network' -Protocol TCP -LocalPort 3001 | Out-Null
New-NetFirewallRule @common -Name 'CareSlot-Local-Discovery' -DisplayName 'CareSlot local discovery' -Protocol UDP -LocalPort 3002,5353 | Out-Null
$content=[IO.File]::ReadAllText($envPath)
$interfaceJson=ConvertTo-Json -InputObject $aliases -Compress
foreach ($setting in @(@('API_HOST','0.0.0.0'),@('ALLOW_LAN_DEV','true'),@('API_LAN_ADDRESS','auto'),@('API_LAN_INTERFACES',$interfaceJson))) {
 $pattern='(?m)^'+[regex]::Escape($setting[0])+'=.*$'
 $line=$setting[0]+'='+$setting[1]
 if ([regex]::IsMatch($content,$pattern)) { $content=[regex]::Replace($content,$pattern,[Text.RegularExpressions.MatchEvaluator]{ param($m) $line }) } else { $content=$content.TrimEnd()+[Environment]::NewLine+$line+[Environment]::NewLine }
}
[IO.File]::WriteAllText($envPath,$content,(New-Object Text.UTF8Encoding($false)))
$localPath=Join-Path $projectPath '.local'
New-Item -ItemType Directory -Force $localPath | Out-Null
[IO.File]::WriteAllText((Join-Path $localPath 'android-wifi.properties'),"careslotApiUrl=http://$($candidates[0].IPAddress):3001/api/v1`n",(New-Object Text.UTF8Encoding($false)))
Write-Output ('Trusted network adapters: '+($aliases -join ', '))
foreach ($candidate in $candidates) { Write-Output "Current clinic address: http://$($candidate.IPAddress):3001/api/v1" }
Write-Output 'Restart the API after this first setup. CareSlot 1.7 discovers this server at runtime; future IP changes on these adapters do not require rebuilding the APK.'
Write-Output 'PostgreSQL and the dashboard remain local. Discovery uses UDP 3002/5353; API uses TCP 3001 on Private/local-subnet networks only.'
