const test = require('node:test'), assert = require('node:assert/strict');
const { validateEnvironment } = require('../dist/config-policy');
const local = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://careslot_app:fictional@127.0.0.1:5432/careslot', JWT_SECRET: 'a'.repeat(64), WEB_ORIGIN: 'http://localhost:3000', WEB_PUBLIC_URL: 'http://localhost:3000' };
test('local dedicated-role configuration works and rejects unsafe hosts/origins/ports/secrets', () => {
 validateEnvironment(local);
 for (const bad of [{ API_HOST: '0.0.0.0' }, { WEB_PUBLIC_URL: 'http://other.invalid' }, { WEB_ORIGIN: 'http://localhost:3000/path' }, { JWT_SECRET: 'REPLACE'.repeat(10) }, { API_PORT: '65536' }, { DATABASE_URL: 'postgresql://postgres:x@localhost/careslot' }, { DATABASE_URL: 'postgresql://careslot_owner:x@localhost/careslot' }]) assert.throws(() => validateEnvironment({ ...local, ...bad }));
});
test('production rejects HTTP/insecure cookies and accepts matching secure origins', () => {
 assert.throws(() => validateEnvironment({ ...local, NODE_ENV: 'production' }));
 validateEnvironment({ ...local, NODE_ENV: 'production', COOKIE_SECURE: 'true', WEB_ORIGIN: 'https://clinic.example', WEB_PUBLIC_URL: 'https://clinic.example' });
});

test('Wi-Fi development mode needs explicit opt-in and a private IPv4 address', () => {
 const wifi = { ...local, ALLOW_LAN_DEV: 'true', API_HOST: '0.0.0.0', API_LAN_ADDRESS: '192.168.0.3' };
 validateEnvironment(wifi);
 for (const address of ['10.1.2.3', '172.16.0.1', '172.31.255.254']) validateEnvironment({ ...wifi, API_LAN_ADDRESS: address });
 for (const address of ['', '8.8.8.8', '127.0.0.1', '169.254.0.2', '172.32.0.1', '192.168.0.999', '192.168.00.3']) assert.throws(() => validateEnvironment({ ...wifi, API_LAN_ADDRESS: address }));
 assert.throws(() => validateEnvironment({ ...wifi, API_HOST: '192.168.0.3' }));
 assert.throws(() => validateEnvironment({ ...wifi, NODE_ENV: 'production', COOKIE_SECURE: 'true', WEB_ORIGIN: 'https://clinic.example', WEB_PUBLIC_URL: 'https://clinic.example' }));
});
