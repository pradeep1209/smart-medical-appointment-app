require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client'), { PrismaPg } = require('@prisma/adapter-pg');
const { randomUUID } = require('node:crypto'), fs = require('node:fs'), assert = require('node:assert/strict');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const file = '.local/cache-refresh-probe.json';
async function run() {
 if (process.argv[2] === 'prepare') {
  assert(!fs.existsSync(file)); const clinic = await db.clinic.findUniqueOrThrow({ where: { slug: 'careslot' } });
  const user = await db.user.create({ data: { email: `refresh-probe-${randomUUID()}@careslot-qa.invalid`, displayName: 'QA Refresh Probe', passwordHash: 'Unusable fixture password', memberships: { create: { clinicId: clinic.id, role: 'DOCTOR', doctor: { create: { specialty: 'QA only' } } } } }, include: { memberships: { include: { doctor: true } } } });
  fs.writeFileSync(file, JSON.stringify({ userId: user.id, doctorId: user.memberships[0].doctor.id })); console.log('Temporary directory-only QA probe prepared.');
 } else {
  const f = JSON.parse(fs.readFileSync(file)); const user = await db.user.findUniqueOrThrow({ where: { id: f.userId } }); assert(user.email.startsWith('refresh-probe-') && user.email.endsWith('@careslot-qa.invalid'));
  assert.equal(await db.appointment.count({ where: { doctorId: f.doctorId } }), 0);
  await db.$transaction(async tx => { await tx.doctorProfile.delete({ where: { id: f.doctorId } }); await tx.membership.deleteMany({ where: { userId: user.id } }); await tx.user.delete({ where: { id: user.id } }); });
  fs.unlinkSync(file); console.log('Owned directory-only QA probe removed.');
 }
}
run().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
