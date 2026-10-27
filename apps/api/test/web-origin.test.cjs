const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isTrustedWebOrigin } = require('../dist/web-origin');

test('configured origin and loopback aliases work on the development dashboard port', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(isTrustedWebOrigin(`http://${host}:3000`, 'http://localhost:3000', 'development'), true);
  }
  assert.equal(isTrustedWebOrigin('http://localhost:3000', 'http://127.0.0.1:3000', 'development'), true);
});

test('development does not permit a different port, protocol, remote host, or malformed Origin', () => {
  for (const origin of [
    undefined, '', 'null', 'http://127.0.0.1:3001', 'https://127.0.0.1:3000',
    'http://localhost.evil.example:3000', 'http://192.168.1.10:3000',
    'http://localhost:3000/', 'http://localhost:3000/path',
    'http://localhost:3000?query=yes', 'http://localhost:3000#fragment',
    'http://user@localhost:3000', 'http://localhost:3000, http://evil.example',
  ]) assert.equal(isTrustedWebOrigin(origin, 'http://localhost:3000', 'development'), false, String(origin));
  assert.equal(isTrustedWebOrigin('http://localhost:3000', 'https://clinic.example', 'development'), false);
});

test('non-development environments never allow loopback aliases', () => {
  for (const environment of ['production', 'test', 'staging', '']) {
    assert.equal(isTrustedWebOrigin('http://localhost:3000', 'http://localhost:3000', environment), true);
    assert.equal(isTrustedWebOrigin('http://127.0.0.1:3000', 'http://localhost:3000', environment), false);
  }
  assert.equal(isTrustedWebOrigin('https://clinic.example', 'https://clinic.example', 'production'), true);
  assert.equal(isTrustedWebOrigin('https://other.example', 'https://clinic.example', 'production'), false);
});

test('invalid configured origins fail closed', () => {
  for (const configured of ['', 'not-a-url', 'null', 'http://localhost:3000/path', 'http://user@localhost:3000', 'file:///']) {
    assert.equal(isTrustedWebOrigin('http://localhost:3000', configured, 'development'), false);
  }
});
