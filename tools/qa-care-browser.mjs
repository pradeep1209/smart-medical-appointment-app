import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const mode = process.argv[2], skill = process.argv[3];
if (!['issue','reject','approve','inspect'].includes(mode) || !skill) throw new Error('Use issue/reject/approve/inspect and the installed Taste skill directory');
const fixture = JSON.parse(readFileSync('.local/care-qa.json', 'utf8'));
const { Browser } = await import(pathToFileURL(`${skill}/scripts/lib/cdp.mjs`));
const { probe, app } = await import(pathToFileURL(`${skill}/scripts/lib/probe.mjs`));
const { judgeApp } = await import(pathToFileURL(`${skill}/scripts/lib/rules.mjs`));
const output = 'qa/shared/care'; mkdirSync(output, { recursive: true });
const browser = await Browser.launch();
try {
  const page = await browser.newPage({ width: 1440, height: 1000 });
  await page.send('Network.enable');
  await page.send('Network.setCookie', { name: 'careslot_session', value: fixture.session, url: 'http://127.0.0.1:3000', path: '/', httpOnly: true, sameSite: 'Strict' });
  await page.send('Network.setCookie', { name: 'careslot_csrf', value: fixture.csrf, url: 'http://127.0.0.1:3000', path: '/', sameSite: 'Strict' });
  await page.goto(`http://127.0.0.1:3000/care?appointmentId=${fixture.appointmentId}`);
  assert.equal(await page.eval(() => document.querySelector('h1')?.textContent), 'Prescriptions & refills');
  if (mode === 'inspect') await page.eval(() => [...document.querySelectorAll('.care-task')].find(b => b.textContent.startsWith('Refill reviews')).click());
  async function fill(id, text) {
    assert.equal(await page.eval(id => !!document.getElementById(id), id), true, `Input ${id} must exist`);
    await page.eval(id => document.getElementById(id).focus(), id);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await page.send('Input.insertText', { text });
  }
  async function waitFor(text) {
    for (let n = 0; n < 30; n++) { if (await page.eval(text => document.body.innerText.includes(text), text)) return; await new Promise(resolve => setTimeout(resolve, 300)); }
    throw new Error(`Expected care UI text not observed: ${text}`);
  }
  if (mode === 'issue') {
    assert.equal(await page.eval(() => document.getElementById('prescription-visit').value), fixture.appointmentId);
    const values = { name: 'QA Fictional Medicine', dose: 'QA dose', frequency: 'QA frequency', duration: 'QA duration', instructions: 'Fictional QA instructions only.' };
    for (const [key, value] of Object.entries(values)) await fill(`issue-0-${key}`, value);
    await page.eval(() => [...document.querySelectorAll('#issue-prescription button')].find(b => b.textContent === 'Add medicine').click());
    for (const [key, value] of Object.entries({ ...values, name: 'QA Second Fictional Medicine' })) await fill(`issue-1-${key}`, value);
    await fill('prescription-notes', 'QA original instructions for workflow testing only.');
    await page.eval(() => document.querySelector('#issue-prescription form').requestSubmit());
    await waitFor('Review before issuing');
    await page.screenshot({ path: `${output}/web-issue-preview.png`, format: 'png', fullPage: true });
    await page.eval(() => document.querySelector('#issue-prescription form').requestSubmit());
    await waitFor('Prescription issued to the patient.');
  }
  if (mode === 'reject' || mode === 'approve') {
    const id = await page.eval(() => document.querySelector('.refill-review select').id);
    const requestId = id.replace('decision-', '');
    await page.eval(({ id, value }) => { const select = document.getElementById(id); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }, { id, value: mode === 'approve' ? 'APPROVED' : 'REJECTED' });
    await fill(`review-note-${requestId}`, mode === 'approve' ? 'QA approval note: a new fictional prescription is available.' : 'QA rejection note for workflow testing.');
    if (mode === 'approve') {
      await fill(`renewal-${requestId}-0-name`, 'QA Renewed Medicine');
      await fill(`renewal-${requestId}-0-duration`, 'QA renewed duration');
      await fill(`renewal-notes-${requestId}`, 'QA renewal instructions only.');
    }
    await page.eval(() => document.querySelector('.refill-review form').requestSubmit());
    await waitFor(mode === 'approve' ? 'Approve and issue renewal' : 'Reject this request');
    await page.screenshot({ path: `${output}/web-${mode}-preview.png`, format: 'png', fullPage: true });
    await page.eval(() => document.querySelector('.refill-review form').requestSubmit());
    await waitFor(mode === 'approve' ? 'Refill approved and a new prescription issued.' : 'Refill request rejected with your note.');
  }
  await page.eval(() => { document.querySelectorAll('.issued-prescription,.care-decision').forEach(item => item.open = true); });
  const report = { recordedAt: new Date().toISOString(), mode, result: 'PASS: actual doctor form workflow', widths: [], consoleErrors: [] };
  for (const [width, height] of [[1440,1000],[768,1024],[390,844]]) {
    await page.setViewport({ width, height, mobile: width < 600 });
    await page.eval(() => { scrollTo(0,0); return document.fonts.ready; });
    await page.screenshot({ path: `${output}/web-${mode}-${width}.png`, format: 'png', fullPage: true });
    const overflow = await page.eval(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `No horizontal page overflow at ${width}`);
    report.widths.push({ width, horizontalOverflow: false, findings: judgeApp(await page.eval(app), await page.eval(probe), { width }) });
  }
  report.consoleErrors = page.consoleErrors;
  writeFileSync(`${output}/web-${mode}-review.json`, JSON.stringify(report, null, 2));
  if (page.consoleErrors.length) console.log(JSON.stringify({ consoleErrors: page.consoleErrors }));
  assert.equal(page.consoleErrors.length, 0);
  console.log(JSON.stringify({ mode, result: report.result, findings: report.widths.flatMap(w => w.findings.map(f => ({ width: w.width, ...f }))) }));
} finally { await browser.close(); }
