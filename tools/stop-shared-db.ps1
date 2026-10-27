param([string]$PostgresBin='C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$dataPath=Join-Path $projectPath '.local/postgres/data'
if(-not(Test-Path -LiteralPath (Join-Path $dataPath 'PG_VERSION'))){'No project-local database cluster exists.';return}
$absoluteData=[IO.Path]::GetFullPath($dataPath)
$projectPrefix=[IO.Path]::GetFullPath($projectPath).TrimEnd('\')+'\'
if(-not $absoluteData.StartsWith($projectPrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'The legacy data directory must stay inside the project.'}
& (Join-Path $PostgresBin 'pg_ctl.exe') -D $absoluteData status *> $null
if($LASTEXITCODE -ne 0){'The legacy project cluster is already stopped. The shared PostgreSQL Windows service is unaffected.';return}
& (Join-Path $PostgresBin 'pg_ctl.exe') -D $dataPath -m fast -w stop
if($LASTEXITCODE -ne 0){throw 'The project-local cluster did not stop. Other PostgreSQL services were not targeted.'}
