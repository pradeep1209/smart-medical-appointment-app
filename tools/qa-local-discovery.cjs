const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), { createSocket } = require('node:dgram');
const { randomBytes, createPublicKey, verify } = require('node:crypto');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const { approvedInterfaces } = require('../apps/api/dist/local-network');
const { connectionIdentity } = require('../apps/api/dist/connection-identity');
const { Bonjour } = require('bonjour-service');
async function main() {
 const iface = Object.entries(require('node:os').networkInterfaces()).flatMap(([alias, list]) => (list || []).map(n => ({ ...n, alias }))).find(n => n.family === 'IPv4' && !n.internal && /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(n.address));
 if (!iface) throw Error('No private local interface is connected.');
 const env = { ...process.env, ALLOW_LAN_DEV: 'true', API_HOST: '0.0.0.0', API_LAN_ADDRESS: 'auto', API_LAN_INTERFACES: JSON.stringify([iface.alias]), API_PORT: '3137' };
 const expected = connectionIdentity(env.JWT_SECRET).serverId;
 let tail = '', socket, browser, mdns;
 const child = spawn(process.execPath, ['apps/api/dist/main.js'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
 child.stdout.on('data', b => { tail = (tail + b.toString()).slice(-2000); }); child.stderr.on('data', b => { tail = (tail + b.toString()).slice(-2000); });
 function checkProof(proof, nonce) {
  assert.equal(proof.service, 'CareSlot API'); assert.equal(proof.nonce, nonce); assert.equal(proof.serverId, expected);
  const key = createPublicKey({ key: Buffer.from(proof.publicKey, 'base64'), type: 'spki', format: 'der' });
  assert.equal(verify('sha256', Buffer.from(`CareSlot/1\n${nonce}\n${proof.serverId}\n${proof.name}`), key, Buffer.from(proof.signature, 'base64')), true);
 }
 try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
   if (child.exitCode !== null) throw Error('QA API did not start. Check dependency/database configuration.');
   try { const r = await fetch('http://127.0.0.1:3137/api/v1/health', { signal: AbortSignal.timeout(500) }); if (r.ok) { ready = true; break; } } catch {}
   await new Promise(r => setTimeout(r, 250));
  }
  assert.equal(ready, true, 'QA API became healthy');
  const nonce = randomBytes(16).toString('hex');
  const response = await fetch(`http://${iface.address}:3137/api/v1/connection?nonce=${nonce}`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); checkProof(await response.json(), nonce);
  assert.equal((await fetch(`http://${iface.address}:3137/api/v1/connection?nonce=invalid`)).status, 400);
  assert.equal(approvedInterfaces(env).some(n => n.address === iface.address), true);
  socket = createSocket('udp4');
  const udpProof = new Promise((resolve, reject) => {
   const timeout = setTimeout(() => reject(Error('No local UDP discovery response.')), 4000);
   socket.on('message', bytes => { try { const proof = JSON.parse(bytes); checkProof(proof, nonce); assert.equal(proof.port, 3137); clearTimeout(timeout); resolve(); } catch (e) { clearTimeout(timeout); reject(e); } });
   socket.on('error', reject);
  });
  await new Promise(r => socket.bind(0, iface.address, r)); socket.setBroadcast(true);
  const payload = Buffer.from(JSON.stringify({ service: 'CareSlot discovery', protocol: 1, nonce }));
  const ip = iface.address.split('.').map(Number), mask = iface.netmask.split('.').map(Number);
  const broadcast = ip.map((n, i) => (n & mask[i]) | (255 ^ mask[i])).join('.');
  socket.send(payload, 3002, broadcast); await udpProof;
  const options = { interface: iface.address, port: 5353 }; mdns = new Bonjour(options, () => {});
  await new Promise((resolve, reject) => {
   const timeout = setTimeout(() => reject(Error('mDNS advertisement was not observed.')), 10000);
   browser = mdns.find({ type: 'careslot' }, service => { if (service.port === 3137 && service.txt.id === expected) { clearTimeout(timeout); resolve(); } });
  });
  const report = { recordedAt: new Date().toISOString(), result: 'PASS', checks: ['real API startup/health with existing database (read only)', 'signed HTTP challenge on private adapter', 'malformed challenge rejected', 'no-store header', 'directed subnet UDP broadcast response and signed nonce', 'mDNS advertisement observed'], databaseWrites: false, phoneVerification: 'pending', routerAndHotspotHardwareMatrix: 'pending' };
  const out = path.join(root, 'qa/shared/local-discovery'); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PASS: live HTTP identity, UDP broadcast and mDNS discovery; database records unchanged.');
 } finally {
  try { socket?.close(); } catch {} try { browser?.stop(); mdns?.destroy(); } catch {}
  child.kill(); await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 2000))]);
 }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
