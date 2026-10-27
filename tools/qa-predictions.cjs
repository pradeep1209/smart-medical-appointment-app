require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client'), { PrismaPg } = require('@prisma/adapter-pg');
const { randomUUID } = require('node:crypto'), fs = require('node:fs'), assert = require('node:assert/strict');
const { AppointmentsService } = require('../apps/api/dist/appointments.service');
const { AttendanceService } = require('../apps/api/dist/attendance.service');
const { AttendanceModel } = require('../apps/api/dist/attendance-model');
const { PredictionController } = require('../apps/api/dist/prediction.controller');
const { clinicInstant, dateAfter, localParts } = require('../apps/api/dist/availability-policy');
const { userInclude } = require('../apps/api/dist/auth.service');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function run() {
 const clinic = await db.clinic.create({ data: { slug: `qa-predict-${randomUUID()}`, name: 'QA Prediction Clinic' } });
 const users = [], checks = [], foreign = await db.clinic.create({ data: { slug: `qa-predict-foreign-${randomUUID()}`, name: 'QA Other Clinic' } });
 const make = async (role, c = clinic.id) => { const u = await db.user.create({ data: { email: `prediction-${randomUUID()}@careslot-qa.invalid`, displayName: `QA Prediction ${role ?? 'Patient'}`, passwordHash: 'No usable fixture password', ...(role ? { memberships: { create: { clinicId: c, role, ...(role === 'DOCTOR' ? { doctor: { create: { specialty: 'QA only' } } } : {}) } } } : { patient: { create: { clinics: { create: { clinicId: c } } } } }) }, include: userInclude }); users.push(u.id); return u; };
 const actor = u => ({ user: u, client: u.patient ? 'MOBILE' : 'WEB' });
 try {
  const doctor = await make('DOCTOR'), patient = await make(null), other = await make(null), admin = await make('ADMIN'), receptionist = await make('RECEPTIONIST'), fd = await make('DOCTOR', foreign.id);
  const doctorId = doctor.memberships[0].doctor.id, foreignDoctorId = fd.memberships[0].doctor.id;
  await db.workingDay.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ doctorId, weekday, startMinute: 540, endMinute: 1080 })) });
  const date = dateAfter(localParts(new Date(), clinic.timezone).date, 1), when = minute => clinicInstant(date, minute, clinic.timezone).toISOString();
  const service = new AppointmentsService(db), model = new AttendanceModel(); assert(model.predictor);
  const dto = (minute, p = patient) => ({ clinicId: clinic.id, doctorId, startsAt: when(minute), requestKey: randomUUID() });
  const request = dto(540), booked = (await service.book(actor(patient), request)).appointment;
  const original = await db.attendanceSnapshot.findFirstOrThrow({ where: { appointmentId: booked.id } });
  assert.equal(original.features.priorAppointments, 0); assert.equal(original.features.smoothedPriorNoShowRate, .25); assert.equal(original.features.reminderPlanned, false);
  assert(Math.abs(booked.prediction.attendanceProbability - (1 - model.predictor.noShowProbability({ leadDays: 1, priorAppointments: 0, priorMissed: 0, reminderPlanned: false }))) < 1e-12);
  assert.equal(booked.prediction.source, 'SERVER'); assert(!('features' in booked.prediction)); assert(!JSON.stringify(booked.prediction).includes('historyIds')); checks.push('New patient uses smoothing, server reminder=false and safe patient projection');
  const historyIds = [];
  async function outcome(index, status = 'ATTENDED', options = {}) {
   const endsAt = options.futureEnd ? new Date(Date.now() + 86400000) : new Date(Date.now() - (index + 1) * 86400000), startsAt = new Date(+endsAt - 1800000);
   return db.appointment.create({ data: { clinicId: options.foreign ? foreign.id : clinic.id, doctorId: options.foreign ? foreignDoctorId : doctorId, patientId: options.other ? other.patient.id : patient.patient.id, requestKey: randomUUID(), requestedStart: startsAt, startsAt, endsAt, status, timezone: clinic.timezone, ...(options.noEvent ? {} : { events: { create: { actorId: doctor.id, action: status, toStartsAt: startsAt, toEndsAt: endsAt, createdAt: options.late ? new Date(Date.now() + 86400000) : new Date(+endsAt + 1000) } } }) } });
  }
  for (let i = 0; i < 22; i++) { const row = await outcome(i, i % 2 ? 'MISSED' : 'ATTENDED'); if (i < 20) historyIds.push(row.id); }
  await outcome(0, 'CANCELLED'); await outcome(0, 'BOOKED'); await outcome(0, 'MISSED', { late: true }); await outcome(0, 'ATTENDED', { noEvent: true }); await outcome(0, 'ATTENDED', { futureEnd: true }); await outcome(0, 'MISSED', { other: true }); await outcome(0, 'MISSED', { foreign: true });
  const moved = (await service.reschedule(actor(patient), booked.id, { version: 0, startsAt: when(570) })).appointment;
  const latest = await db.attendanceSnapshot.findFirstOrThrow({ where: { appointmentId: booked.id, appointmentVersion: 1 } });
  assert.equal(latest.features.priorAppointments, 20); assert.equal(latest.features.priorMissed, 10); assert.deepEqual([...latest.historyIds].sort(), [...historyIds].sort());
  assert.equal(latest.features.smoothedPriorNoShowRate, 11 / 24); assert.notEqual(latest.noShowProbability, original.noShowProbability); checks.push('Latest 20 clinic outcomes selected; cancellations, future ends, late/missing events, other patients and other clinics excluded');
  assert.deepEqual(await db.attendanceSnapshot.findUniqueOrThrow({ where: { id: original.id } }), original); checks.push('Rescheduling creates another immutable snapshot and preserves original inputs/model fingerprint');
  assert.equal((await service.book(actor(patient), request)).appointment.id, booked.id); assert.equal(await db.attendanceSnapshot.count({ where: { appointmentId: booked.id } }), 2); checks.push('Booking replay retains current appointment without recomputing a prediction');
  await assert.rejects(() => service.reschedule(actor(patient), booked.id, { version: 0, startsAt: when(600) }), e => e.getStatus() === 409); assert.equal(await db.attendanceSnapshot.count({ where: { appointmentId: booked.id } }), 2); checks.push('Failed rescheduling adds no snapshot and preserves original booking');
  const disabled = new AppointmentsService(db, new AttendanceService({ predictor: null }));
  const fallback = (await disabled.book(actor(other), dto(600, other))).appointment;
  assert.equal(fallback.prediction.status, 'UNAVAILABLE'); assert.equal(fallback.prediction.attendanceProbability, null); assert.equal(fallback.status, 'BOOKED');
  await assert.rejects(() => service.book(actor(patient), dto(600)), e => e.getStatus() === 409); checks.push('Missing model preserves standard booking and never authorizes a shared slot');
  const raceRequest = dto(630, other); const race = await Promise.all([service.book(actor(other), raceRequest), service.book(actor(other), raceRequest)]); assert.equal(race[0].appointment.id, race[1].appointment.id); assert.equal(await db.attendanceSnapshot.count({ where: { appointmentId: race[0].appointment.id } }), 1); checks.push('Concurrent replay creates exactly one appointment/snapshot');
  const distantDate = dateAfter(localParts(new Date(), clinic.timezone).date, 90);
  const distant = (await service.book(actor(other), { ...dto(660), startsAt: clinicInstant(distantDate, 660, clinic.timezone).toISOString() })).appointment;
  const distantSnapshot = await db.attendanceSnapshot.findFirstOrThrow({ where: { appointmentId: distant.id } }); assert.equal(distantSnapshot.features.rawLeadDays, 90); assert.equal(distantSnapshot.features.leadDays, 60); assert.equal(distantSnapshot.features.leadDaysClamped, true); checks.push('90-day booking window remains usable with explicit 60-day model clamping');
  const cancelled = (await service.cancel(actor(patient), booked.id, moved.version)).appointment; assert.equal(cancelled.status, 'CANCELLED'); assert.equal(await db.attendanceSnapshot.count({ where: { appointmentId: booked.id } }), 2); checks.push('Cancellation retains historical prediction snapshots');
  const controller = new PredictionController(model);
  for (const denied of [actor(patient), actor(receptionist), { ...actor(admin), client: 'MOBILE' }]) assert.throws(() => controller.metadata({ actor: denied }, { clinicId: clinic.id }), e => e.getStatus() === 403);
  assert.throws(() => controller.metadata({ actor: actor(doctor) }, { clinicId: foreign.id }), e => e.getStatus() === 403);
  assert(controller.metadata({ actor: actor(admin) }, { clinicId: clinic.id }).available); checks.push('Planning metadata enforces web admin/doctor and clinic scope');
  const beforeCount = await db.appointment.count({ where: { clinicId: clinic.id } }); const simulation = controller.simulate({ actor: actor(admin) }, { clinicId: clinic.id }, { seed: 20261025, sessions: 500, overbookingEnabled: true });
  assert.deepEqual(simulation, controller.simulate({ actor: actor(admin) }, { clinicId: clinic.id }, { seed: 20261025, sessions: 500, overbookingEnabled: true })); assert.equal(await db.appointment.count({ where: { clinicId: clinic.id } }), beforeCount); checks.push('Server simulation is reproducible and writes no real appointments');
  const view = await service.queue(actor(doctor), clinic.id, { date }); const shown = view.items.find(v => v.id === booked.id); assert.equal(shown.prediction.features.priorAppointments, 20); assert(!JSON.stringify(shown.prediction).includes('historyIds')); checks.push('Assigned doctor sees feature counts and provenance without historical appointment IDs');
  fs.mkdirSync('qa/shared/prediction', { recursive: true }); fs.writeFileSync('qa/shared/prediction/database-checks.json', JSON.stringify({ recordedAt: new Date().toISOString(), result: 'PASS', checks }, null, 2)); fs.writeFileSync('qa/shared/prediction/simulation.json', JSON.stringify(simulation, null, 2)); console.log(`PASS ${checks.length} prediction/database scenario groups`);
 } finally {
  assert.equal(await db.user.count({ where: { id: { in: users }, email: { endsWith: '@careslot-qa.invalid' } } }), users.length);
  await db.appointmentEvent.deleteMany({ where: { actorId: { in: users } } }); await db.appointment.deleteMany({ where: { clinicId: { in: [clinic.id, foreign.id] } } }); await db.auditEvent.deleteMany({ where: { actorId: { in: users } } });
  await db.workingDay.deleteMany({ where: { doctor: { membership: { userId: { in: users } } } } }); await db.doctorProfile.deleteMany({ where: { membership: { userId: { in: users } } } }); await db.membership.deleteMany({ where: { userId: { in: users } } }); await db.clinicPatient.deleteMany({ where: { clinicId: { in: [clinic.id, foreign.id] } } }); await db.patientProfile.deleteMany({ where: { userId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } }); await db.clinic.deleteMany({ where: { id: { in: [clinic.id, foreign.id] } } });
 }
}
run().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
