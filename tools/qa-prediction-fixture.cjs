require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client'), { PrismaPg } = require('@prisma/adapter-pg'), { JwtService } = require('@nestjs/jwt');
const { randomUUID, randomBytes } = require('node:crypto'), fs = require('node:fs'), assert = require('node:assert/strict');
const { AuthService, digest, userInclude } = require('../apps/api/dist/auth.service');
const { AppointmentsService } = require('../apps/api/dist/appointments.service');
const { clinicInstant, localParts, dateAfter } = require('../apps/api/dist/availability-policy');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const file = '.local/prediction-qa.json', output = 'qa/shared/prediction';
async function run() {
 if (process.argv[2] === 'cleanup') {
  const f = JSON.parse(fs.readFileSync(file));
  assert.equal(await db.user.count({ where: { id: { in: f.users }, email: { endsWith: '@careslot-qa.invalid' } } }), f.users.length);
  assert.equal(await db.doctorProfile.count({ where: { id: f.doctorId, membership: { userId: { in: f.users } } } }), 1);
  const visits = await db.appointment.findMany({ where: { doctorId: f.doctorId }, select: { id: true } });
  await db.$transaction(async tx => {
   await tx.appointmentEvent.deleteMany({ where: { appointmentId: { in: visits.map(v => v.id) } } }); await tx.appointment.deleteMany({ where: { doctorId: f.doctorId } });
   await tx.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: f.users } }, { subjectId: { in: visits.map(v => v.id) } }] } }); await tx.authSession.deleteMany({ where: { OR: [{ id: f.mobileSessionId }, { userId: { in: f.users } }] } });
   await tx.workingDay.deleteMany({ where: { doctorId: f.doctorId } }); await tx.doctorProfile.delete({ where: { id: f.doctorId } }); await tx.membership.deleteMany({ where: { userId: { in: f.users } } }); await tx.user.deleteMany({ where: { id: { in: f.users } } });
  }); fs.unlinkSync(file); console.log('Owned prediction QA accounts, visits, snapshots and test sessions removed. Existing patient preserved.'); return;
 }
 if (process.argv[2] === 'checkpoint') {
  const f = JSON.parse(fs.readFileSync(file)); const snapshots = await db.attendanceSnapshot.findMany({ where: { appointmentId: f.appointmentId }, orderBy: { appointmentVersion: 'asc' }, select: { appointmentVersion: true, status: true, modelVersion: true, modelSha256: true, noShowProbability: true, features: true, startsAt: true } });
  fs.writeFileSync(`${output}/phone-snapshots.json`, JSON.stringify({ recordedAt: new Date().toISOString(), snapshots }, null, 2)); console.log(JSON.stringify({ snapshots: snapshots.map(s => ({ version: s.appointmentVersion, status: s.status })) })); return;
 }
 if (process.argv[2] === 'http') {
  const f = JSON.parse(fs.readFileSync(file)), checks = [], header = { Cookie: `careslot_session=${f.session}`, Origin: 'http://127.0.0.1:3000', 'X-CSRF-Token': f.csrf, 'Content-Type': 'application/json' };
  const base = port => `http://127.0.0.1:${port}/api/v1`;
  const metadata = await fetch(`${base(3001)}/clinics/${f.clinicId}/prediction`, { headers: header }); assert.equal(metadata.status, 200); assert((await metadata.json()).available);
  const unavailable = await fetch(`${base(3002)}/clinics/${f.clinicId}/prediction`, { headers: header }); assert.equal(unavailable.status, 200); assert.equal((await unavailable.json()).available, false); checks.push('Real HTTP metadata distinguishes enabled and model-disabled APIs');
  for (const body of [{ seed: 1, sessions: 2001, overbookingEnabled: true }, { seed: 0, sessions: 1, overbookingEnabled: false }, { seed: 1, sessions: 1, overbookingEnabled: 'true' }, { seed: 1, sessions: 1, overbookingEnabled: false, patientId: f.patientId }]) { const r = await fetch(`${base(3001)}/clinics/${f.clinicId}/prediction/simulate`, { method: 'POST', headers: header, body: JSON.stringify(body) }); assert.equal(r.status, 400); } checks.push('DTO bounds/type/ownership injection rejected');
  assert.equal((await fetch(`${base(3001)}/clinics/${f.clinicId}/prediction/simulate`, { method: 'POST', headers: { ...header, 'X-CSRF-Token': 'wrong' }, body: '{}' })).status, 403); checks.push('Simulation POST requires valid CSRF');
  assert.equal((await fetch(`${base(3001)}/clinics/${f.clinicId}/prediction`)).status, 401); checks.push('Planning requires authentication');
  for (const enabled of [false, true]) { const r = await fetch(`${base(3002)}/clinics/${f.clinicId}/prediction/simulate`, { method: 'POST', headers: header, body: JSON.stringify({ seed: 1, sessions: 10, overbookingEnabled: enabled }) }); assert.equal(r.status, enabled ? 503 : 201); } checks.push('Disabled model permits standard comparison and rejects prediction-assisted simulation');
  const target = clinicInstant(f.date, 660, 'Asia/Kolkata').toISOString(), book = { clinicId: f.clinicId, doctorId: f.doctorId, startsAt: target, requestKey: randomUUID() };
  const mobileHeaders = { Authorization: `Bearer ${f.mobileAccess}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base(3002)}/patient/appointments`, { method: 'POST', headers: mobileHeaders, body: JSON.stringify({ ...book, predictedAttendance: .1 }) })).status, 400); checks.push('Patients cannot submit or spoof prediction inputs');
  const result = await fetch(`${base(3002)}/patient/appointments`, { method: 'POST', headers: mobileHeaders, body: JSON.stringify(book) }); assert.equal(result.status, 201); const visit = (await result.json()).appointment; assert.equal(visit.status, 'BOOKED'); assert.equal(visit.prediction.status, 'UNAVAILABLE');
  const retry = await fetch(`${base(3001)}/patient/appointments`, { method: 'POST', headers: mobileHeaders, body: JSON.stringify(book) }); assert.equal(retry.status, 201); assert.equal((await retry.json()).appointment.id, visit.id); checks.push('Actual HTTP booking works without model; retry after recovery preserves unavailable snapshot');
  fs.writeFileSync(`${output}/http-checks.json`, JSON.stringify({ recordedAt: new Date().toISOString(), result: 'PASS', checks }, null, 2)); console.log(`PASS ${checks.length} HTTP prediction scenario groups`); return;
 }
 if (fs.existsSync(file)) throw Error('Prediction fixture already exists');
 const auth = new AuthService(db, new JwtService({ secret: process.env.JWT_SECRET })); await auth.onModuleInit();
 const clinic = await db.clinic.findUniqueOrThrow({ where: { slug: 'careslot' } }), sam = await db.user.findUniqueOrThrow({ where: { email: 'sam@gmail.com' }, include: userInclude });
 const users = [], password = 'Fictional Prediction Fixture 2026!';
 const make = async role => { const u = await db.user.create({ data: { email: `predict-${randomUUID()}@careslot-qa.invalid`, displayName: `QA Prediction ${role}`, passwordHash: await auth.hash(password), memberships: { create: { clinicId: clinic.id, role, ...(role === 'DOCTOR' ? { doctor: { create: { specialty: 'QA only' } } } : {}) } } }, include: userInclude }); users.push(u.id); return u; };
 const doctor = await make('DOCTOR'), admin = await make('ADMIN'); const doctorId = doctor.memberships[0].doctor.id;
 await db.workingDay.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ doctorId, weekday, startMinute: 540, endMinute: 720 })) });
 const date = dateAfter(localParts(new Date(), clinic.timezone).date, 1);
 const session = await auth.webLogin({ email: doctor.email, password });
 const mobileSession = await db.authSession.create({ data: { userId: sam.id, client: 'MOBILE', tokenHash: digest(randomBytes(32).toString('hex')), expiresAt: new Date(Date.now() + 3600000) } });
 const mobileAccess = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sid: mobileSession.id, gen: 0 }, { subject: sam.id, issuer: 'careslot', audience: 'careslot-mobile', expiresIn: '1h', algorithm: 'HS256' });
 fs.mkdirSync(output, { recursive: true });
 const f = { clinicId: clinic.id, doctorId, users, patientId: sam.patient.id, date, session: session.secret, csrf: session.csrf, mobileSessionId: mobileSession.id, mobileAccess };
 fs.writeFileSync(file, JSON.stringify(f));
 for (let i = 0; i < 3; i++) { const end = new Date(Date.now() - (i + 1) * 86400000), start = new Date(+end - 1800000), status = i === 1 ? 'MISSED' : 'ATTENDED'; await db.appointment.create({ data: { clinicId: clinic.id, doctorId, patientId: sam.patient.id, requestKey: randomUUID(), requestedStart: start, startsAt: start, endsAt: end, status, timezone: clinic.timezone, events: { create: { actorId: doctor.id, action: status, toStartsAt: start, toEndsAt: end, createdAt: new Date(+end + 1000) } } } }); }
 const visit = (await new AppointmentsService(db).book({ user: sam, client: 'MOBILE' }, { clinicId: clinic.id, doctorId, startsAt: clinicInstant(date, 540, clinic.timezone).toISOString(), requestKey: randomUUID() })).appointment;
 f.appointmentId = visit.id; fs.writeFileSync(file, JSON.stringify(f)); console.log('Fictional prediction fixture ready; original phone session preserved.');
}
run().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
