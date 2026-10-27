import { config } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function seed() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password || password.length < 16) throw new Error('Configure a strong bootstrap administrator password in the local .env.');
  const existing = await db.user.findUnique({ where: { email }, include: { memberships: { include: { clinic: true } } } });
  if (existing) {
    if (!existing.memberships.some(m => m.role === 'ADMIN' && m.active && m.clinic.slug === 'careslot')) throw new Error('The bootstrap email belongs to another account. Select a different bootstrap email.');
    console.log('Clinic administrator already exists; credentials and records were preserved.'); return;
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  await db.$transaction(async tx => {
    const clinic = await tx.clinic.upsert({ where: { slug: 'careslot' }, update: {}, create: { slug: 'careslot', name: process.env.CLINIC_NAME ?? 'CareSlot Clinic' } });
    const admin = await tx.user.create({ data: { email, displayName: 'Clinic administrator', passwordHash, memberships: { create: { clinicId: clinic.id, role: 'ADMIN' } } } });
    await tx.auditEvent.create({ data: { actorId: admin.id, clinicId: clinic.id, action: 'CLINIC_BOOTSTRAPPED', subjectId: clinic.id } });
  });
  console.log('Clinic and administrator created. Sign in with the bootstrap email and password configured in your private .env.');
}
seed().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
