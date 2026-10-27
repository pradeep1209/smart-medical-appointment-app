import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const argon2 = require('argon2');
const fixture = JSON.parse(readFileSync('.local/appointments-qa.json', 'utf8'));
const output = 'qa/shared/appointments'; mkdirSync(output, { recursive: true });
const skill = process.argv[2];
if (!skill) throw new Error('Provide the installed Taste skill directory');
const { Browser } = await import(pathToFileURL(`${skill}/scripts/lib/cdp.mjs`));
const { probe, app } = await import(pathToFileURL(`${skill}/scripts/lib/probe.mjs`));
const { judgeApp } = await import(pathToFileURL(`${skill}/scripts/lib/rules.mjs`));
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const report = { recordedAt: new Date().toISOString(), httpChecks: [], widths: [] };
const staffHeaders = { Cookie: `careslot_session=${fixture.session}`, Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json', 'X-CSRF-Token': fixture.csrf };
try {
  const competitor = await db.patientProfile.findUniqueOrThrow({ where: { id: fixture.competitorId }, include: { user: true } });
  assert(competitor.user.email.endsWith('@careslot-qa.invalid'));
  const password = randomBytes(24).toString('hex');
  await db.user.update({ where: { id: competitor.userId }, data: { passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }) } });
  const login = await fetch('http://127.0.0.1:3001/api/v1/auth/mobile/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: competitor.user.email, password }) });
  assert.equal(login.status, 201);
  const mobile = await login.json();
  const bearer = { Authorization: `Bearer ${mobile.accessToken}`, 'Content-Type': 'application/json' };
  const request = async (path, status, headers, body) => { const response = await fetch(`http://127.0.0.1:3001/api/v1${path}`, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) }); assert.equal(response.status, status, path); report.httpChecks.push({ path: path.replace(fixture.phoneVisitId, ':phoneVisit'), expectedStatus: status, actualStatus: response.status }); return response; };
  await request('/patient/appointments', 401, {});
  await request('/patient/appointments', 403, staffHeaders, { clinicId: fixture.clinicId, doctorId: fixture.doctorId, startsAt: `${fixture.date}T04:00:00Z`, requestKey: randomUUID() });
  await request('/patient/appointments', 400, bearer, { clinicId: fixture.clinicId, doctorId: fixture.doctorId, startsAt: `${fixture.date}T04:00:00Z`, requestKey: randomUUID(), patientId: randomUUID() });
  await request(`/patient/appointments/${fixture.phoneVisitId}/cancel`, 404, bearer, { version: 0 });
  await request(`/clinics/${fixture.clinicId}/appointments?date=${fixture.date}`, 403, bearer);
  await request(`/clinics/${fixture.clinicId}/appointments/${fixture.phoneVisitId}/status`, 403, { ...staffHeaders, 'X-CSRF-Token': '' }, { version: 0, status: 'CANCELLED' });
  const own = await (await request('/patient/appointments?view=upcoming', 200, bearer)).json();
  assert(own.items.every(a => a.id !== fixture.phoneVisitId));
  const browser = await Browser.launch();
  try {
    const page = await browser.newPage({ width: 1440, height: 1000 });
    page.browser.on(page.sessionId, 'Runtime.exceptionThrown', event => {
      const description = event.exceptionDetails?.exception?.description ?? '';
      if (description.includes('Hydration')) console.log(description.slice(0, 6000));
    });
    await page.send('Network.enable');
    await page.send('Network.setCookie', { name: 'careslot_session', value: fixture.session, url: 'http://127.0.0.1:3000', path: '/', httpOnly: true, sameSite: 'Strict' });
    await page.send('Network.setCookie', { name: 'careslot_csrf', value: fixture.csrf, url: 'http://127.0.0.1:3000', path: '/', sameSite: 'Strict' });
    await page.goto(`http://127.0.0.1:3000/appointments?date=${fixture.date}`);
    assert.equal(await page.eval(() => document.querySelector('h1')?.textContent), 'My appointments');
    assert.equal(await page.eval(() => document.querySelectorAll('.visit-row').length), 2);
    await page.eval(() => { document.querySelectorAll('.visit-history').forEach(d => d.open = true); });
    for (const [width, height] of [[1440,1000],[768,1024],[390,844]]) {
      await page.setViewport({ width, height, mobile: width < 600 });
      await page.eval(() => { scrollTo(0,0); return document.fonts.ready; });
      await page.screenshot({ path: `${output}/web-${width}.png`, format: 'png', fullPage: true });
      const metrics = await page.eval(probe), appMetrics = await page.eval(app);
      const overflow = await page.eval(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false);
      report.widths.push({ width, horizontalOverflow: false, findings: judgeApp(appMetrics, metrics, { width }) });
    }
    report.consoleErrors = page.consoleErrors;
    writeFileSync(`${output}/web-review.json`, JSON.stringify(report, null, 2));
    if (page.consoleErrors.length) console.log(JSON.stringify({ consoleErrors: page.consoleErrors }));
    assert.equal(page.consoleErrors.length, 0);
    report.queue = 'PASS: doctor dashboard shows both phone and competing patient appointments with history';
    writeFileSync(`${output}/web-review.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ httpChecks: report.httpChecks.length, queue: report.queue, findings: report.widths.flatMap(w => w.findings.map(f => ({ width: w.width, ...f }))) }));
  } finally { await browser.close(); }
} finally { await db.$disconnect(); }
