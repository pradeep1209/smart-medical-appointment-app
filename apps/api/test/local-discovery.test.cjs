const test = require('node:test'), assert = require('node:assert/strict');
const { createPublicKey, verify } = require('node:crypto');
const { connectionIdentity } = require('../dist/connection-identity');
const { approvedInterfaces, onSubnet } = require('../dist/local-network');
const { validateEnvironment } = require('../dist/config-policy');
const entry = address => ({ address, netmask: '255.255.255.0', family: 'IPv4', internal: false, mac: 'aa:bb:cc:dd:ee:ff', cidr: `${address}/24` });
const local = { DATABASE_URL: 'postgresql://careslot_app:fictional@127.0.0.1/careslot', JWT_SECRET: 'a'.repeat(64), WEB_ORIGIN: 'http://localhost:3000', WEB_PUBLIC_URL: 'http://localhost:3000' };
const env = { ...local, ALLOW_LAN_DEV: 'true', API_HOST: '0.0.0.0', API_LAN_ADDRESS: 'auto', API_LAN_INTERFACES: '["Wi-Fi","Hotspot"]' };
test('automatic network configuration requires explicit approved interface names', () => {
 validateEnvironment(env);
 for (const aliases of [undefined, '', 'null', '{}', '[]', '[1]', '[""]', '[" "]', '["x",null]']) assert.throws(() => validateEnvironment({ ...env, API_LAN_INTERFACES: aliases }));
 assert.throws(() => validateEnvironment({ ...env, API_HOST: '127.0.0.1' }));
});
test('same approved adapters follow router and phone/laptop hotspot address changes; VPN/public adapters stay excluded', () => {
 for (const ip of ['192.168.1.20', '192.168.43.120', '192.168.137.1', '172.20.10.2']) {
  const actual = approvedInterfaces(env, { 'Wi-Fi': [entry(ip)], VPN: [entry('10.1.2.3')], Ethernet: [entry('8.8.8.8')] });
  assert.deepEqual(actual.map(n => n.address), [ip]);
 }
 assert.deepEqual(approvedInterfaces(env, { Hotspot: [entry('192.168.137.1')] }).map(n => n.address), ['192.168.137.1']);
 assert.equal(approvedInterfaces({ ...env, ALLOW_LAN_DEV: 'false' }, { 'Wi-Fi': [entry('192.168.0.3')] }).length, 0);
 assert.equal(approvedInterfaces(env, {}).length, 0);
});
test('broadcast replies are limited to the configured local subnet', () => {
 assert.equal(onSubnet('192.168.43.1', entry('192.168.43.120')), true);
 for (const ip of ['192.168.44.1', '8.8.8.8', '127.0.0.1', '10.1.2.3']) assert.equal(onSubnet(ip, entry('192.168.43.120')), false);
});
test('server identity stays stable across address/name changes and differs between installations', () => {
 const first = connectionIdentity('a'.repeat(64)), next = connectionIdentity('a'.repeat(64)), other = connectionIdentity('b'.repeat(64));
 assert.equal(first.serverId, next.serverId); assert.notEqual(first.serverId, other.serverId);
 assert.throws(() => connectionIdentity('short'));
});
test('fresh challenge signatures reject replay, changed identity, or a changed clinic label', () => {
 const signer = connectionIdentity('a'.repeat(64)); const nonce = 'a1'.repeat(16), proof = signer.proof(nonce, 'Fictional Clinic');
 const key = createPublicKey({ key: Buffer.from(proof.publicKey, 'base64'), type: 'spki', format: 'der' });
 const valid = (n, id, name) => verify('sha256', Buffer.from(`CareSlot/1\n${n}\n${id}\n${name}`), key, Buffer.from(proof.signature, 'base64'));
 assert.equal(valid(nonce, proof.serverId, proof.name), true);
 assert.equal(valid('b2'.repeat(16), proof.serverId, proof.name), false);
 assert.equal(valid(nonce, '0'.repeat(64), proof.name), false);
 assert.equal(valid(nonce, proof.serverId, 'Other Clinic'), false);
 assert.throws(() => signer.proof('bad', 'Clinic'));
 assert.deepEqual(Object.keys(proof).sort(), ['name','nonce','protocol','publicKey','serverId','service','signature']);
});
