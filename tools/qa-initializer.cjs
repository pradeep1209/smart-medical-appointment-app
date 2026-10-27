// Integration tests use a disposable PostgreSQL cluster, never the active service.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{Client}=require('pg'),argon2=require('argon2');
const {initialize,preflight,runProjectScript}=require('./initialize-local.cjs');
const project=path.resolve(__dirname,'..'),scratch=path.join(project,'.local',`setup-qa-${crypto.randomBytes(10).toString('hex')}`),cluster=path.join(scratch,'cluster'),bin='C:/Program Files/PostgreSQL/18/bin';
const adminPassword=crypto.randomBytes(32).toString('hex'),adminName='careslot_initializer_qa',checks=[],output=[],originalLog=console.log,originalError=console.error,originalWrite=process.stdout.write.bind(process.stdout);
const originalEnvHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(project,'.env'))).digest('hex');
let admin,app,started=false;
function checkedScratch(){const full=path.resolve(scratch),parent=path.resolve(project,'.local')+path.sep;assert(full.startsWith(parent));assert(/^setup-qa-[a-f0-9]{20}$/.test(path.basename(full)));assert(!fs.lstatSync(full).isSymbolicLink());return full;}
function command(name,args){const log=fs.openSync(path.join(scratch,'postgres-commands.log'),'a');try{const r=spawnSync(path.join(bin,`${name}.exe`),args,{windowsHide:true,stdio:['ignore',log,log]});assert.equal(r.status,0,`${name} failed; inspect the private disposable-cluster log`);}finally{fs.closeSync(log);}}
function projectCopy(name){const root=path.join(scratch,name);fs.mkdirSync(path.join(root,'apps/api/prisma'),{recursive:true});fs.copyFileSync(path.join(project,'package.json'),path.join(root,'package.json'));fs.copyFileSync(path.join(project,'apps/api/prisma/schema.prisma'),path.join(root,'apps/api/prisma/schema.prisma'));return root;}
const pass=name=>{checks.push({name,result:'PASS'});originalWrite(`PASS ${name}\n`);};
async function run(){
 fs.mkdirSync(scratch,{recursive:true});
 const sid=spawnSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).stdout.match(/S-1-[0-9-]+/)[0];
 assert.equal(spawnSync('icacls.exe',[scratch,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{stdio:'ignore',windowsHide:true}).status,0);
 const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
 const pw=path.join(scratch,'init-password.txt');fs.writeFileSync(pw,adminPassword,{mode:0o600});
 command('initdb',['-D',cluster,'-U',adminName,'--auth=scram-sha-256','--encoding=UTF8','--locale=C','--pwfile',pw]);fs.unlinkSync(pw);
 command('pg_ctl',['-D',cluster,'-l',path.join(scratch,'server.log'),'-o',`-p ${port} -h 127.0.0.1`,'-w','start']);started=true;
 admin=new Client({host:'127.0.0.1',port,user:adminName,password:adminPassword,database:'postgres'});await admin.connect();
 const root=projectCopy('project'),o={root,host:'127.0.0.1',port,admin:adminName,email:'admin@careslot-qa.invalid',clinic:'QA Fresh Clinic',resume:false};
 assert.throws(()=>preflight({...o,admin:'bad; DROP ROLE postgres'}));assert.throws(()=>preflight({...o,host:'8.8.8.8'}));pass('Unsafe identifiers and remote PostgreSQL addresses rejected before provisioning');
 assert.throws(()=>preflight({...o,root:project}),/existing .env/);pass('Existing real-project .env refused before password prompt or database connection');
 console.log=(...a)=>output.push(a.join(' '));console.error=(...a)=>output.push(a.join(' '));process.stdout.write=(chunk,...args)=>{output.push(String(chunk));const callback=args.find(a=>typeof a==='function');callback?.();return true;};
 const runner=async(script,ignoredRoot,env,state)=>{
  for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL'])assert.equal(Number(new URL(env[key]).port),port,'Test refuses active PostgreSQL service');
  await runProjectScript(script,project,env,state);
  if(script==='db:seed')throw Error('Simulated interruption after successful seeding');
 };
 await assert.rejects(()=>initialize(o,adminPassword,{runProjectScript:runner}),/Simulated interruption/);pass('Fresh provisioning runs actual generate/migrations/seed and retains recovery state after interruption');
 const journalPath=path.join(root,'.local/initial-setup/state.json'),state=JSON.parse(fs.readFileSync(journalPath));assert.notEqual(state.phase,'COMPLETE');
 const generatedEnv=fs.readFileSync(path.join(root,'.env'),'utf8'),note=fs.readFileSync(path.join(root,'.local/bootstrap-account.txt'),'utf8');
 assert.equal(state.jwtSecret.length,96);assert.equal(new Set([state.ownerPassword,state.appPassword,state.jwtSecret,state.bootstrapPassword]).size,4);assert(!generatedEnv.includes(adminPassword)&&!note.includes(adminPassword)&&!fs.readFileSync(journalPath,'utf8').includes(adminPassword));pass('Independent generated secrets; PostgreSQL administrator password absent from persisted files');
 app=new Client({connectionString:`postgresql://careslot_app:${state.appPassword}@127.0.0.1:${port}/careslot`});await app.connect();
 const before=(await app.query('SELECT id,"passwordHash" FROM "User" WHERE email=$1',[o.email])).rows[0];assert(before);assert(await argon2.verify(before.passwordHash,state.bootstrapPassword));
 assert.equal((await app.query('SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')).rows[0].n,9);
 assert.equal((await app.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n,25);pass('All nine real migrations applied; 25 tables and working bootstrap login hash verified');
 await assert.rejects(()=>app.query('CREATE TABLE public.unexpected_admin_power (id int)'),e=>e.code==='42501');assert.equal((await app.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper,false);pass('Application role can read data but cannot create schema objects');
 fs.appendFileSync(path.join(root,'.env'),'# manual edit\n');assert.throws(()=>preflight({...o,resume:true}),/differs/);assert(fs.readFileSync(path.join(root,'.env'),'utf8').endsWith('# manual edit\n'));fs.writeFileSync(path.join(root,'.env'),generatedEnv);pass('Resume refuses a manually changed .env without overwriting it');
 const ownerOid=state.careslot_owner,appOid=state.careslot_app;await admin.query("COMMENT ON ROLE careslot_app IS 'foreign role marker'");await assert.rejects(()=>initialize({...o,resume:true},adminPassword),/role does not match/);await admin.query(`COMMENT ON ROLE careslot_app IS 'CareSlot initializer ${state.marker}'`);pass('Resume refuses a role with mismatched ownership marker instead of resetting it');
 await initialize({...o,resume:true},adminPassword,{runProjectScript:(script,ignoredRoot,env,s)=>runProjectScript(script,project,env,s)});
 const after=(await app.query('SELECT id,"passwordHash" FROM "User" WHERE email=$1',[o.email])).rows[0];assert.deepEqual(before,after);assert.equal((await app.query('SELECT count(*)::int AS n FROM "User"')).rows[0].n,1);const done=JSON.parse(fs.readFileSync(journalPath));assert.equal(done.phase,'COMPLETE');assert.equal(done.careslot_owner,ownerOid);assert.equal(done.careslot_app,appOid);pass('Resume completes with identical role IDs, administrator identity/password and no duplicate users');
 await app.end();app=null;
 const collision={...o,root:projectCopy('collision')};await assert.rejects(()=>initialize(collision,adminPassword),/already exist/);assert(!fs.existsSync(path.join(collision.root,'.env')));pass('Existing database/roles on a fresh configuration refuse without replacement or environment creation');
 assert.equal((await initialize({...o,resume:true},'')).alreadyComplete,true);assert.throws(()=>preflight(o),/existing .env/);pass('Completed Resume is a no-op; ordinary rerun refuses existing configuration');
 for(const secret of [adminPassword,state.ownerPassword,state.appPassword,state.jwtSecret,state.bootstrapPassword])assert(!output.join('\n').includes(secret));pass('Installer/Prisma output does not expose generated secrets or administrator password');
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(project,'.env'))).digest('hex'),originalEnvHash);pass('Original project environment remained byte-for-byte unchanged');
 fs.mkdirSync(path.join(project,'qa/shared/initializer'),{recursive:true});fs.writeFileSync(path.join(project,'qa/shared/initializer/report.json'),JSON.stringify({recordedAt:new Date().toISOString(),result:'PASS',checks,scope:'Disposable PostgreSQL cluster on a dynamically selected loopback port; original database service not used',realMigrationsAndSeed:true,activeEnvironmentChanged:false,secretsLogged:false,testingSubagentsUsed:false},null,2));
}
run().catch(e=>{originalError(output.join('\n').slice(-9000));originalError(e.stack);process.exitCode=1;}).finally(async()=>{
 console.log=originalLog;console.error=originalError;process.stdout.write=originalWrite;
 await app?.end().catch(()=>{});await admin?.end().catch(()=>{});
 if(fs.existsSync(path.join(cluster,'postmaster.pid'))){try{command('pg_ctl',['-D',cluster,'-m','fast','-w','stop']);started=false;}catch(e){originalError(e.message);process.exitCode=1;}}
 if(!started&&fs.existsSync(scratch))fs.rmSync(checkedScratch(),{recursive:true});else if(started){originalError('Disposable cluster retained for manual recovery.');process.exitCode=1;}
});
