const test = require('node:test'), assert = require('node:assert/strict');
const express = require('express');
const { authRateLimits } = require('../dist/auth-rate-limits');

async function server(run) {
  const app = express();
  app.use('/api/v1/auth', authRateLimits());
  app.get('/api/v1/auth/me', (_req, res) => res.json({ signedIn: true }));
  app.post('/api/v1/auth/logout', (_req, res) => res.json({ signedOut: true }));
  for (const path of ['web/login', 'mobile/login', 'mobile/refresh', 'mobile/register', 'accept-invitation']) {
    app.post(`/api/v1/auth/${path}`, (req, res) => res.status(req.get('X-QA-Success') ? 201 : 401).json({}));
  }
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.on('listening', resolve));
  const base = `http://127.0.0.1:${listener.address().port}/api/v1/auth`;
  const request = (path, method = 'POST', success = false) => fetch(`${base}/${path}`, { method, headers: success ? { 'X-QA-Success': 'true' } : {} });
  try { await run(request); } finally { await new Promise(resolve => listener.close(resolve)); }
}

test('routine identity checks and successful logins do not exhaust sign-in attempts', () => server(async request => {
  for (let i = 0; i < 45; i++) {
    assert.equal((await request('me', 'GET')).status, 200);
    assert.equal((await request('web/login', 'POST', true)).status, 201);
  }
  assert.equal((await request('mobile/login', 'POST', true)).status, 201);
}));

test('failed sign-ins share a 40-attempt limit while session checks, refresh and logout remain usable', () => server(async request => {
  for (let i = 0; i < 40; i++) assert.equal((await request(i % 2 ? 'web/login' : 'mobile/login')).status, 401);
  const limited = await request('web/login');
  assert.equal(limited.status, 429); assert(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await limited.json()).message, 'Too many sign-in attempts. Please try again later.');
  assert.equal((await request('me', 'GET')).status, 200);
  assert.equal((await request('logout')).status, 200);
  assert.equal((await request('mobile/refresh', 'POST', true)).status, 201);
}));

test('registration, invitation and refresh abuse have independent limits', () => server(async request => {
  for (const [path, limit] of [['mobile/register',40], ['accept-invitation',40], ['mobile/refresh',120]]) {
    for (let i = 0; i < limit; i++) assert.equal((await request(path)).status, 401);
    assert.equal((await request(path)).status, 429);
    assert.equal((await request('web/login', 'POST', true)).status, 201);
  }
}));
