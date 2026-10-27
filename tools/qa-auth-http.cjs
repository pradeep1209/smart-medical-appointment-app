require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client'), { PrismaPg } = require('@prisma/adapter-pg');
const { randomUUID } = require('node:crypto'), fs = require('node:fs'), assert = require('node:assert/strict'), argon2 = require('argon2');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const base = 'http://127.0.0.1:3001/api/v1', origin = 'http://127.0.0.1:3000', users = [], checks = [];
const password = 'Fictional Acceptance Password 2026!';
async function post(path, body, headers = {}) { return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); }
const mobile = value => ({ Authorization: `Bearer ${value}` });
async function web(email, pass = password) {
 const response = await post('/auth/web/login', { email, password: pass }, { Origin: origin }); assert.equal(response.status, 201);
 const cookies = response.headers.getSetCookie().map(v => v.split(';')[0]); const csrf = cookies.find(v => v.startsWith('careslot_csrf=')).split('=')[1];
 return { Cookie: cookies.join('; '), Origin: origin, 'X-CSRF-Token': csrf };
}
async function run() {
 const clinic = await db.clinic.findUniqueOrThrow({ where: { slug: 'careslot' } });
 const admin = await db.user.create({ data: { email: `auth-admin-${randomUUID()}@careslot-qa.invalid`, displayName: 'QA Acceptance Admin', passwordHash: await argon2.hash(password), memberships: { create: { clinicId: clinic.id, role: 'ADMIN' } } } }); users.push(admin.id);
 const email = `auth-patient-${randomUUID()}@careslot-qa.invalid`;
 try {
  const register = await post('/auth/mobile/register', { email, displayName: 'QA Acceptance Patient', password }); assert.equal(register.status, 201); const patient = await register.json(); users.push(patient.user.id); assert(patient.user.patientId); assert.equal(patient.user.memberships.length, 0); checks.push('Real patient registration creates only a patient identity');
  assert.equal((await post('/auth/mobile/register', { email, displayName: 'QA Duplicate', password })).status, 409);
  assert.equal((await post('/auth/mobile/register', { email: `inject-${randomUUID()}@careslot-qa.invalid`, displayName: 'QA Injection', password, role: 'ADMIN' })).status, 400); checks.push('Duplicate email and role injection are rejected');
  const badKnown = await post('/auth/mobile/login', { email, password: 'wrong' }), badUnknown = await post('/auth/mobile/login', { email: `absent-${randomUUID()}@careslot-qa.invalid`, password: 'wrong' }); assert.equal(badKnown.status, 401); assert.equal(badUnknown.status, 401); assert.equal((await badKnown.json()).message, (await badUnknown.json()).message); checks.push('Known and unknown wrong-password responses are equally generic');
  const a = await web(admin.email);
  assert.equal((await post('/auth/web/login', { email: admin.email, password }, { Origin: 'http://untrusted.invalid' })).status, 403);
  assert.equal((await post('/auth/web/login', { email, password }, { Origin: origin })).status, 403); assert.equal((await post('/auth/mobile/login', { email: admin.email, password })).status, 403); checks.push('Staff/patient login surfaces and login origin are enforced');
  const own = await fetch(base + '/auth/me', { headers: mobile(patient.accessToken) }); assert.equal(own.status, 200); assert(!JSON.stringify(await own.json()).includes('passwordHash'));
  const refreshed = await post('/auth/mobile/refresh', { refreshToken: patient.refreshToken }); assert.equal(refreshed.status, 201); const next = await refreshed.json();
  assert.equal((await fetch(base + '/auth/me', { headers: mobile(patient.accessToken) })).status, 401);
  assert.equal((await post('/auth/mobile/refresh', { refreshToken: patient.refreshToken })).status, 401); assert.equal((await fetch(base + '/auth/me', { headers: mobile(next.accessToken) })).status, 401); checks.push('Refresh rotates generations; replay revokes the session; secrets absent from account projection');
  const member = await post(`/clinics/${clinic.id}/invitations`, { email, displayName: 'QA Existing Patient', role: 'DOCTOR', specialty: 'QA only' }, a); assert.equal(member.status, 201); const invitation = await member.json(); const token = new URL(invitation.invitationUrl).hash.slice(7);
  assert.equal((await post('/auth/accept-invitation', { token, password: 'Wrong existing password!' })).status, 403);
  assert.equal((await post('/auth/accept-invitation', { token, password })).status, 201); assert.equal((await post('/auth/accept-invitation', { token, password })).status, 409); checks.push('Invitation acceptance requires existing password and is single use');
  const doctor = await web(email); assert.equal((await fetch(base + `/clinics/${clinic.id}/team`, { headers: doctor })).status, 403);
  assert.equal((await post('/account/profile', { displayName: 'QA Forbidden' }, { ...doctor, 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await post('/account/profile', { displayName: 'QA Forbidden', userId: admin.id }, doctor)).status, 400); checks.push('Real staff role, CSRF and self-profile boundaries are enforced');
  await post('/auth/logout', {}, doctor); assert.equal((await fetch(base + '/auth/me', { headers: doctor })).status, 401); checks.push('Web logout invalidates the actual server session');
  const active = await post('/auth/mobile/login', { email, password }); const session = await active.json(); assert.equal(active.status, 201); await post('/auth/logout', {}, mobile(session.accessToken)); assert.equal((await fetch(base + '/auth/me', { headers: mobile(session.accessToken) })).status, 401); checks.push('Mobile logout invalidates the server session');
  await db.user.update({ where: { id: patient.user.id }, data: { status: 'DISABLED' } }); assert.equal((await post('/auth/mobile/login', { email, password })).status, 401); await db.user.update({ where: { id: patient.user.id }, data: { status: 'ACTIVE' } }); checks.push('Disabled account cannot sign in');
  let rateStatus;
  for (let i = 0; i < 11; i++) rateStatus = (await post('/account/password', {}, {})).status;
  assert.equal(rateStatus, 429); checks.push('Password-change rate limit enforced without hashing invalid bodies');
  let authStatus;
  for (let i = 0; i < 45; i++) { authStatus = (await post('/auth/mobile/login', {})).status; if (authStatus === 429) break; }
  assert.equal(authStatus, 429); checks.push('Authentication rate limit enforced; helper restart resets local test buckets');
  fs.mkdirSync('qa/shared/local-readiness', { recursive: true }); fs.writeFileSync('qa/shared/local-readiness/auth-http.json', JSON.stringify({ recordedAt: new Date().toISOString(), result: 'PASS', checks }, null, 2)); console.log(`PASS ${checks.length} HTTP authentication scenario groups`);
 } finally {
  assert.equal(await db.user.count({ where: { id: { in: users }, email: { endsWith: '@careslot-qa.invalid' } } }), users.length);
  await db.staffInvitation.deleteMany({ where: { invitedById: { in: users } } }); await db.auditEvent.deleteMany({ where: { actorId: { in: users } } }); await db.authSession.deleteMany({ where: { userId: { in: users } } }); await db.doctorProfile.deleteMany({ where: { membership: { userId: { in: users } } } }); await db.membership.deleteMany({ where: { userId: { in: users } } }); await db.clinicPatient.deleteMany({ where: { patient: { userId: { in: users } } } }); await db.patientProfile.deleteMany({ where: { userId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } });
 }
}
run().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
