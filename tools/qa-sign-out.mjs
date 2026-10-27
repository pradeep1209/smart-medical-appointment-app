import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const argon2 = require('argon2');
const skill = process.argv[2];
const { Browser } = await import(pathToFileURL(`${skill}/scripts/lib/cdp.mjs`));
const { app, probe } = await import(pathToFileURL(`${skill}/scripts/lib/probe.mjs`));
const { judgeApp } = await import(pathToFileURL(`${skill}/scripts/lib/rules.mjs`));
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const output = 'qa/shared/sign-out'; mkdirSync(output, { recursive: true });
const checks = [], screens = [];
let user, browser;
try {
  const clinic = await db.clinic.findUniqueOrThrow({ where: { slug: 'careslot' } });
  const email = `sign-out-${randomUUID()}@careslot-qa.invalid`, password = `QA only ${randomUUID()}!`;
  user = await db.user.create({ data: { email, displayName: 'QA Clinic Administrator', passwordHash: await argon2.hash(password), memberships: { create: { clinicId: clinic.id, role: 'ADMIN' } } } });
  browser = await Browser.launch();
  const page = await browser.newPage({ width: 1480, height: 668 });
  await page.send('Network.enable');
  async function wait(text) {
    for (let i = 0; i < 50; i++) { if (await page.eval(t => document.body.innerText.includes(t), text)) return; await new Promise(r => setTimeout(r, 200)); }
    throw Error(`Missing UI: ${text}`);
  }
  async function login(host = '127.0.0.1') {
    const response = await fetch('http://127.0.0.1:3001/api/v1/auth/web/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' }, body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 201);
    const cookies = response.headers.getSetCookie().map(c => c.split(';')[0]);
    for (const cookie of cookies) { const [name, value] = cookie.split('='); await page.send('Network.setCookie', { name, value, url: `http://${host}:3000`, path: '/', httpOnly: name === 'careslot_session', sameSite: 'Strict' }); }
    await page.goto(`http://${host}:3000/account`); await wait('Save name');
    // Wait for React event handlers before exercising client controls.
    await new Promise(r => setTimeout(r, 400));
    return cookies.join('; ');
  }
  await login('localhost');
  for (const [width, height] of [[1480,668],[1440,900],[1480,480],[768,1024],[390,844]]) {
    await page.setViewport({ width, height, mobile: width < 600 });
    await page.eval(() => { scrollTo(0,0); return document.fonts.ready; });
    const geometry = await page.eval(() => {
      function visible(selector) { const b = document.querySelector(selector); const r = b.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth; }
      return { account: visible('.page-heading button'), sidebar: innerWidth > 1100 ? visible('.sidebar-footer .sign-out') : null, overflow: document.documentElement.scrollWidth > innerWidth, navScrolls: document.querySelector('.desktop-nav').scrollHeight > document.querySelector('.desktop-nav').clientHeight };
    });
    assert(geometry.account, `Account sign out hidden at ${width}x${height}`);
    if (width > 1100) assert(geometry.sidebar, `Sidebar sign out hidden at ${width}x${height}`);
    if (height === 480) assert(geometry.navScrolls, 'Short desktop should scroll navigation separately');
    assert(!geometry.overflow);
    const findings = judgeApp(await page.eval(app), await page.eval(probe), { width });
    screens.push({ width, height, ...geometry, findings });
    await page.screenshot({ path: `${output}/account-${width}x${height}.png`, format: 'png' });
  }
  checks.push('Account sign out visible without scrolling at five viewport sizes, including reported localhost account view');
  checks.push('Desktop footer remains visible on short windows; workspace navigation scrolls independently');
  for (const [name, selector, width, host] of [['account','.page-heading button',1480,'localhost'],['sidebar','.sidebar-footer .sign-out',1480,'127.0.0.1'],['mobile','.mobile-nav .sign-out',390,'127.0.0.1']]) {
    await page.setViewport({ width, height: 668, mobile: width < 600 });
    const cookie = await login(host);
    if (name === 'mobile') await page.eval(() => document.querySelector('.mobile-nav summary').click());
    const point = await page.eval(selector => { const b = document.querySelector(selector); b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; }, selector);
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await wait('Welcome back.');
    assert.equal(await page.eval(() => location.pathname), '/login');
    assert.equal((await fetch('http://127.0.0.1:3001/api/v1/auth/me', { headers: { Cookie: cookie } })).status, 401);
    await page.goto(`http://${host}:3000/account`); await wait('Welcome back.');
    checks.push(`${name} button redirects to login, revokes the actual session and prevents reopening account`);
  }
  const report = { recordedAt: new Date().toISOString(), result: 'PASS', checks, screens, consoleErrors: page.consoleErrors, design: { style: 'Existing Accent ladder', seed: 1874909154, redraws: [], intent: 'Make ending the current clinic session visible in account actions and the sidebar footer', retained: 'CareSlot mark, clinic scope, DM Sans and forest green palette', sampleData: 'One clearly labelled fictional QA administrator, removed after checks' }, cleanup: 'Only owned QA identity, sessions and membership removed; existing user sessions unchanged' };
  assert.equal(page.consoleErrors.length, 0);
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, checks: checks.length, screens: screens.length, findings: screens.flatMap(s => s.findings) }));
} finally {
  if (browser) await browser.close();
  if (user) {
    assert(user.email.endsWith('@careslot-qa.invalid'));
    await db.authSession.deleteMany({ where: { userId: user.id } });
    await db.membership.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
  await db.$disconnect();
}
