// Consistent online backup; optional restore drill uses a fresh isolated PostgreSQL cluster.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), net = require('node:net');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const root = path.resolve(__dirname, '..'), local = path.join(root, '.local');
const bin = process.env.CARESLOT_POSTGRES_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const verify = process.argv.includes('--verify-restore');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(local, 'database-backups', `backup-${stamp}-${crypto.randomBytes(3).toString('hex')}`);
const scratch = path.join(local, `restore-check-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`);
const cluster = path.join(scratch, 'data'), port = 55433;
let started = false, source, restored, snapshotOpen = false;
const quote = value => '"' + value.replaceAll('"', '""') + '"';
function checkedScratch() {
 const absolute = path.resolve(scratch), allowed = path.resolve(local) + path.sep;
 if (!absolute.toLowerCase().startsWith(allowed.toLowerCase()) || !/^restore-check-\d+-[a-f0-9]{12}$/.test(path.basename(absolute))) throw Error('Scratch path is outside the intended workspace.');
 return absolute;
}
function privateDirectory(dir) {
 fs.mkdirSync(dir, { recursive: true });
 if (process.platform === 'win32') {
  const who = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
  const sid = who.stdout?.match(/S-1-[0-9-]+/)?.[0]; if (!sid) throw Error('Could not identify the current user for private backup permissions.');
  const acl = spawnSync('icacls.exe', [dir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { encoding: 'utf8' });
  if (acl.status !== 0) throw Error('Private backup permissions could not be set.');
 }
}
function command(executable, args, password) {
 const log = path.join(backup, 'private-command-log.txt'), descriptor = fs.openSync(log, 'a');
 // Background postgres must not inherit a captured pipe: on Windows that keeps spawnSync waiting for EOF.
 let result;
 try { result = spawnSync(path.join(bin, executable + '.exe'), args, { env: { ...process.env, PGPASSWORD: password, PGCLIENTENCODING: 'UTF8', PGOPTIONS: '-c timezone=UTC -c datestyle=ISO,YMD -c extra_float_digits=3' }, stdio: ['ignore', descriptor, descriptor], windowsHide: true }); }
 finally { fs.closeSync(descriptor); }
 fs.appendFileSync(log, `${executable}: ${result.status}\n`);
 if (result.error || result.status !== 0) throw Error(`${executable} failed. Inspect the private backup command log.`);
 return '';
}
async function manifest(client) {
 await client.query("SET TIME ZONE 'UTC'"); await client.query("SET datestyle='ISO,YMD'"); await client.query('SET extra_float_digits=3');
 const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
 const result = {};
 for (const { tablename } of tables.rows) {
  const rows = await client.query(`SELECT row_to_json(t)::text AS value FROM public.${quote(tablename)} t ORDER BY row_to_json(t)::text COLLATE "C"`);
  const hash = crypto.createHash('sha256'); for (const row of rows.rows) { hash.update(row.value); hash.update('\n'); }
  result[tablename] = { rows: rows.rowCount, sha256: hash.digest('hex') };
 }
 return result;
}
async function freePort() { await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(resolve)); }); }
async function main() {
 if (!process.env.MIGRATION_DATABASE_URL) throw Error('MIGRATION_DATABASE_URL is required for a complete backup.');
 for (const exe of ['pg_dump', 'pg_restore', ...(verify ? ['initdb', 'pg_ctl', 'createdb'] : [])]) if (!fs.existsSync(path.join(bin, exe + '.exe'))) throw Error(`Missing PostgreSQL tool: ${exe}`);
 privateDirectory(backup);
 const uri = new URL(process.env.MIGRATION_DATABASE_URL), database = decodeURIComponent(uri.pathname.slice(1)), owner = decodeURIComponent(uri.username), password = decodeURIComponent(uri.password);
 source = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL }); await source.connect();
 await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); snapshotOpen = true;
 const snapshot = (await source.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
 const dump = path.join(backup, 'careslot.dump');
 command('pg_dump', ['-w', '-h', uri.hostname, '-p', uri.port || '5432', '-U', owner, '-d', database, '-Fc', '--no-owner', '--snapshot', snapshot, '-f', dump], password);
 const before = await manifest(source); await source.query('COMMIT'); snapshotOpen = false; await source.end(); source = null;
 const dumpHash = crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex');
 const models = path.join(root, 'apps/api/models'); fs.cpSync(models, path.join(backup, 'models'), { recursive: true });
 const receipt = { createdAt: new Date().toISOString(), source: `${uri.hostname}:${uri.port || '5432'}/${database}`, format: 'PostgreSQL custom; ownership omitted, ACL retained', dumpSha256: dumpHash, tables: before, secretsFileIncluded: false, modelArtifactsIncluded: true, restoreVerified: false };
 fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(receipt, null, 2));
 if (verify) {
  await freePort(); checkedScratch(); privateDirectory(scratch);
  const qaPassword = crypto.randomBytes(32).toString('hex'), qaUser = 'careslot_restore_qa', qaDb = 'careslot_restore_qa';
  const passwordFile = path.join(scratch, 'init-password.txt'); fs.writeFileSync(passwordFile, qaPassword, { mode: 0o600 });
  command('initdb', ['-D', cluster, '-U', qaUser, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', '--pwfile', passwordFile], qaPassword);
  fs.unlinkSync(passwordFile);
  command('pg_ctl', ['-D', cluster, '-l', path.join(scratch, 'server.log'), '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start'], qaPassword); started = true;
  command('createdb', ['-w', '-h', '127.0.0.1', '-p', String(port), '-U', qaUser, qaDb], qaPassword);
  restored = new Client({ host: '127.0.0.1', port, user: qaUser, password: qaPassword, database: qaDb }); await restored.connect();
  const appRole = decodeURIComponent(new URL(process.env.DATABASE_URL).username);
  for (const role of new Set([owner, appRole])) if (role !== qaUser) await restored.query(`CREATE ROLE ${quote(role)} NOLOGIN`);
  command('pg_restore', ['-w', '-h', '127.0.0.1', '-p', String(port), '-U', qaUser, '-d', qaDb, '--no-owner', '--exit-on-error', dump], qaPassword);
  const after = await manifest(restored);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Restored table content does not match the backup snapshot.');
  receipt.restoreVerified = true; receipt.tablesCompared = Object.keys(before).length;
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(receipt, null, 2));
  await restored.end(); restored = null;
 }
 fs.mkdirSync(path.join(root, 'qa/shared/local-readiness'), { recursive: true });
 fs.writeFileSync(path.join(root, verify ? 'qa/shared/local-readiness/backup-restore.json' : 'qa/shared/local-readiness/backup-latest.json'), JSON.stringify({ recordedAt: new Date().toISOString(), result: 'PASS', restoreVerified: verify, tablesCompared: Object.keys(before).length, contentHashesMatch: verify, dumpSha256: dumpHash, privateBackupDirectory: path.relative(root, backup).replaceAll('\\', '/'), activeDatabaseChanged: false, activeEnvironmentChanged: false, modelArtifactsIncluded: true }, null, 2));
 console.log(`${verify ? 'Backup and isolated restore verified' : 'Consistent backup created'}: ${Object.keys(before).length} tables. Private files: ${path.relative(root, backup)}`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(async () => {
 if (snapshotOpen) await source?.query('ROLLBACK').catch(() => {});
 await source?.end().catch(() => {}); await restored?.end().catch(() => {});
 if (fs.existsSync(path.join(cluster, 'postmaster.pid'))) { started = true; try { command('pg_ctl', ['-D', checkedScratch() + path.sep + 'data', '-m', 'fast', '-w', 'stop'], ''); started = false; } catch { console.error('Temporary restore cluster could not be stopped; its private data was retained for recovery.'); process.exitCode = 1; } } else started = false;
 if (!started && fs.existsSync(scratch)) fs.rmSync(checkedScratch(), { recursive: true });
});
