param(
 [ValidateSet('127.0.0.1','localhost')][string]$PostgresHost='127.0.0.1',
 [ValidateRange(1,65535)][int]$PostgresPort=5432,
 [ValidatePattern('^[a-z][a-z0-9_]{0,62}$')][string]$AdminUser='postgres',
 [string]$AdminEmail='admin@careslot.local',
 [string]$ClinicName='CareSlot Clinic',
 [switch]$Resume,
 [switch]$SkipDependencyInstall
)
$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectPath
$node=(Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion=& $node -p 'parseInt(process.versions.node)'
if($nodeVersion -ne '24'){throw 'Install Node.js 24 before running the initializer.'}
$arguments=@((Join-Path $PSScriptRoot 'initialize-local.cjs'),'--root',$projectPath,'--host',$PostgresHost,'--port',[string]$PostgresPort,'--admin',$AdminUser,'--email',$AdminEmail,'--clinic',$ClinicName)
if($Resume){$arguments+='--resume'}
$setupStatusJson=& $node @arguments --status
if($LASTEXITCODE){throw 'Fresh-install preflight failed. Existing files and database objects were preserved.'}
$setupStatus=$setupStatusJson | ConvertFrom-Json
if($setupStatus.complete){Write-Host 'This initializer already completed. Use setup-shared.ps1/start-local.ps1 for the existing installation.';return}
if(!$SkipDependencyInstall){
 Write-Host 'Installing the locked project dependencies before requesting administrator credentials.'
 & npm.cmd ci --include=dev
 if($LASTEXITCODE){throw 'Dependency installation failed. No PostgreSQL objects were created. Resolve the npm error and rerun.'}
}
if(!(Test-Path -LiteralPath (Join-Path $projectPath 'node_modules/pg/package.json'))){throw 'Dependencies are missing. Run npm.cmd ci or omit -SkipDependencyInstall.'}
Write-Host "Provision CareSlot in the existing PostgreSQL server at $PostgresHost`:$PostgresPort."
Write-Host 'The PostgreSQL administrator password is used only for this run and is never saved or printed.'
$secureSetupPassword=Read-Host "Password for PostgreSQL administrator $AdminUser" -AsSecureString
$passwordPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSetupPassword)
$setupOriginalEncoding=$OutputEncoding
try{
 $OutputEncoding=New-Object Text.UTF8Encoding($false)
 $plainSetupPassword=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
 $setupPayload=@{password=$plainSetupPassword} | ConvertTo-Json -Compress
 $setupPayload | & $node @arguments
 if($LASTEXITCODE){throw 'CareSlot setup did not complete. Read the error above; existing data was not deleted.'}
}finally{
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
 $OutputEncoding=$setupOriginalEncoding
 $plainSetupPassword=$null;$setupPayload=$null;$secureSetupPassword.Dispose()
}
