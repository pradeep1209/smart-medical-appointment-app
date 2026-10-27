import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const skill = process.argv[2];
if (!skill) throw new Error('Pass the installed taste skill directory');
const { Browser } = await import(pathToFileURL(`${skill}/scripts/lib/cdp.mjs`));
const { probe, app } = await import(pathToFileURL(`${skill}/scripts/lib/probe.mjs`));
const { judgeApp } = await import(pathToFileURL(`${skill}/scripts/lib/rules.mjs`));
const fixture = JSON.parse(readFileSync('.local/availability-qa.json', 'utf8'));
const output = 'qa/shared/availability';
mkdirSync(output, { recursive: true });
const path = `/clinics/${fixture.clinicId}/doctors/${fixture.doctorId}/schedule`;
const headers = { Cookie: `careslot_session=${fixture.session}`, Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json', 'X-CSRF-Token': fixture.csrf };
const test = async (suffix, body, status, extra = {}) => {
  const response = await fetch(`http://127.0.0.1:3001/api/v1${suffix}`, { method: body ? 'POST' : 'GET', headers: { ...headers, ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, status, `HTTP ${suffix}`);
};
await test(path, {}, 403, { 'X-CSRF-Token': '' });
await test(path, { specialty: 'QA consultation', consultationMinutes: 0, version: 2, days: [] }, 400);
await test(path, { specialty: 'QA consultation', consultationMinutes: 30, version: 2, days: [{ weekday: 1, startMinute: 540, endMinute: 660, injected: true }] }, 400);
await test(`/patient/clinics/${fixture.clinicId}/doctors/${fixture.doctorId}/slots?date=${fixture.date}`, null, 403);
const browser = await Browser.launch();
const report = { recordedAt: new Date().toISOString(), httpChecks: 'PASS: CSRF, invalid duration, nested unknown fields, staff session on patient slots', widths: [], uiSave: 'PENDING' };
try {
  const page = await browser.newPage({ width: 1440, height: 1000 });
  await page.send('Network.enable');
  await page.send('Network.setCookie', { name: 'careslot_session', value: fixture.session, url: 'http://127.0.0.1:3000', path: '/', httpOnly: true, sameSite: 'Strict' });
  await page.send('Network.setCookie', { name: 'careslot_csrf', value: fixture.csrf, url: 'http://127.0.0.1:3000', path: '/', sameSite: 'Strict' });
  await page.goto('http://127.0.0.1:3000/availability');
  assert.equal(await page.eval(() => document.querySelector('h1')?.textContent), 'My availability');
  await page.eval(() => document.getElementById('schedule-specialty').focus());
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await page.send('Input.insertText', { text: 'QA availability review' });
  await page.eval(() => document.querySelector('.schedule-columns form').requestSubmit());
  for (let n = 0; n < 30; n++) {
    if (await page.eval(() => document.querySelector('[role="status"]')?.textContent?.includes('saved'))) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.equal(await page.eval(() => document.querySelector('[role="status"]')?.textContent?.includes('saved')), true);
  const saved = await (await fetch(`http://127.0.0.1:3001/api/v1/clinics/${fixture.clinicId}/schedules`, { headers })).json();
  assert.equal(saved.doctors[0].specialty, 'QA availability review');
  report.uiSave = 'PASS: actual browser form saved specialty; verified through authenticated API';
  for (const [width, height] of [[1440, 1000], [1101, 1000], [768, 1024], [390, 844]]) {
    await page.setViewport({ width, height, mobile: width < 600 });
    await page.eval(() => { scrollTo(0, 0); return document.fonts.ready; });
    await page.screenshot({ path: `${output}/web-${width}.png`, format: 'png', fullPage: true });
    const metrics = await page.eval(probe), appMetrics = await page.eval(app);
    const findings = judgeApp(appMetrics, metrics, { width });
    const overflow = await page.eval(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `Horizontal overflow at ${width}`);
    report.widths.push({ width, horizontalOverflow: false, findings });
  }
  report.consoleErrors = page.consoleErrors;
  writeFileSync(`${output}/web-review.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: 'PASS: authenticated form save, HTTP security checks, no horizontal overflow', screenshots: report.widths.map(w => w.width), findings: report.widths.flatMap(w => w.findings.map(f => ({ width: w.width, ...f }))) }));
} finally { await browser.close(); }
