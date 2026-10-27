import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const skill = process.argv[2], mode = process.argv[3] ?? 'normal';
const f = JSON.parse(readFileSync('.local/prediction-qa.json'));
const { Browser } = await import(pathToFileURL(`${skill}/scripts/lib/cdp.mjs`));
const { probe, app } = await import(pathToFileURL(`${skill}/scripts/lib/probe.mjs`));
const { judgeApp } = await import(pathToFileURL(`${skill}/scripts/lib/rules.mjs`));
const browser = await Browser.launch(), output = 'qa/shared/prediction';
try {
 const page = await browser.newPage({ width: 1440, height: 1000 }); await page.send('Network.enable');
 await page.send('Network.setCookie', { name: 'careslot_session', value: f.session, url: 'http://127.0.0.1:3000', path: '/', httpOnly: true, sameSite: 'Strict' });
 await page.send('Network.setCookie', { name: 'careslot_csrf', value: f.csrf, url: 'http://127.0.0.1:3000', path: '/', sameSite: 'Strict' });
 const checks = [], screens = [];
 async function wait(text) { for (let i = 0; i < 40; i++) { if (await page.eval(t => document.body.innerText.includes(t), text)) return; await new Promise(r => setTimeout(r, 250)); } throw Error(`Missing UI: ${text}`); }
 async function inspect(name) { for (const [width, height] of [[1440,1000],[768,1024],[390,844]]) { await page.setViewport({ width, height, mobile: width < 600 }); await page.eval(() => { scrollTo(0,0); return document.fonts.ready; }); await page.screenshot({ path: `${output}/web-${name}-${width}.png`, format: 'png', fullPage: true }); const overflow = await page.eval(() => document.documentElement.scrollWidth > innerWidth); assert(!overflow); screens.push({ name, width, horizontalOverflow: overflow, findings: judgeApp(await page.eval(app), await page.eval(probe), { width }) }); } }
 await page.goto('http://127.0.0.1:3000/planning'); await wait('Run comparison');
 const disabled = await page.eval(() => document.getElementById('simulation-overbooking').disabled);
 assert.equal(disabled, mode === 'failure'); assert.equal(await page.eval(() => document.getElementById('simulation-overbooking').checked), false); checks.push('Overbooking starts off; availability follows server model state');
 await inspect(`${mode}-empty`);
 await page.eval(() => document.querySelector('.simulation-form').requestSubmit()); await wait('Comparison · off');
 const rows = await page.eval(() => [...document.querySelectorAll('.simulation-table tbody tr')].map(r => [...r.querySelectorAll('td')].map(c => c.textContent)));
 assert.equal(rows.length, 6); for (const row of rows) assert.equal(row[0], row[1]); checks.push('Actual standard comparison form returns identical paired results');
 if (mode !== 'failure') {
  await page.eval(() => document.getElementById('simulation-overbooking').click()); await page.eval(() => document.querySelector('.simulation-form').requestSubmit()); await wait('Controlled overbooking'); checks.push('Actual enabled simulation form renders the controlled comparison');
 }
 await inspect(`${mode}-results`);
 if (mode !== 'failure') {
  await page.goto(`http://127.0.0.1:3000/appointments?date=${f.date}`); await wait('estimated attendance · experimental'); await page.eval(() => { for (const item of document.querySelectorAll('.visit-prediction')) item.open = true; }); await wait('3 total · 1 missed'); checks.push('Doctor queue displays correct server-derived history counts and provenance'); await inspect('queue');
 }
 assert.equal(page.consoleErrors.length, 0); const report = { recordedAt: new Date().toISOString(), mode, result: 'PASS', checks, screens, consoleErrors: page.consoleErrors };
 writeFileSync(`${output}/web-${mode}-review.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ mode, result: 'PASS', findings: screens.flatMap(s => s.findings.map(item => ({ name: s.name, width: s.width, ...item }))) }));
} finally { await browser.close(); }
