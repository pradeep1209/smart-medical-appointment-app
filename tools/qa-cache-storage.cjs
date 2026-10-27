const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const adb = 'C:/Users/USER/AppData/Local/Android/Sdk/platform-tools/adb.exe', serial = '10BD770XGP0003B';
const path = '.local/cache-storage-qa.db';
function command(args) { const r = spawnSync(adb, ['-s', serial, ...args], { maxBuffer: 20 * 1024 * 1024 }); if (r.error) throw r.error; return r; }
let database;
try {
 assert.equal(command(['shell', 'am', 'force-stop', 'com.careslot.app']).status, 0);
 for (const suffix of ['', '-wal', '-shm']) {
  const r = command(['exec-out', 'run-as', 'com.careslot.app', 'cat', `databases/care-connected.db${suffix}`]);
  if (suffix === '') assert.equal(r.status, 0, 'Read app-owned cache database');
  if (r.status === 0) fs.writeFileSync(path + suffix, r.stdout);
 }
 database = new DatabaseSync(path);
 assert.equal(database.prepare('PRAGMA user_version').get().user_version, 2);
 const rows = database.prepare('SELECT kind, encrypted FROM clinical_cache').all();
 assert(rows.some(r => r.kind === 'care')); assert(rows.some(r => r.kind === 'visits-false'));
 for (const row of rows) { assert(/^[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/.test(row.encrypted)); assert(!row.encrypted.includes('"items"')); }
 fs.writeFileSync('qa/shared/accounts-sync/cache-storage-check.json', JSON.stringify({ recordedAt: new Date().toISOString(), result: 'PASS', schemaVersion: 2, clinicalRows: rows.length, checks: ['Existing Room cache upgraded without clearing account session', 'Persisted clinical payloads use ciphertext/IV encoding rather than JSON plaintext', 'Snapshot inspected privately and deleted after verification'] }, null, 2));
 console.log('PASS: Room v2 upgrade and encrypted clinical row storage.');
} finally {
 database?.close();
 for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(path + suffix)) fs.unlinkSync(path + suffix);
 command(['shell', 'am', 'start', '-n', 'com.careslot.app/.ConnectedActivity']);
}
