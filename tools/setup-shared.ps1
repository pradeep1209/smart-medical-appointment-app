param([string]$PostgresBin='C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$envPath=Join-Path $projectPath '.env'
if(-not(Test-Path -LiteralPath $envPath)){throw 'For a fresh installation, run .\tools\initialize-local.ps1 to create the database, roles and private configuration. Existing installations should retain their .env; legacy prototype transfers use migrate-to-service.ps1.'}
$settings=@{}
foreach($line in Get-Content -LiteralPath $envPath){if($line -match '^([A-Z_]+)=(.*)$'){$settings[$Matches[1]]=$Matches[2]}}
$uri=[Uri]$settings['DATABASE_URL']
if($uri.Port -eq 55432){throw 'The legacy project-local database is still configured. Run .\tools\migrate-to-service.ps1 to transfer it to the Windows PostgreSQL service.'}
$psql=Join-Path $PostgresBin 'psql.exe'
if(-not(Test-Path -LiteralPath $psql)){throw 'Supply -PostgresBin with the PostgreSQL bin directory.'}
$previousPassword=$env:PGPASSWORD
try {
    $env:PGPASSWORD=[Uri]::UnescapeDataString($uri.UserInfo.Split(':',2)[1])
    & $psql -X -w -h $uri.Host -p $uri.Port -U ([Uri]::UnescapeDataString($uri.UserInfo.Split(':',2)[0])) -d $uri.AbsolutePath.TrimStart('/') -v ON_ERROR_STOP=1 -Atc 'SELECT current_database();'
    if($LASTEXITCODE -ne 0){throw 'Could not connect. Check that the Windows PostgreSQL service is running and that .env contains its application credentials.'}
} finally {$env:PGPASSWORD=$previousPassword}
"CareSlot connects to PostgreSQL at $($uri.Host):$($uri.Port)/$($uri.AbsolutePath.TrimStart('/')). This helper does not start or stop the shared Windows service."
