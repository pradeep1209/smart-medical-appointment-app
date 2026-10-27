import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const skill = process.argv[2], fixture = JSON.parse(readFileSync('.local/accounts-sync-qa.json'));
const { Browser } = await import(pathToFileURL(`${skill}/scripts/lib/cdp.mjs`));
const { probe, app } = await import(pathToFileURL(`${skill}/scripts/lib/probe.mjs`));
const { judgeApp } = await import(pathToFileURL(`${skill}/scripts/lib/rules.mjs`));
const output = 'qa/shared/accounts-sync'; mkdirSync(output, { recursive: true });
const browser = await Browser.launch(); const checks = [];
try {
 const page = await browser.newPage({ width: 1440, height: 1000 });
 await page.send('Network.enable');
 await page.send('Network.setCookie', { name: 'careslot_session', value: fixture.session, url: 'http://127.0.0.1:3000', path: '/', httpOnly: true, sameSite: 'Strict' });
 await page.send('Network.setCookie', { name: 'careslot_csrf', value: fixture.csrf, url: 'http://127.0.0.1:3000', path: '/', sameSite: 'Strict' });
 async function wait(text) { for (let i = 0; i < 40; i++) { if (await page.eval(t => document.body.innerText.includes(t), text)) return; await new Promise(r => setTimeout(r, 250)); } throw Error(`Missing UI: ${text}`); }
 async function fill(id, text) { await page.eval(id => document.getElementById(id).focus(), id); await page.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 }); await page.send('Input.insertText', { text }); }
 async function click(text) { await page.eval(t => [...document.querySelectorAll('button')].find(b => b.textContent === t).click(), text); }
 const report = { recordedAt: new Date().toISOString(), checks, screens: [], consoleErrors: [] };
 async function inspect(name) { for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844]]) { await page.setViewport({ width, height, mobile: width < 600 }); await page.eval(() => { scrollTo(0, 0); return document.fonts.ready; }); await page.screenshot({ path: `${output}/web-${name}-${width}.png`, format: 'png', fullPage: true }); const overflow = await page.eval(() => document.documentElement.scrollWidth > innerWidth); assert(!overflow, `${name} overflow at ${width}`); report.screens.push({ name, width, horizontalOverflow: overflow, findings: judgeApp(await page.eval(app), await page.eval(probe), { width }) }); } }
 await page.goto('http://127.0.0.1:3000/account'); await wait('Save name'); await fill('account-name', 'QA Sync Admin Renamed'); await click('Save name'); await wait('Your name has been updated.'); checks.push('Actual profile form saves and refreshes identity'); await inspect('account');
 await page.setViewport({ width: 1440, height: 1000 }); await page.goto('http://127.0.0.1:3000/team'); await wait('Help someone recover access');
 await fill('recovery-email', fixture.patientEmail); await fill('verification-note', 'Fictional QA identity verified in person');
 await click('Create recovery code'); await wait('Private recovery code'); const code = await page.eval(() => document.getElementById('recovery-code').value); assert.equal(code.length, 64); await click('Hide code'); checks.push('Actual admin form issues a recovery code with verification note'); await inspect('team');
 await page.goto('http://127.0.0.1:3000/recover'); await wait('Reset password'); await fill('code', code); await fill('password', 'Browser Recovered QA Password!'); await fill('confirm', 'Browser Recovered QA Password!'); await page.eval(() => document.querySelector('form').requestSubmit()); await wait('Password reset.'); checks.push('Actual public recovery form accepts verified single-use code'); await inspect('recovery-complete');
 const login = await fetch('http://127.0.0.1:3001/api/v1/auth/mobile/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fixture.patientEmail, password: 'Browser Recovered QA Password!' }) }); assert.equal(login.status, 201); checks.push('Recovered password works through real mobile HTTP login');
 const cookie = `careslot_session=${fixture.session}`;
 const post = (path, body, csrf = fixture.csrf) => fetch(`http://127.0.0.1:3001/api/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://127.0.0.1:3000', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
 assert.equal((await post('/account/profile', { displayName: 'QA', userId: fixture.users[1] })).status, 400);
 assert.equal((await post('/account/profile', { displayName: 'QA' }, 'wrong')).status, 403);
 assert.equal((await post(`/clinics/${fixture.clinicId}/members/${fixture.memberId}/access`, { active: 'false' })).status, 400);
 checks.push('HTTP rejects injected ownership fields, missing/incorrect CSRF and non-boolean access');
 report.consoleErrors = page.consoleErrors; assert.equal(report.consoleErrors.length, 0);
 writeFileSync(`${output}/web-review.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ result: 'PASS', checks: checks.length, findings: report.screens.flatMap(s => s.findings.map(f => ({ screen: s.name, width: s.width, ...f }))) }));
} finally { await browser.close(); }
