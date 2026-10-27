param(
    [string]$PostgresBin='C:\Program Files\PostgreSQL\18\bin',
    [ValidateSet('127.0.0.1','localhost')][string]$TargetHost='127.0.0.1',
    [ValidateRange(1,65535)][int]$TargetPort=5432,
    [ValidatePattern('^[a-z][a-z0-9_]{0,62}$')][string]$AdminUser='postgres',
    [ValidatePattern('^[a-z][a-z0-9_]{0,62}$')][string]$TargetDatabase='careslot',
    [switch]$Hold
)
$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$envPath=Join-Path $projectPath '.env'
$localPath=Join-Path $projectPath '.local'
$sourceData=Join-Path $localPath 'postgres/data'
$backupPath=$null
$sourceFrozen=$false
$sourceStopped=$false
$switched=$false
$previousPassword=$env:PGPASSWORD
$previousOptions=$env:PGOPTIONS
$previousEncoding=$env:PGCLIENTENCODING
$env:PGCLIENTENCODING='UTF8'
$env:PGOPTIONS='-c timezone=UTC -c datestyle=ISO,YMD -c extra_float_digits=3'

function Write-PrivateText([string]$path,[string]$value){[IO.File]::WriteAllText($path,$value,(New-Object Text.UTF8Encoding($false)))}
function Invoke-Sql([string]$dbHost,[int]$port,[string]$user,[string]$password,[string]$database,[string]$sql) {
    $oldPassword=$env:PGPASSWORD
    try {
        $env:PGPASSWORD=$password
        $output=$sql | & (Join-Path $PostgresBin 'psql.exe') -X -w -h $dbHost -p $port -U $user -d $database -v ON_ERROR_STOP=1 -qAt
        if($LASTEXITCODE -ne 0){throw "PostgreSQL operation failed on ${dbHost}:$port/$database. Review migration status before retrying."}
        return @($output)
    } finally {$env:PGPASSWORD=$oldPassword}
}
function Source-Sql([string]$sql){Invoke-Sql $sourceUri.Host $sourceUri.Port 'careslot_owner' $ownerPassword 'careslot' $sql}
function Target-Sql([string]$database,[string]$sql){Invoke-Sql $TargetHost $TargetPort $AdminUser $adminPassword $database $sql}
function Manifest([string]$dbHost,[int]$port,[string]$user,[string]$password,[string]$database) {
    $tables=Invoke-Sql $dbHost $port $user $password $database "SELECT quote_ident(schemaname)||'.'||quote_ident(tablename) FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
    $result=[ordered]@{}
    foreach($table in $tables){
        if($table -notmatch '^public\."?[A-Za-z_][A-Za-z0-9_]*"?$'){throw 'An unexpected table identifier requires manual database migration.'}
        $query="SELECT count(*)::text || ':' || md5(COALESCE(string_agg(row_to_json(t)::text, E'\n' ORDER BY row_to_json(t)::text COLLATE `"C`"), '')) FROM $table t;"
        $result[$table]=(Invoke-Sql $dbHost $port $user $password $database $query) -join ''
    }
    return $result
}
function Save-Status([string]$state,[hashtable]$extra=@{}) {
    $status=[ordered]@{state=$state; recordedAt=(Get-Date).ToUniversalTime().ToString('o'); source='127.0.0.1:55432/careslot'; target="${TargetHost}:$TargetPort/$TargetDatabase"; backupDirectory=if($backupPath){'.local/database-backups/'+(Split-Path -Leaf $backupPath)}else{$null}; activeEnvironmentSwitched=$switched; legacyClusterStopped=$sourceStopped; databaseCredentialsLogged=$false}
    foreach($key in $extra.Keys){$status[$key]=$extra[$key]}
    Write-PrivateText (Join-Path $localPath 'service-migration.json') ($status | ConvertTo-Json -Depth 6)
}

try {
    foreach($binary in @('psql.exe','pg_dump.exe','pg_restore.exe','createdb.exe','pg_ctl.exe')){
        if(-not(Test-Path -LiteralPath (Join-Path $PostgresBin $binary))){throw "Missing PostgreSQL binary: $binary"}
    }
    if(-not(Test-Path -LiteralPath $envPath)){throw 'The original .env is required to preserve existing database credentials and records.'}
    $lines=Get-Content -LiteralPath $envPath
    $settings=@{}
    foreach($line in $lines){if($line -match '^([A-Z_]+)=(.*)$'){$settings[$Matches[1]]=$Matches[2]}}
    $sourceUri=[Uri]$settings['MIGRATION_DATABASE_URL']
    $appUri=[Uri]$settings['DATABASE_URL']
    if($sourceUri.Host -eq $TargetHost -and $sourceUri.Port -eq $TargetPort -and $sourceUri.AbsolutePath -eq "/$TargetDatabase"){
        & (Join-Path $PSScriptRoot 'setup-shared.ps1') -PostgresBin $PostgresBin
        'Already configured for the selected PostgreSQL service. No database was overwritten.'
        return
    }
    if($sourceUri.Host -ne '127.0.0.1' -or $sourceUri.Port -ne 55432 -or $sourceUri.AbsolutePath -ne '/careslot' -or $appUri.Host -ne '127.0.0.1' -or $appUri.Port -ne 55432 -or $appUri.AbsolutePath -ne '/careslot'){
        throw 'This transfer only accepts the original project-local careslot database on 127.0.0.1:55432. No connection settings were changed.'
    }
    if($TargetPort -eq 55432){throw 'Choose the Windows service port, not the source cluster port.'}
    if($sourceUri.UserInfo.Split(':',2)[0] -ne 'careslot_owner' -or $appUri.UserInfo.Split(':',2)[0] -ne 'careslot_app'){throw 'The original dedicated role names are required.'}
    $ownerPassword=[Uri]::UnescapeDataString($sourceUri.UserInfo.Split(':',2)[1])
    $appPassword=[Uri]::UnescapeDataString($appUri.UserInfo.Split(':',2)[1])
    if($ownerPassword -notmatch '^[0-9a-f]{64}$' -or $appPassword -notmatch '^[0-9a-f]{64}$'){throw 'The original generated application credentials are required; custom credentials require a reviewed transfer.'}
    if(-not(Test-Path -LiteralPath (Join-Path $sourceData 'PG_VERSION'))){throw 'The legacy data directory is missing. Restore it before transferring.'}
    $resolvedSource=[IO.Path]::GetFullPath($sourceData)
    $workspacePrefix=[IO.Path]::GetFullPath($projectPath).TrimEnd('\')+'\'
    if(-not($resolvedSource.StartsWith($workspacePrefix,[StringComparison]::OrdinalIgnoreCase))){throw 'The legacy data directory must be inside this workspace.'}
    & (Join-Path $PostgresBin 'pg_ctl.exe') -D $resolvedSource status *> $null
    if($LASTEXITCODE -ne 0){
        $logPath=Join-Path $localPath 'postgres/server.log'
        $started=Start-Process -FilePath (Join-Path $PostgresBin 'pg_ctl.exe') -ArgumentList @('-D',('"{0}"' -f $resolvedSource),'-l',('"{0}"' -f $logPath),'-o','"-p 55432 -h 127.0.0.1"','-w','start') -WindowStyle Hidden -PassThru
        $started.WaitForExit()
        if($started.ExitCode -ne 0){throw 'Could not start the legacy source database.'}
    }
    if(((Source-Sql 'SHOW default_transaction_read_only;') -join '') -ne 'off'){throw 'The source database is already read-only; review the previous migration status before retrying.'}
    $others="SELECT count(*) FROM pg_stat_activity WHERE datname='careslot' AND pid<>pg_backend_pid() AND backend_type='client backend';"
    if([int]((Source-Sql $others) -join '') -ne 0){throw 'Close the CareSlot API and disconnect the old CareSlot Local connection in pgAdmin, then rerun. The transfer needs an idle source database.'}
    Write-Host "Transfer CareSlot to the existing PostgreSQL service at ${TargetHost}:$TargetPort."
    Write-Host 'The existing postgres administrator password is only used in this process; it is not saved or changed.'
    Save-Status 'AWAITING_ADMIN_PASSWORD'
    $securePassword=Read-Host "Password for PostgreSQL administrator $AdminUser" -AsSecureString
    $passwordPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {$adminPassword=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)}
    if(((Target-Sql 'postgres' 'SELECT rolsuper FROM pg_roles WHERE rolname=current_user;') -join '') -ne 't'){throw 'Use a PostgreSQL administrator account to create the dedicated database and roles.'}
    if([int]((Target-Sql 'postgres' "SELECT count(*) FROM pg_database WHERE datname='$TargetDatabase';") -join '') -ne 0){throw "The target database '$TargetDatabase' already exists. Nothing will be overwritten; choose a different -TargetDatabase or review it manually."}
    if([int]((Target-Sql 'postgres' "SELECT count(*) FROM pg_roles WHERE rolname IN ('careslot_owner','careslot_app');") -join '') -ne 0){throw 'CareSlot role names already exist in the target service. Nothing will be reset; review those roles before retrying.'}
    $backupPath=Join-Path $localPath ('database-backups/'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
    Copy-Item -LiteralPath $envPath -Destination (Join-Path $backupPath 'before.env')
    Save-Status 'BACKING_UP'
    # New source connections become read-only; reject any existing connection that could still write.
    Source-Sql 'ALTER DATABASE careslot SET default_transaction_read_only=on;' | Out-Null
    $sourceFrozen=$true
    if([int]((Source-Sql $others) -join '') -ne 0){throw 'Another source connection appeared. Close the API and pgAdmin source connection before retrying.'}
    $sourceManifest=Manifest $sourceUri.Host $sourceUri.Port 'careslot_owner' $ownerPassword 'careslot'
    Write-PrivateText (Join-Path $backupPath 'source-manifest.json') ($sourceManifest | ConvertTo-Json)
    $env:PGPASSWORD=$ownerPassword
    $dumpPath=Join-Path $backupPath 'careslot.dump'
    & (Join-Path $PostgresBin 'pg_dump.exe') -w -h $sourceUri.Host -p $sourceUri.Port -U careslot_owner -d careslot --format=custom --no-owner --no-privileges --file=$dumpPath
    if($LASTEXITCODE -ne 0){throw 'Source backup failed; the active .env was preserved.'}
    $sourceAgain=Manifest $sourceUri.Host $sourceUri.Port 'careslot_owner' $ownerPassword 'careslot'
    if(($sourceManifest | ConvertTo-Json -Compress) -ne ($sourceAgain | ConvertTo-Json -Compress)){throw 'Source records changed during backup. The active .env was preserved.'}
    Save-Status 'RESTORING'
    $roles=@"
BEGIN;
CREATE ROLE careslot_owner LOGIN PASSWORD '$ownerPassword' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE careslot_app LOGIN PASSWORD '$appPassword' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
COMMIT;
"@
    Target-Sql 'postgres' $roles | Out-Null
    $env:PGPASSWORD=$adminPassword
    & (Join-Path $PostgresBin 'createdb.exe') -w -h $TargetHost -p $TargetPort -U $AdminUser -O careslot_owner --template=template0 --encoding=UTF8 --locale=C $TargetDatabase
    if($LASTEXITCODE -ne 0){throw 'Could not create the dedicated target database. No existing database was overwritten.'}
    & (Join-Path $PostgresBin 'pg_restore.exe') -w -h $TargetHost -p $TargetPort -U $AdminUser -d $TargetDatabase --role=careslot_owner --no-owner --no-privileges --exit-on-error --single-transaction $dumpPath
    if($LASTEXITCODE -ne 0){throw 'Restore failed; the target is not active. Keep the backup and inspect service-migration.json before retrying.'}
    $permissions=@"
REVOKE ALL ON DATABASE $TargetDatabase FROM PUBLIC;
GRANT CONNECT ON DATABASE $TargetDatabase TO careslot_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO careslot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO careslot_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO careslot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE careslot_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO careslot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE careslot_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO careslot_app;
"@
    Target-Sql $TargetDatabase $permissions | Out-Null
    $targetManifest=Manifest $TargetHost $TargetPort 'careslot_app' $appPassword $TargetDatabase
    Write-PrivateText (Join-Path $backupPath 'target-manifest.json') ($targetManifest | ConvertTo-Json)
    if(($sourceManifest | ConvertTo-Json -Compress) -ne ($targetManifest | ConvertTo-Json -Compress)){throw 'Source and target table data do not match. The active .env was preserved.'}
    # Stop only the old project-owned server, never the shared Windows PostgreSQL service.
    & (Join-Path $PostgresBin 'pg_ctl.exe') -D $resolvedSource -m fast -w stop
    if($LASTEXITCODE -ne 0){throw 'Could not stop the old project cluster. The connection switch was not performed.'}
    $sourceStopped=$true
    $newLines=foreach($line in $lines){
        if($line -match '^DATABASE_URL='){"DATABASE_URL=postgresql://careslot_app:$appPassword@${TargetHost}:$TargetPort/$TargetDatabase"}
        elseif($line -match '^MIGRATION_DATABASE_URL='){"MIGRATION_DATABASE_URL=postgresql://careslot_owner:$ownerPassword@${TargetHost}:$TargetPort/$TargetDatabase"}
        else {$line}
    }
    $newEnv=Join-Path $backupPath 'after.env'
    Write-PrivateText $newEnv (($newLines -join "`n")+"`n")
    Copy-Item -LiteralPath $envPath -Destination (Join-Path $backupPath 'before-final-switch.env') -ErrorAction Stop
    Copy-Item -LiteralPath $newEnv -Destination $envPath -Force -ErrorAction Stop
    if([IO.File]::ReadAllText($envPath) -cne [IO.File]::ReadAllText($newEnv)){throw 'Connection file verification failed. Restore before-final-switch.env before starting the API.'}
    $switched=$true
    Save-Status 'COMPLETE' @{dataVerification='All public tables match: row counts and ordered row-content hashes'; tables=$targetManifest; dumpSha256=(Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash.ToLowerInvariant()}
    Write-Host "Migration complete: ${TargetHost}:$TargetPort/$TargetDatabase" -ForegroundColor Green
    Write-Host 'Records, passwords, IDs, sessions, and migration history were preserved. The old cluster is stopped; its files and backup remain available.'
    Write-Host 'Restart the API to use the new connection. In pgAdmin, connect using the service port and the credentials from .env.'
} catch {
    if($sourceFrozen -and -not $sourceStopped -and -not $switched){
        $restoreOptions=$env:PGOPTIONS
        try {
            $env:PGOPTIONS='-c default_transaction_read_only=off'
            Source-Sql 'ALTER DATABASE careslot RESET default_transaction_read_only;' | Out-Null
        } catch {Write-Warning 'Could not unfreeze the source. Use the recovery instructions before resuming the old service.'}
        finally {$env:PGOPTIONS=$restoreOptions}
    }
    if(Test-Path -LiteralPath $localPath){Save-Status 'NEEDS_REVIEW' @{error='Migration stopped. Read the console error. No target database or role was automatically deleted.'}}
    Write-Error $_.Exception.Message -ErrorAction Continue
    if($sourceStopped -and -not $switched){Write-Warning 'The old cluster was stopped before the environment switch failed. Its data and original .env remain; follow the recovery instructions.'}
    exit 1
} finally {
    $env:PGPASSWORD=$previousPassword
    $env:PGOPTIONS=$previousOptions
    $env:PGCLIENTENCODING=$previousEncoding
    $adminPassword=$null
    if($securePassword){$securePassword.Dispose()}
    if($Hold){Read-Host 'Press Enter to close this window' | Out-Null}
}
