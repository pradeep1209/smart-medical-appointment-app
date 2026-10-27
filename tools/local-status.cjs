require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path'), { Client } = require('pg');
const { validateEnvironment } = require('../apps/api/dist/config-policy');
async function main() {
 validateEnvironment(process.env);
 const database = new Client({ connectionString: process.env.DATABASE_URL });
 let db;
 try { await database.connect(); const role = (await database.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0]; if (role.rolsuper || role.rolcreatedb || role.rolcreaterole) throw Error('Runtime database role has administrative permissions.'); const count = (await database.query('SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].n; db = { connected: true, runtimeLeastPrivilege: true, migrationsApplied: count }; } finally { await database.end(); }
 const api = await fetch(`http://127.0.0.1:${process.env.API_PORT || 3001}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
 if (!api.ok || (await api.json()).service !== 'CareSlot API') throw Error('CareSlot API health check failed.');
 const web = await fetch('http://127.0.0.1:3000/login', { signal: AbortSignal.timeout(10000) }); if (!web.ok) throw Error('Local clinic dashboard is unavailable.');
 let wifi = { enabled: false };
 if (process.env.ALLOW_LAN_DEV === 'true') {
  const address = process.env.API_LAN_ADDRESS;
  const response = await fetch(`http://${address}:${process.env.API_PORT || 3001}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok || (await response.json()).service !== 'CareSlot API') throw Error('Configured Wi-Fi API address is unavailable. Check the address and restart the API.');
  wifi = { enabled: true, address, reachableFromComputer: true, phoneVerification: 'See qa/shared/wifi-sync/report.json; a computer probe does not verify the phone path.' };
 }
 const report = { recordedAt: new Date().toISOString(), result: 'PASS', database: db, api: { reachable: true, noStore: api.headers.get('cache-control') === 'no-store', nosniff: api.headers.get('x-content-type-options') === 'nosniff' }, wifi, web: { reachable: true, frameProtection: web.headers.get('x-frame-options'), noStore: web.headers.get('cache-control')?.includes('no-store') }, publicDeployment: false };
 if (!report.api.noStore || !report.api.nosniff || !report.web.noStore || report.web.frameProtection !== 'DENY') throw Error('Expected response security headers are missing.');
 const out = path.resolve(__dirname, '../qa/shared/local-readiness'); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'status.json'), JSON.stringify(report, null, 2)); console.log('PASS: local services, least-privilege database role, migration state and response headers.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
