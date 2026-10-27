// Only creates and removes explicitly identified fictional QA records. Never prints credentials.
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { AvailabilityController, PatientAvailabilityController } = require('../apps/api/dist/availability.controller');
const { userInclude } = require('../apps/api/dist/auth.service');
const { localParts, dateAfter } = require('../apps/api/dist/availability-policy');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const privatePath = '.local/availability-qa.json';
const evidencePath = 'qa/shared/availability';
const hash = value => createHash('sha256').update(value).digest('hex');
async function makeUser(clinicId, role, prefix, patient = false) {
  const id = randomUUID();
  return db.user.create({ data: { id, email: `${prefix}-${id}@careslot-qa.invalid`, displayName: prefix === 'doctor' ? 'QA Availability Doctor' : `QA ${prefix}`, passwordHash: 'QA fixture has no usable password', ...(patient ? { patient: { create: { clinics: { create: { clinicId } } } } } : { memberships: { create: { clinicId, role, ...(role === 'DOCTOR' ? { doctor: { create: { specialty: 'QA consultation' } } } : {}) } } }) }, include: userInclude });
}
async function clean(users, clinicId) {
  if (!users.length) return;
  const safe = await db.user.findMany({ where: { id: { in: users }, email: { endsWith: '@careslot-qa.invalid' } }, select: { id: true } });
  assert.equal(safe.length, users.length, 'Cleanup refused: fixture ownership check failed');
  await db.$transaction(async tx => {
    const memberships = await tx.membership.findMany({ where: { userId: { in: users } }, select: { id: true } });
    const doctors = await tx.doctorProfile.findMany({ where: { membershipId: { in: memberships.map(m => m.id) } }, select: { id: true } });
    const ids = doctors.map(d => d.id);
    await tx.auditEvent.deleteMany({ where: { actorId: { in: users } } });
    await tx.authSession.deleteMany({ where: { userId: { in: users } } });
    await tx.blockedPeriod.deleteMany({ where: { doctorId: { in: ids } } });
    await tx.workingDay.deleteMany({ where: { doctorId: { in: ids } } });
    await tx.doctorProfile.deleteMany({ where: { id: { in: ids } } });
    await tx.membership.deleteMany({ where: { userId: { in: users } } });
    const patients = await tx.patientProfile.findMany({ where: { userId: { in: users } }, select: { id: true } });
    await tx.clinicPatient.deleteMany({ where: { patientId: { in: patients.map(p => p.id) } } });
    await tx.patientProfile.deleteMany({ where: { userId: { in: users } } });
    await tx.user.deleteMany({ where: { id: { in: users } } });
    if (clinicId) await tx.clinic.delete({ where: { id: clinicId } });
  });
}
async function integration() {
  const clinic = await db.clinic.create({ data: { slug: `qa-${randomUUID()}`, name: 'QA Availability Clinic' } });
  const users = [];
  try {
    const add = async (...args) => { const user = await makeUser(clinic.id, ...args); users.push(user.id); return user; };
    const doctor = await add('DOCTOR', 'doctor'), other = await add('DOCTOR', 'other-doctor'), admin = await add('ADMIN', 'admin'), reception = await add('RECEPTIONIST', 'reception'), patient = await add(null, 'patient', true);
    const actor = (user, client = 'WEB') => ({ actor: { user, client } });
    const controller = new AvailabilityController(db), patientController = new PatientAvailabilityController(db);
    const doctorId = doctor.memberships[0].doctor.id, p = { clinicId: clinic.id, doctorId };
    const date = dateAfter(localParts(new Date(), clinic.timezone).date, 1), weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const dto = { specialty: 'QA physiotherapy', consultationMinutes: 30, version: 0, days: [{ weekday, startMinute: 540, endMinute: 660 }] };
    const checkStatus = status => error => error.getStatus?.() === status;
    await assert.rejects(() => controller.save(actor(reception), p, dto), checkStatus(403));
    await assert.rejects(() => controller.save(actor(other), p, dto), checkStatus(403));
    await assert.rejects(() => controller.save(actor(doctor), p, { ...dto, days: [...dto.days, ...dto.days] }), checkStatus(400));
    const writes = await Promise.allSettled([controller.save(actor(doctor), p, dto), controller.save(actor(admin), p, dto)]);
    assert.equal(writes.filter(w => w.status === 'fulfilled').length, 1, 'One concurrent save must win');
    assert.equal(writes.find(w => w.status === 'rejected').reason.getStatus(), 409);
    let result = await patientController.slots(actor(patient, 'MOBILE'), p, { date });
    assert.equal(result.slots.length, 4);
    assert.equal(JSON.stringify(result).includes('reason'), false, 'Patient response must not expose staff reasons');
    await controller.block(actor(doctor), p, { startsAt: `${date}T09:30`, endsAt: `${date}T10:00`, reason: 'QA private time off' });
    result = await patientController.slots(actor(patient, 'MOBILE'), p, { date });
    assert.equal(result.slots.length, 3);
    await assert.rejects(() => controller.block(actor(doctor), p, { startsAt: `${date}T09:45`, endsAt: `${date}T10:15`, reason: 'QA overlap' }), checkStatus(409));
    await assert.rejects(() => controller.save(actor(doctor), p, dto), checkStatus(409));
    const own = await controller.schedules(actor(doctor), { clinicId: clinic.id });
    assert.equal(own.doctors.length, 1);
    const block = own.doctors[0].blockedPeriods[0];
    await assert.rejects(() => controller.remove(actor(other), { ...p, blockId: block.id }), checkStatus(403));
    await controller.remove(actor(admin), { ...p, blockId: block.id });
    assert.equal((await patientController.slots(actor(patient, 'MOBILE'), p, { date })).slots.length, 4);
    assert.equal((await patientController.slots(actor(patient, 'MOBILE'), p, { date: dateAfter(date, 1) })).slots.length, 0);
    await assert.rejects(() => patientController.slots(actor(patient, 'MOBILE'), { ...p, clinicId: randomUUID() }, { date }), checkStatus(403));
    assert.equal((await controller.schedules(actor(reception), { clinicId: clinic.id })).canEdit, false);
    fs.mkdirSync(evidencePath, { recursive: true });
    fs.writeFileSync(`${evidencePath}/database-checks.json`, JSON.stringify({ recordedAt: new Date().toISOString(), result: 'PASS', checks: ['Doctor ownership and reception read-only access', 'Concurrent edits: one success and one 409, no lost update', 'Repeated weekday rejected', 'Four full slots from two-hour session', 'Block removes overlap and preserves adjacent slots', 'Overlapping block rejected', 'Stale schedule save rejected', 'Doctor sees only own schedule', 'Removal restores slots', 'Closed day has no slots', 'Unenrolled clinic denied', 'Staff-only reasons absent from patient response'], fixtures: 'Fictional isolated clinic, removed in finally' }, null, 2));
    console.log('PASS: 12 database-backed availability checks');
  } finally { await clean(users, clinic.id); }
}
async function prepare() {
  if (fs.existsSync(privatePath)) throw new Error('Existing QA fixture must be cleaned first');
  const clinic = await db.clinic.findUniqueOrThrow({ where: { slug: 'careslot' } });
  const doctor = await makeUser(clinic.id, 'DOCTOR', 'doctor');
  const secret = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
  const session = await db.authSession.create({ data: { userId: doctor.id, client: 'WEB', tokenHash: hash(secret), csrfHash: hash(csrf), expiresAt: new Date(Date.now() + 3600000) } });
  const date = dateAfter(localParts(new Date(), clinic.timezone).date, 1), weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const controller = new AvailabilityController(db), req = { actor: { user: doctor, client: 'WEB' } }, p = { clinicId: clinic.id, doctorId: doctor.memberships[0].doctor.id };
  await controller.save(req, p, { specialty: 'QA consultation', consultationMinutes: 30, version: 0, days: [{ weekday, startMinute: 540, endMinute: 660 }] });
  await controller.block(req, p, { startsAt: `${date}T09:30`, endsAt: `${date}T10:00`, reason: 'QA time off' });
  fs.mkdirSync('.local', { recursive: true });
  fs.writeFileSync(privatePath, JSON.stringify({ users: [doctor.id], doctorId: p.doctorId, clinicId: clinic.id, date, sessionId: session.id, session: secret, csrf }));
  console.log(`QA doctor prepared; expected 3 times on ${date}, closed on following day. Credentials kept private.`);
}
(async () => {
  try {
    if (process.argv[2] === 'prepare') await prepare();
    else if (process.argv[2] === 'cleanup') { const fixture = JSON.parse(fs.readFileSync(privatePath, 'utf8')); await clean(fixture.users); fs.unlinkSync(privatePath); console.log('QA fixture removed; unrelated records preserved.'); }
    else await integration();
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
