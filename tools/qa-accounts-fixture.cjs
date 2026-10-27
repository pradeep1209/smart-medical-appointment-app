require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { JwtService } = require('@nestjs/jwt');
const { AuthService, userInclude } = require('../apps/api/dist/auth.service');
const { PrescriptionsService } = require('../apps/api/dist/prescriptions.service');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs'); const assert = require('node:assert/strict');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const file = '.local/accounts-sync-qa.json';
async function run() {
 if (process.argv[2] === 'cleanup') {
  const f = JSON.parse(fs.readFileSync(file));
  assert.equal(await db.user.count({ where: { id: { in: f.users }, email: { endsWith: '@careslot-qa.invalid' } } }), f.users.length);
  const rx = await db.prescription.findMany({ where: { appointment: { doctorId: f.doctorId } }, select: { id: true } });
  await db.$transaction(async tx => {
   await tx.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: f.users } }, { subjectId: { in: [...f.visits, ...rx.map(r => r.id)] } }] } });
   await tx.refillRequest.deleteMany({ where: { prescriptionId: { in: rx.map(r => r.id) } } }); await tx.prescriptionMedicine.deleteMany({ where: { prescriptionId: { in: rx.map(r => r.id) } } }); await tx.prescription.deleteMany({ where: { id: { in: rx.map(r => r.id) } } });
   await tx.appointmentEvent.deleteMany({ where: { appointmentId: { in: f.visits } } }); await tx.appointment.deleteMany({ where: { id: { in: f.visits }, doctorId: f.doctorId } });
   await tx.accountRecovery.deleteMany({ where: { OR: [{ userId: { in: f.users } }, { issuerId: { in: f.users } }] } });
   await tx.authSession.deleteMany({ where: { userId: { in: f.users } } }); await tx.doctorProfile.delete({ where: { id: f.doctorId } }); await tx.membership.deleteMany({ where: { userId: { in: f.users } } }); await tx.clinicPatient.deleteMany({ where: { patient: { userId: { in: f.users } } } }); await tx.patientProfile.deleteMany({ where: { userId: { in: f.users } } }); await tx.user.deleteMany({ where: { id: { in: f.users } } });
  });
  fs.unlinkSync(file); console.log('Owned account/sync QA records removed. Existing patient and records preserved.'); return;
 }
 if (fs.existsSync(file)) throw Error('QA fixture already exists');
 const auth = new AuthService(db, new JwtService({ secret: process.env.JWT_SECRET })); await auth.onModuleInit();
 const clinic = await db.clinic.findUniqueOrThrow({ where: { slug: 'careslot' } });
 const sam = await db.user.findUniqueOrThrow({ where: { email: 'sam@gmail.com' }, include: userInclude });
 const password = 'Fictional Fixture Password 2026!'; const users = [];
 const make = async role => { const u = await db.user.create({ data: { email: `sync-${randomUUID()}@careslot-qa.invalid`, displayName: `QA Sync ${role ?? 'Patient'}`, passwordHash: await auth.hash(password), ...(role ? { memberships: { create: { clinicId: clinic.id, role, ...(role === 'DOCTOR' ? { doctor: { create: { specialty: 'QA only' } } } : {}) } } } : { patient: { create: { clinics: { create: { clinicId: clinic.id } } } } }) }, include: userInclude }); users.push(u.id); return u; };
 const admin = await make('ADMIN'), doctor = await make('DOCTOR'), patient = await make(null); const doctorId = doctor.memberships[0].doctor.id;
 const visits = [];
 for (const status of ['BOOKED', 'ATTENDED']) { const start = new Date(Date.now() + (status === 'BOOKED' ? 7200000 : -7200000)); const visit = await db.appointment.create({ data: { clinicId: clinic.id, doctorId, patientId: sam.patient.id, status, timezone: clinic.timezone, requestKey: randomUUID(), requestedStart: start, startsAt: start, endsAt: new Date(+start + 1800000), events: { create: { actorId: doctor.id, action: status, toStartsAt: start, toEndsAt: new Date(+start + 1800000) } } } }); visits.push(visit.id); }
 const rx = await new PrescriptionsService(db).issue({ user: doctor, client: 'WEB' }, clinic.id, { appointmentId: visits[1], requestKey: randomUUID(), notes: 'Fictional offline-cache check only.', medicines: [{ name: 'QA Cached Medicine', dose: 'QA dose', frequency: 'QA frequency', duration: 'QA duration', instructions: 'Fictional test instructions only.' }] });
 const session = await auth.webLogin({ email: admin.email, password });
 fs.writeFileSync(file, JSON.stringify({ clinicId: clinic.id, users, doctorId, memberId: doctor.memberships[0].id, visits, prescriptionId: rx.prescription.id, adminId: admin.id, session: session.secret, csrf: session.csrf, patientEmail: patient.email, password, samOriginalName: sam.displayName }));
 console.log('Fictional account/sync fixture ready; private credentials saved locally.');
}
run().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
