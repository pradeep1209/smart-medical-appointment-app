param(
  [Parameter(Mandatory=$true)][string]$Address,
  [switch]$TrustPrivateNetwork
)
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this setup script as administrator to configure the Windows Wi-Fi profile and the scoped firewall rule.' }
$parsed=$null
if (![Net.IPAddress]::TryParse($Address,[ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $parsed.ToString() -ne $Address) { throw 'Enter the computer Wi-Fi IPv4 address.' }
$bytes=$parsed.GetAddressBytes()
if (!($bytes[0] -eq 10 -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168))) { throw 'Only a private LAN address is supported.' }
$network=Get-NetIPAddress -AddressFamily IPv4 -IPAddress $Address | Where-Object { $_.InterfaceAlias -eq 'Wi-Fi' -and $_.AddressState -eq 'Preferred' }
if (@($network).Count -ne 1) { throw 'The supplied address must belong to the active Wi-Fi interface.' }
$profile=Get-NetConnectionProfile -InterfaceIndex $network.InterfaceIndex
if ($profile.NetworkCategory -ne 'Private') {
  if (!$TrustPrivateNetwork) { throw 'This Wi-Fi is not marked Private. Use -TrustPrivateNetwork only for your trusted network.' }
  Set-NetConnectionProfile -InterfaceIndex $network.InterfaceIndex -NetworkCategory Private
}
$projectPath=Split-Path -Parent $PSScriptRoot
$nodePath=(Get-Command node.exe).Source
$ruleName='CareSlot-Local-WiFi-API'
if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -Name $ruleName }
New-NetFirewallRule -Name $ruleName -DisplayName 'CareSlot API on trusted Wi-Fi' -Description 'Development mobile API only; private Wi-Fi interface and local subnet. No dashboard or PostgreSQL exposure.' -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP -LocalPort 3001 -LocalAddress $Address -RemoteAddress LocalSubnet -InterfaceAlias $network.InterfaceAlias -Program $nodePath -EdgeTraversalPolicy Block | Out-Null
$envPath=Join-Path $projectPath '.env'
if (!(Test-Path -LiteralPath $envPath)) { throw 'Existing private .env is required. No replacement environment was created.' }
$content=[IO.File]::ReadAllText($envPath)
foreach ($setting in @(@('API_HOST','0.0.0.0'),@('ALLOW_LAN_DEV','true'),@('API_LAN_ADDRESS',$Address))) {
  $pattern='(?m)^'+[regex]::Escape($setting[0])+'=.*$'
  $line=$setting[0]+'='+$setting[1]
  if ([regex]::IsMatch($content,$pattern)) { $content=[regex]::Replace($content,$pattern,$line) } else { $content=$content.TrimEnd()+[Environment]::NewLine+$line+[Environment]::NewLine }
}
[IO.File]::WriteAllText($envPath,$content,(New-Object Text.UTF8Encoding($false)))
$localPath=Join-Path $projectPath '.local'
New-Item -ItemType Directory -Force $localPath | Out-Null
[IO.File]::WriteAllText((Join-Path $localPath 'android-wifi.properties'),"careslotApiUrl=http://$Address`:3001/api/v1`n",(New-Object Text.UTF8Encoding($false)))
$out=Join-Path $projectPath 'qa/shared/wifi-sync'
New-Item -ItemType Directory -Force $out | Out-Null
@{recordedAt=(Get-Date).ToUniversalTime().ToString('o');address=$Address;interface=$network.InterfaceAlias;networkProfile='Private';firewallRule=$ruleName;apiPort=3001;remoteScope='LocalSubnet';portsOpenedBySetup=@(3001);postgresConfigurationChanged=$false;dashboardConfigurationChanged=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'network-setup.json')
Write-Output "Wi-Fi setup saved for $Address`:3001. Restart the API and build the Android debug APK with -PcareslotApiUrl=http://$Address`:3001/api/v1."
