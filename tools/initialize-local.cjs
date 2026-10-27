// Fresh local provisioning. PostgreSQL administrator credentials arrive only over stdin.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const hex=n=>crypto.randomBytes(n).toString('hex');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const identifier=s=>{if(!/^[a-z][a-z0-9_]{0,62}$/.test(s))throw Error('Invalid PostgreSQL identifier.');return '"'+s+'"';};
const safeParse=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('The private setup journal cannot be read. Preserve it for recovery; no objects were changed.');}};
function paths(root){root=path.resolve(root);return {root,env:path.join(root,'.env'),dir:path.join(root,'.local','initial-setup'),journal:path.join(root,'.local','initial-setup','state.json'),lock:path.join(root,'.local','initial-setup','lock.json'),account:path.join(root,'.local','bootstrap-account.txt')};}
function noLink(p){if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Setup refuses redirected configuration directories or files.');}
function options(o){
 const p=paths(o.root);for(const f of [p.root,path.join(p.root,'.local'),p.dir,p.env,p.account])noLink(f);
 if(!['127.0.0.1','localhost'].includes(o.host)||!Number.isInteger(o.port)||o.port<1||o.port>65535)throw Error('Use a loopback PostgreSQL address and valid port.');
 identifier(o.admin);if(['careslot_app','careslot_owner'].includes(o.admin))throw Error('Use the PostgreSQL administrator account.');
 if(!/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(o.email)||o.email.length>254)throw Error('Enter a valid bootstrap administrator email.');
 if(!o.clinic.trim()||o.clinic.length>120||/[\r\n#"\\]/.test(o.clinic))throw Error('Use a clinic name of 1–120 characters without line breaks, #, double quotes or backslashes.');
 if(!fs.existsSync(path.join(p.root,'package.json'))||!fs.existsSync(path.join(p.root,'apps/api/prisma/schema.prisma')))throw Error('Run setup from the extracted CareSlot project.');
 return p;
}
function preflight(o){
 const p=options(o);const hasJournal=fs.existsSync(p.journal);
 if(!o.resume){if(fs.existsSync(p.env))throw Error('An existing .env was found. Fresh setup will not overwrite it. Use setup-shared.ps1 for connection checks.');if(hasJournal)throw Error('An incomplete setup journal exists. Rerun with -Resume to verify and continue it.');if(fs.existsSync(p.account))throw Error('An existing bootstrap account note was found. Preserve it and review before fresh setup.');return {paths:p,state:null,complete:false};}
 if(!hasJournal)throw Error('There is no initializer journal to resume. Existing installations must use setup-shared.ps1.');
 const s=safeParse(p.journal);
 if(s.kind!=='careslot-fresh-install'||s.schema!==1||s.root!==p.root||s.host!==o.host||s.port!==o.port||s.admin!==o.admin||s.email!==o.email.toLowerCase()||s.clinic!==o.clinic.trim())throw Error('Resume options do not match this installation journal. Use the same host, port, administrator, email and clinic name.');
 for(const [name,size]of[['ownerPassword',64],['appPassword',64],['jwtSecret',96],['bootstrapPassword',48],['marker',64]])if(typeof s[name]!=='string'||!new RegExp(`^[a-f0-9]{${size}}$`).test(s[name]))throw Error('Private setup journal is invalid. No database objects were changed.');
 if(s.phase!=='COMPLETE'&&fs.existsSync(p.env)&&fs.readFileSync(p.env,'utf8')!==environment(s))throw Error('The .env differs from the initializer configuration. It will not be overwritten.');
 return {paths:p,state:s,complete:s.phase==='COMPLETE'};
}
let windowsSid;
function restrict(target,directory=false){
 if(process.platform!=='win32'){fs.chmodSync(target,directory?0o700:0o600);return;}
 if(!windowsSid){const who=spawnSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});windowsSid=who.stdout?.match(/S-1-[0-9-]+/)?.[0];if(!windowsSid)throw Error('Unable to identify the local user for private setup permissions.');}
 const suffix=directory?'(OI)(CI)F':'F';const acl=spawnSync('icacls.exe',[target,'/inheritance:r','/grant:r',`*${windowsSid}:${suffix}`,`*S-1-5-18:${suffix}`],{windowsHide:true,stdio:'ignore'});if(acl.status!==0)throw Error('Unable to restrict permissions on private setup files.');
}
function privateFile(file,text,exclusive=false){noLink(file);const fd=fs.openSync(file,exclusive?'wx':'r+',0o600);try{restrict(file);fs.ftruncateSync(fd,0);fs.writeFileSync(fd,text,{encoding:'utf8'});fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(p,s){const temp=path.join(p.dir,`state-${hex(8)}.tmp`);privateFile(temp,JSON.stringify(s,null,2)+'\n',true);fs.renameSync(temp,p.journal);}
function environment(s){return [
 'NODE_ENV=development','API_PORT=3001','API_HOST=127.0.0.1','ALLOW_LAN_DEV=false','WEB_ORIGIN=http://localhost:3000','WEB_PUBLIC_URL=http://localhost:3000',
 `DATABASE_URL=postgresql://careslot_app:${s.appPassword}@${s.host}:${s.port}/careslot`,`MIGRATION_DATABASE_URL=postgresql://careslot_owner:${s.ownerPassword}@${s.host}:${s.port}/careslot`,
 `JWT_SECRET=${s.jwtSecret}`,'COOKIE_SECURE=false',`BOOTSTRAP_ADMIN_EMAIL=${s.email}`,`BOOTSTRAP_ADMIN_PASSWORD=${s.bootstrapPassword}`,`CLINIC_NAME=${s.clinic}`,'ATTENDANCE_MODEL_ENABLED=true','',
 ].join('\n');}
function childEnvironment(s){const env={...process.env};for(const line of environment(s).split('\n')){const i=line.indexOf('=');if(i>0)env[line.slice(0,i)]=line.slice(i+1);}delete env.PGPASSWORD;delete env.PGSERVICE;delete env.PGOPTIONS;return env;}
function redact(text,s){let result=String(text);for(const key of ['ownerPassword','appPassword','jwtSecret','bootstrapPassword'])result=result.replaceAll(s[key],'[redacted]');return result.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi,'$1[redacted]@');}
function commandResult(r,script,s){const output=redact((r.stdout||'')+(r.stderr||''),s);if(output)process.stdout.write(output);if(r.status!==0||r.error)throw Error(`${script} failed. Its generated credentials are retained privately; fix the reported issue and rerun with -Resume.`);}
async function freshMigrations(root,env,s){
 // Historical rollout applied these two migrations in dependency order, but their
 // names sort the constraint before the table. Never edit applied SQL/checksums.
 const original='20261025_prediction_constraints',ordered='20261025_t_prediction_constraints';
 const {Client}=require('pg'),client=new Client({connectionString:env.MIGRATION_DATABASE_URL});await client.connect();
 try{
  const target=(await client.query("SELECT oid,datdba,shobj_description(oid,'pg_database') AS comment FROM pg_database WHERE datname=current_database()")).rows[0];
  if(target.oid!==s.databaseOid||target.datdba!==s.careslot_owner||target.comment!==`CareSlot initializer ${s.marker}`)throw Error('Migration target is not the database created by this initializer.');
  const present=(await client.query("SELECT to_regclass('public.\"_prisma_migrations\"') AS table_name")).rows[0].table_name;
  if(present&&(await client.query('SELECT 1 FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL',[original])).rowCount)return false;
  const work=path.join(s.root,'.local','initial-setup','ordered-deploy'),migrationRoot=path.join(work,'migrations');noLink(work);noLink(migrationRoot);fs.mkdirSync(migrationRoot,{recursive:true});
  const source=path.join(root,'apps/api/prisma/migrations');
  for(const item of fs.readdirSync(source,{withFileTypes:true})){if(!item.isDirectory())continue;const to=path.join(migrationRoot,item.name===original?ordered:item.name);noLink(to);fs.mkdirSync(to,{recursive:true});fs.copyFileSync(path.join(source,item.name,'migration.sql'),path.join(to,'migration.sql'));}
  fs.copyFileSync(path.join(source,'migration_lock.toml'),path.join(migrationRoot,'migration_lock.toml'));
  const config=path.join(work,'prisma.config.ts');fs.writeFileSync(config,`import {defineConfig} from 'prisma/config';\nexport default defineConfig({schema:${JSON.stringify(path.join(root,'apps/api/prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrationRoot)}},datasource:{url:process.env.MIGRATION_DATABASE_URL!}});\n`);
  const cli=path.join(path.dirname(require.resolve('prisma/package.json')),'build/index.js');
  commandResult(spawnSync(process.execPath,[cli,'migrate','deploy','--config',config],{cwd:root,env,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024}),'db:migrate',s);
  const sourceHash=hash(fs.readFileSync(path.join(source,original,'migration.sql')));
  await client.query('BEGIN');try{
   const record=(await client.query('SELECT id,checksum FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL FOR UPDATE',[ordered])).rows;
   if(record.length!==1||record[0].checksum!==sourceHash)throw Error('Initial constraint migration checksum did not match its original SQL.');
   await client.query('UPDATE "_prisma_migrations" SET migration_name=$1 WHERE id=$2',[original,record[0].id]);await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}
  console.log('Initial migration dependency order verified; canonical migration names/checksums retained.');return true;
 }finally{await client.end();}
}
async function runProjectScript(script,root,env,s){
 if(!['db:generate','db:migrate','db:seed'].includes(script))throw Error('Unexpected setup command.');
 if(script==='db:migrate'&&await freshMigrations(root,env,s))return;
 const command=process.platform==='win32'?(process.env.ComSpec||'cmd.exe'):'npm';const args=process.platform==='win32'?['/d','/s','/c',`npm.cmd run ${script}`]:['run',script];
 const r=spawnSync(command,args,{cwd:root,env,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
 commandResult(r,script,s);
}
async function initialize(o,adminPassword,hooks={}){
 const {paths:p,state:previous,complete}=preflight(o);if(complete)return {alreadyComplete:true};
 if(!adminPassword)throw Error('A PostgreSQL administrator password is required.');
 const {Client}=require('pg');
 fs.mkdirSync(p.dir,{recursive:true});restrict(p.dir,true);
 let lockToken=hex(16),admin,owner,s=previous;
 if(fs.existsSync(p.lock)){noLink(p.lock);const lock=safeParse(p.lock);let alive=true;try{process.kill(lock.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}if(alive)throw Error('Another initializer is running, or its recorded process still exists. Nothing was changed.');fs.unlinkSync(p.lock);}
 privateFile(p.lock,JSON.stringify({pid:process.pid,token:lockToken}),true);
 const connect=async(user,password,database='postgres')=>{const c=new Client({host:o.host,port:o.port,user,password,database,connectionTimeoutMillis:7000,application_name:'CareSlot fresh initializer'});try{await c.connect();return c;}catch{await c.end().catch(()=>{});throw Error('Could not authenticate to local PostgreSQL. Check the service, host/port, account and password.');}};
 try{
  admin=await connect(o.admin,adminPassword);adminPassword=null;
  if(!(await admin.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0]?.rolsuper)throw Error('This one-time provisioning step requires a PostgreSQL administrator.');
  const locked=(await admin.query("SELECT pg_try_advisory_lock(713642109) AS acquired")).rows[0].acquired;if(!locked)throw Error('Another CareSlot initializer holds the database setup lock. Try again when it finishes.');
  if(!s){
   const collisions=(await admin.query("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='careslot') OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('careslot_owner','careslot_app')) AS found")).rows[0].found;
   if(collisions)throw Error('CareSlot database or role names already exist. No database, password, role or environment file was changed. Review the existing installation.');
   s={kind:'careslot-fresh-install',schema:1,root:p.root,host:o.host,port:o.port,admin:o.admin,email:o.email.toLowerCase(),clinic:o.clinic.trim(),ownerPassword:hex(32),appPassword:hex(32),jwtSecret:hex(48),bootstrapPassword:hex(24),marker:hex(32),phase:'PREPARED',createdAt:new Date().toISOString()};save(p,s);
  }
  const marker=`CareSlot initializer ${s.marker}`;
  async function role(name,password){
   const q=identifier(name),found=(await admin.query('SELECT oid,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolcanlogin,shobj_description(oid,\'pg_authid\') AS comment FROM pg_roles WHERE rolname=$1',[name])).rows[0];
   if(found){if(found.comment!==marker||found.rolsuper||found.rolcreatedb||found.rolcreaterole||found.rolreplication||found.rolbypassrls||!found.rolcanlogin||(s[name]&&s[name]!==found.oid))throw Error('An existing role does not match this setup journal. Its password/permissions were not changed.');}
   else {await admin.query('BEGIN');try{await admin.query(`CREATE ROLE ${q} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);await admin.query(`COMMENT ON ROLE ${q} IS '${marker}'`);await admin.query('COMMIT');}catch(e){await admin.query('ROLLBACK');throw e;}}
   s[name]=(await admin.query('SELECT oid FROM pg_roles WHERE rolname=$1',[name])).rows[0].oid;save(p,s);
  }
  console.log('Creating/verifying the dedicated local roles.');await role('careslot_owner',s.ownerPassword);await role('careslot_app',s.appPassword);
  const foundDb=(await admin.query("SELECT oid,datdba,shobj_description(oid,'pg_database') AS comment FROM pg_database WHERE datname='careslot'")).rows[0];
  if(foundDb){if(foundDb.datdba!==s.careslot_owner||(s.databaseOid&&foundDb.oid!==s.databaseOid)||(foundDb.comment!==marker&&!(s.phase==='DATABASE_CREATING'&&!s.databaseOid)))throw Error('An existing database does not match this setup journal. It was not modified.');}
  else {s.phase='DATABASE_CREATING';save(p,s);await admin.query('CREATE DATABASE careslot OWNER careslot_owner TEMPLATE template0 ENCODING \'UTF8\' LOCALE_PROVIDER libc LC_COLLATE \'C\' LC_CTYPE \'C\'');}
  await admin.query(`COMMENT ON DATABASE careslot IS '${marker}'`);s.databaseOid=(await admin.query("SELECT oid FROM pg_database WHERE datname='careslot'")).rows[0].oid;s.phase='DATABASE_CREATED';save(p,s);
  owner=await connect('careslot_owner',s.ownerPassword,'careslot');
  await owner.query(`REVOKE ALL ON DATABASE careslot FROM PUBLIC; GRANT CONNECT ON DATABASE careslot TO careslot_app; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO careslot_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO careslot_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO careslot_app; ALTER DEFAULT PRIVILEGES FOR ROLE careslot_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO careslot_app; ALTER DEFAULT PRIVILEGES FOR ROLE careslot_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO careslot_app;`);
  await owner.end();owner=null;
  if(!fs.existsSync(p.env))privateFile(p.env,environment(s),true);else if(fs.readFileSync(p.env,'utf8')!==environment(s))throw Error('The environment file changed during setup. It was not overwritten.');
  const note=`CareSlot local administrator\nEmail: ${s.email}\nPassword: ${s.bootstrapPassword}\n\nKeep this file and .env private. Do not include .local or .env in a shared ZIP.\n`;
  if(!fs.existsSync(p.account))privateFile(p.account,note,true);else if(fs.readFileSync(p.account,'utf8')!==note)throw Error('The existing administrator note differs. It was not overwritten.');
  s.phase='CONFIGURED';save(p,s);const runner=hooks.runProjectScript||runProjectScript;
  for(const script of ['db:generate','db:migrate','db:seed']){console.log(`Running ${script}.`);await runner(script,p.root,childEnvironment(s),s);s.phase=script;save(p,s);}
  const app=await connect('careslot_app',s.appPassword,'careslot');try{
   const r=(await app.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];if(r.rolsuper||r.rolcreatedb||r.rolcreaterole)throw Error('The runtime account unexpectedly has administrative privileges.');
   const user=(await app.query('SELECT u.id FROM "User" u JOIN "Membership" m ON m."userId"=u.id JOIN "Clinic" c ON c.id=m."clinicId" WHERE u.email=$1 AND m.role=\'ADMIN\' AND m.active AND c.slug=\'careslot\'',[s.email])).rows[0];if(!user)throw Error('The initial clinic administrator was not found after seeding.');
  }finally{await app.end();}
  s.phase='COMPLETE';s.completedAt=new Date().toISOString();save(p,s);
  console.log('Setup complete. Administrator sign-in details are in .local/bootstrap-account.txt.');console.log('Next: run .\\tools\\start-local.ps1 -Build, then configure Wi-Fi and rebuild the Android APK as documented.');return {alreadyComplete:false};
 }catch(e){if(s){console.error('Setup stopped. Owned objects and private recovery files were retained. Rerun with -Resume after addressing the error. No database or role was automatically deleted.');}throw Error(s?redact(e.message,s):e.message);}
 finally{adminPassword=null;await owner?.end().catch(()=>{});await admin?.end().catch(()=>{});if(fs.existsSync(p.lock)&&safeParse(p.lock).token===lockToken)fs.unlinkSync(p.lock);}
}
async function cli(){
 const args=process.argv.slice(2),value=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
 const o={root:value('--root',path.resolve(__dirname,'..')),host:value('--host','127.0.0.1'),port:Number(value('--port','5432')),admin:value('--admin','postgres'),email:value('--email','admin@careslot.local'),clinic:value('--clinic','CareSlot Clinic'),resume:args.includes('--resume')};
 const checked=preflight(o);
 if(args.includes('--status')){console.log(JSON.stringify({ready:true,complete:checked.complete,resume:!!checked.state}));return;}
 if(checked.complete){console.log('This initializer already completed. Existing configuration was preserved. Use setup-shared.ps1/start-local.ps1 for this installation.');return;}
 if(args.includes('--check')){console.log(checked.state?'Owned incomplete installation can be resumed.':'Fresh-install preflight passed.');return;}
 let secret;try{secret=JSON.parse(fs.readFileSync(0,'utf8'));}catch{throw Error('Administrator credentials must be supplied through the secure setup prompt.');}
 await initialize(o,secret.password);secret.password=null;
}
module.exports={initialize,preflight,environment,childEnvironment,redact,runProjectScript};
if(require.main===module)cli().catch(e=>{console.error(e.message);process.exitCode=1;});
