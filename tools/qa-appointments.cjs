require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { AppointmentsService } = require('../apps/api/dist/appointments.service');
const { AvailabilityController, PatientAvailabilityController } = require('../apps/api/dist/availability.controller');
const { clinicInstant, dateAfter, localParts } = require('../apps/api/dist/availability-policy');
const { userInclude } = require('../apps/api/dist/auth.service');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const privatePath = '.local/appointments-qa.json', output = 'qa/shared/appointments';
const hash = text => createHash('sha256').update(text).digest('hex');
async function user(clinicId, role, name) {
  const id = randomUUID();
  return db.user.create({ data: { id, email: `booking-${id}@careslot-qa.invalid`, displayName: name, passwordHash: 'Unusable QA fixture password', ...(role ? { memberships: { create: { clinicId, role, ...(role === 'DOCTOR' ? { doctor: { create: { specialty: 'QA booking consultation' } } } : {}) } } } : { patient: { create: { clinics: { create: { clinicId } } } } }) }, include: userInclude });
}
async function cleanup(users, doctorIds, clinicId) {
  const safe = await db.user.count({ where: { id: { in: users }, email: { endsWith: '@careslot-qa.invalid' } } });
  assert.equal(safe, users.length, 'Refusing cleanup of unrelated users');
  await db.$transaction(async tx => {
    await tx.appointmentEvent.deleteMany({ where: { appointment: { doctorId: { in: doctorIds } } } });
    await tx.appointment.deleteMany({ where: { doctorId: { in: doctorIds } } });
    await tx.auditEvent.deleteMany({ where: { actorId: { in: users } } });
    await tx.authSession.deleteMany({ where: { userId: { in: users } } });
    await tx.workingDay.deleteMany({ where: { doctorId: { in: doctorIds } } });
    await tx.blockedPeriod.deleteMany({ where: { doctorId: { in: doctorIds } } });
    await tx.doctorProfile.deleteMany({ where: { id: { in: doctorIds } } });
    await tx.membership.deleteMany({ where: { userId: { in: users } } });
    await tx.clinicPatient.deleteMany({ where: { patient: { userId: { in: users } } } });
    await tx.patientProfile.deleteMany({ where: { userId: { in: users } } });
    await tx.user.deleteMany({ where: { id: { in: users } } });
    if (clinicId) await tx.clinic.delete({ where: { id: clinicId } });
  });
}
async function integration() {
  const clinic = await db.clinic.create({ data: { slug: `qa-booking-${randomUUID()}`, name: 'QA Booking Clinic' } });
  const users = [], doctors = [], checks = [];
  const check = label => checks.push(label);
  try {
    const add = async (role, name) => { const u = await user(clinic.id, role, name); users.push(u.id); if (role === 'DOCTOR') doctors.push(u.memberships[0].doctor.id); return u; };
    const d1 = await add('DOCTOR', 'QA Doctor One'), d2 = await add('DOCTOR', 'QA Doctor Two'), p1 = await add(null, 'QA Patient One'), p2 = await add(null, 'QA Patient Two'), admin = await add('ADMIN', 'QA Administrator');
    const actor = (u, client = u.patient ? 'MOBILE' : 'WEB') => ({ user: u, client });
    const a1 = actor(p1), a2 = actor(p2), doctorActor = actor(d1);
    const service = new AppointmentsService(db), schedules = new AvailabilityController(db), slots = new PatientAvailabilityController(db);
    const date = dateAfter(localParts(new Date(), clinic.timezone).date, 1), weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const when = minute => clinicInstant(date, minute, clinic.timezone).toISOString();
    const params = { clinicId: clinic.id, doctorId: doctors[0] };
    const schedule = { specialty: 'QA consultation', consultationMinutes: 30, version: 0, days: [{ weekday, startMinute: 540, endMinute: 720 }] };
    for (const d of [d1, d2]) await schedules.save({ actor: actor(d) }, { clinicId: clinic.id, doctorId: d.memberships[0].doctor.id }, schedule);
    const dto = (doctorId, minute) => ({ clinicId: clinic.id, doctorId, startsAt: when(minute), requestKey: randomUUID() });
    const first = dto(doctors[0], 540), second = dto(doctors[0], 540);
    const race = await Promise.allSettled([service.book(a1, first), service.book(a2, second)]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(race.find(r => r.status === 'rejected').reason.getStatus(), 409);
    const winnerIndex = race[0].status === 'fulfilled' ? 0 : 1, owner = winnerIndex === 0 ? a1 : a2, other = winnerIndex === 0 ? a2 : a1;
    const original = race[winnerIndex].value.appointment, originalRequest = winnerIndex === 0 ? first : second;
    check('Concurrent same-slot requests: exactly one confirmed visit');
    assert.equal((await service.book(owner, originalRequest)).appointment.id, original.id);
    await assert.rejects(() => service.book(owner, { ...originalRequest, startsAt: when(570) }), e => e.getStatus() === 409);
    check('Booking request keys replay the original result and reject different payloads');
    await assert.rejects(() => service.book(owner, dto(doctors[1], 540)), e => e.getStatus() === 409);
    check('Patient cannot overlap another doctor');
    await assert.rejects(() => service.reschedule(other, original.id, { version: 0, startsAt: when(570) }), e => e.getStatus() === 404);
    await assert.rejects(() => service.cancel(other, original.id, 0), e => e.getStatus() === 404);
    await assert.rejects(() => service.book(actor(d1), dto(doctors[0], 570)), e => e.getStatus() === 403);
    check('Patient ownership and mobile-only booking enforced');
    const occupied = (await service.book(other, dto(doctors[0], 600))).appointment;
    await assert.rejects(() => service.reschedule(owner, original.id, { version: 0, startsAt: when(600) }), e => e.getStatus() === 409);
    let row = await db.appointment.findUniqueOrThrow({ where: { id: original.id }, include: { events: true } });
    assert.equal(row.startsAt.toISOString(), when(540)); assert.equal(row.version, 0); assert.equal(row.events.length, 1);
    check('Failed reschedule retains identity, original times, version and history');
    const moved = (await service.reschedule(owner, original.id, { version: 0, startsAt: when(570) })).appointment;
    assert.equal(moved.id, original.id); assert.equal(moved.events.length, 2); assert.equal(new Date(moved.events[1].fromStartsAt).toISOString(), when(540));
    check('Successful reschedule preserves identity and records old/new times');
    const times = await slots.slots({ actor: owner }, params, { date });
    assert(times.slots.some(s => s.startsAt === when(540))); assert(!times.slots.some(s => s.startsAt === when(570)));
    await assert.rejects(() => slots.slots({ actor: other }, params, { date, excludeAppointmentId: original.id }), e => e.getStatus() === 404);
    check('Displayed slots agree with bookings; foreign reschedule exclusion denied');
    await assert.rejects(() => service.staffStatus(actor(d2), clinic.id, original.id, { status: 'CANCELLED', version: 1 }), e => e.getStatus() === 403);
    assert.equal((await service.queue(actor(d2), clinic.id, { date })).items.length, 0);
    assert.equal((await service.queue(doctorActor, clinic.id, { date })).items.length, 2);
    check('Doctor queues and status writes are restricted to own visits');
    await schedules.block({ actor: doctorActor }, params, { startsAt: `${date}T10:00`, endsAt: `${date}T10:30`, reason: 'QA schedule change' });
    row = await db.appointment.findUniqueOrThrow({ where: { id: occupied.id } });
    assert.equal(row.needsReview, true); assert.equal(row.startsAt.toISOString(), when(600)); assert.equal(row.endsAt.toISOString(), when(630));
    const block = await db.blockedPeriod.findFirstOrThrow({ where: { doctorId: doctors[0] } });
    await schedules.remove({ actor: doctorActor }, { ...params, blockId: block.id });
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: occupied.id } })).needsReview, false);
    check('Schedule conflicts flag existing visits without moving them; restoration clears flag');
    const fresh = await db.doctorProfile.findUniqueOrThrow({ where: { id: doctors[0] } });
    await schedules.save({ actor: doctorActor }, params, { ...schedule, consultationMinutes: 60, version: fresh.scheduleVersion });
    row = await db.appointment.findUniqueOrThrow({ where: { id: occupied.id } });
    assert.equal(row.needsReview, true); assert.equal(row.endsAt.toISOString(), when(630));
    await schedules.save({ actor: doctorActor }, params, { ...schedule, version: fresh.scheduleVersion + 1 });
    check('Duration changes preserve appointment interval snapshots');
    const ownerCurrent = await db.appointment.findUniqueOrThrow({ where: { id: original.id } });
    await assert.rejects(() => service.cancel(owner, original.id, ownerCurrent.version - 1), e => e.getStatus() === 409);
    await service.cancel(owner, original.id, ownerCurrent.version);
    assert((await slots.slots({ actor: owner }, params, { date })).slots.some(s => s.startsAt === when(570)));
    check('Stale mutation rejected; cancellation releases capacity');
    const current = await db.appointment.findUniqueOrThrow({ where: { id: occupied.id } });
    const moves = await Promise.allSettled([service.reschedule(other, occupied.id, { version: current.version, startsAt: when(630) }), service.reschedule(other, occupied.id, { version: current.version, startsAt: when(660) })]);
    assert.equal(moves.filter(r => r.status === 'fulfilled').length, 1); assert.equal(moves.find(r => r.status === 'rejected').reason.getStatus(), 409);
    check('Concurrent reschedules cannot overwrite one another');
    const parallel = await Promise.allSettled([service.book(owner, dto(doctors[0], 690)), service.book(owner, dto(doctors[1], 690))]);
    assert.equal(parallel.filter(r => r.status === 'fulfilled').length, 1);
    check('Concurrent different-doctor bookings serialize patient overlap checks');
    const active = await db.appointment.findUniqueOrThrow({ where: { id: occupied.id } });
    await assert.rejects(() => service.staffStatus(doctorActor, clinic.id, occupied.id, { status: 'ATTENDED', version: active.version }), e => e.getStatus() === 409);
    await assert.rejects(() => service.staffStatus(doctorActor, clinic.id, occupied.id, { status: 'MISSED', version: active.version }), e => e.getStatus() === 409);
    const past = await db.appointment.create({ data: { clinicId: clinic.id, doctorId: doctors[0], patientId: owner.user.patient.id, requestKey: randomUUID(), requestedStart: new Date(Date.now() - 7200000), startsAt: new Date(Date.now() - 7200000), endsAt: new Date(Date.now() - 5400000), timezone: clinic.timezone } });
    await service.staffStatus(doctorActor, clinic.id, past.id, { status: 'ATTENDED', version: 0 });
    await assert.rejects(() => service.staffStatus(doctorActor, clinic.id, past.id, { status: 'MISSED', version: 1 }), e => e.getStatus() === 409);
    check('Attendance timing and final-state transitions enforced');
    const history = await service.list(owner, { view: 'past' });
    assert(history.items.some(a => a.id === original.id && a.status === 'CANCELLED')); assert(history.items.some(a => a.id === past.id && a.status === 'ATTENDED'));
    check('Upcoming/past lists reflect cancelled and attended records');
    await assert.rejects(() => service.book(owner, dto(doctors[0], 900)), e => e.getStatus() === 409);
    await assert.rejects(() => service.queue(actor(admin), randomUUID(), { date }), e => e.getStatus() === 403);
    check('Unscheduled time and unrelated clinic requests rejected');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(`${output}/database-checks.json`, JSON.stringify({ recordedAt: new Date().toISOString(), result: 'PASS', checks, cleanup: 'Isolated fictional clinic removed in finally' }, null, 2));
    console.log(`PASS: ${checks.length} booking/database checks`);
  } finally { await cleanup(users, doctors, clinic.id); }
}
async function prepare() {
  if (fs.existsSync(privatePath)) throw new Error('Clean the existing booking fixture first');
  const clinic = await db.clinic.findUniqueOrThrow({ where: { slug: 'careslot' } });
  const doctor = await user(clinic.id, 'DOCTOR', 'QA Booking Doctor'), doctorId = doctor.memberships[0].doctor.id;
  const fixture = { users: [doctor.id], doctorIds: [doctorId], doctorId, clinicId: clinic.id };
  fs.mkdirSync('.local', { recursive: true }); fs.writeFileSync(privatePath, JSON.stringify(fixture));
  const date = dateAfter(localParts(new Date(), clinic.timezone).date, 1), weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  await new AvailabilityController(db).save({ actor: { user: doctor, client: 'WEB' } }, { clinicId: clinic.id, doctorId }, { specialty: 'QA booking consultation', consultationMinutes: 30, version: 0, days: [{ weekday, startMinute: 540, endMinute: 720 }] });
  const secret = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
  await db.authSession.create({ data: { userId: doctor.id, client: 'WEB', tokenHash: hash(secret), csrfHash: hash(csrf), expiresAt: new Date(Date.now() + 3600000) } });
  Object.assign(fixture, { date, session: secret, csrf }); fs.writeFileSync(privatePath, JSON.stringify(fixture));
  console.log(`Temporary booking doctor ready for ${date}, 09:00–12:00; private session not printed.`);
}
async function compete() {
  const fixture = JSON.parse(fs.readFileSync(privatePath));
  const competitor = await user(fixture.clinicId, null, 'QA Competing Patient');
  fixture.users.push(competitor.id); fixture.competitorId = competitor.patient.id;
  fs.writeFileSync(privatePath, JSON.stringify(fixture));
  await new AppointmentsService(db).book({ user: competitor, client: 'MOBILE' }, { clinicId: fixture.clinicId, doctorId: fixture.doctorId, startsAt: clinicInstant(fixture.date, 570, 'Asia/Kolkata').toISOString(), requestKey: randomUUID() });
  console.log('QA competing appointment saved at 09:30; stale phone choice should now fail safely.');
}
async function checkpoint(label) {
  assert(['booked', 'failed-reschedule', 'rescheduled', 'cancelled'].includes(label));
  const fixture = JSON.parse(fs.readFileSync(privatePath));
  const visit = await db.appointment.findFirstOrThrow({ where: { doctorId: fixture.doctorId, ...(fixture.competitorId ? { patientId: { not: fixture.competitorId } } : {}) }, include: { events: { orderBy: { createdAt: 'asc' } } } });
  if (fixture.phoneVisitId) assert.equal(visit.id, fixture.phoneVisitId, 'Phone appointment identity must stay the same');
  else { fixture.phoneVisitId = visit.id; fs.writeFileSync(privatePath, JSON.stringify(fixture)); }
  const minute = ['booked', 'failed-reschedule'].includes(label) ? 540 : 600;
  assert.equal(visit.startsAt.toISOString(), clinicInstant(fixture.date, minute, 'Asia/Kolkata').toISOString());
  assert.equal(visit.status, label === 'cancelled' ? 'CANCELLED' : 'BOOKED');
  assert.equal(visit.events.length, ['booked', 'failed-reschedule'].includes(label) ? 1 : label === 'rescheduled' ? 2 : 3);
  const result = { checkpoint: label, result: 'PASS', appointmentId: visit.id, startsAt: visit.startsAt, endsAt: visit.endsAt, status: visit.status, version: visit.version, events: visit.events.map(e => ({ action: e.action, fromStartsAt: e.fromStartsAt, toStartsAt: e.toStartsAt })) };
  fs.writeFileSync(`${output}/phone-${label}-database.json`, JSON.stringify(result, null, 2));
  console.log(`PASS: ${label} phone result matches authoritative PostgreSQL state and history.`);
}
(async () => {
  try {
    if (process.argv[2] === 'prepare') await prepare();
    else if (process.argv[2] === 'compete') await compete();
    else if (process.argv[2] === 'checkpoint') await checkpoint(process.argv[3]);
    else if (process.argv[2] === 'cleanup') { const fixture = JSON.parse(fs.readFileSync(privatePath)); await cleanup(fixture.users, fixture.doctorIds); fs.unlinkSync(privatePath); console.log('Booking QA fixture removed; unrelated patient and clinic records preserved.'); }
    else await integration();
  } finally { await db.$disconnect(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
