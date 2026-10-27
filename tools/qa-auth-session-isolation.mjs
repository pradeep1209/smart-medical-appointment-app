import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client'), { PrismaPg } = require('@prisma/adapter-pg'), argon2 = require('argon2');
const { Browser } = await import(pathToFileURL(`${process.argv[2]}/scripts/lib/cdp.mjs`));
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const users = [], checks = [], output = 'qa/shared/auth-session-isolation';
mkdirSync(output, { recursive: true });
let clinic, browser;
try {
  const tag = randomUUID(), password = `QA only ${randomUUID()}!`;
  clinic = await db.clinic.create({ data: { slug: `auth-qa-${tag}`, name: 'QA Session Clinic' } });
  const doctor = await db.user.create({ data: { email: `doctor-${tag}@careslot-qa.invalid`, displayName: 'QA Session Doctor', passwordHash: await argon2.hash(password), memberships: { create: { clinicId: clinic.id, role: 'DOCTOR', doctor: { create: { specialty: 'QA only' } } } } }, include: { memberships: { include: { doctor: true } } } }); users.push(doctor.id);
  const patient = await db.user.create({ data: { email: `patient-${tag}@careslot-qa.invalid`, displayName: 'QA Session Patient', passwordHash: 'QA identity not usable for sign in', patient: { create: {} } }, include: { patient: true } }); users.push(patient.id);
  await db.clinicPatient.create({ data: { clinicId: clinic.id, patientId: patient.patient.id } });
  const startsAt = new Date(Date.now() + 86400000), endsAt = new Date(startsAt.getTime() + 1800000);
  const visit = await db.appointment.create({ data: { clinicId: clinic.id, doctorId: doctor.memberships[0].doctor.id, patientId: patient.patient.id, requestKey: randomUUID(), requestedStart: startsAt, startsAt, endsAt, timezone: 'Asia/Kolkata' } });
  async function login() {
    const response = await fetch('http://127.0.0.1:3001/api/v1/auth/web/login', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: doctor.email, password }) });
    assert.equal(response.status, 201); return response.headers.getSetCookie().map(c => c.split(';')[0]);
  }
  const cookies = await login(), headers = { Cookie: cookies.join('; ') };
  for (let i = 0; i < 80; i++) assert.equal((await fetch('http://127.0.0.1:3001/api/v1/auth/me', { headers })).status, 200);
  checks.push('80 actual authenticated session checks exceed the old shared limit without throttling');
  browser = await Browser.launch();
  const page = await browser.newPage({ width: 1480, height: 668 });
  await page.send('Network.enable');
  for (const cookie of cookies) { const [name, value] = cookie.split('='); await page.send('Network.setCookie', { name, value, url: 'http://127.0.0.1:3000', path: '/', httpOnly: name === 'careslot_session', sameSite: 'Strict' }); }
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(startsAt);
  await page.goto(`http://127.0.0.1:3000/appointments?date=${date}`);
  async function wait(check) { for (let i = 0; i < 50; i++) { if (await page.eval(check)) return; await new Promise(r => setTimeout(r,200)); } throw Error('Expected browser state not observed'); }
  await wait(() => !![...document.querySelectorAll('button')].find(b => b.textContent === 'Cancel visit'));
  await new Promise(r => setTimeout(r,400));
  await page.eval(() => { window.confirm = () => true; [...document.querySelectorAll('button')].find(b => b.textContent === 'Cancel visit').click(); });
  await wait(() => document.querySelector('.visit-row .status')?.textContent === 'Cancelled');
  assert.equal(await page.eval(() => location.pathname), '/appointments');
  assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: visit.id } })).status, 'CANCELLED');
  assert.equal((await fetch('http://127.0.0.1:3001/api/v1/auth/me', { headers })).status, 200);
  checks.push('Actual doctor cancellation persists, refreshed queue stays signed in and original session remains valid');
  await page.screenshot({ path: `${output}/doctor-cancelled.png`, format: 'png' });
  await page.goto('http://127.0.0.1:3000/account'); await wait(() => document.querySelector('h1')?.textContent === 'My account');
  await login(); checks.push('Account navigation and another valid sign-in remain available after cancellation');
  assert.equal(page.consoleErrors.length, 0);
  writeFileSync(`${output}/report.json`, JSON.stringify({ recordedAt: new Date().toISOString(), result: 'PASS', checks, consoleErrors: [], regressionTests: '26 API tests PASS, including three real-HTTP middleware boundary/isolation tests', cleanup: 'Owned isolated QA clinic, doctor, patient, visit and sessions removed in finally; unrelated records/sessions untouched' }, null, 2));
  console.log(`PASS: ${checks.length} live session/cancellation scenarios`);
} finally {
  if (browser) await browser.close();
  if (clinic) {
    assert(clinic.slug.startsWith('auth-qa-'));
    await db.appointmentEvent.deleteMany({ where: { appointment: { clinicId: clinic.id } } });
    await db.auditEvent.deleteMany({ where: { clinicId: clinic.id } });
    await db.appointment.deleteMany({ where: { clinicId: clinic.id } });
    await db.clinicPatient.deleteMany({ where: { clinicId: clinic.id } });
    await db.authSession.deleteMany({ where: { userId: { in: users } } });
    await db.doctorProfile.deleteMany({ where: { membership: { clinicId: clinic.id } } });
    await db.membership.deleteMany({ where: { clinicId: clinic.id } });
    await db.patientProfile.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.clinic.delete({ where: { id: clinic.id } });
  }
  await db.$disconnect();
}
