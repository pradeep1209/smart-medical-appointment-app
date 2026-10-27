// Trusted local operator recovery only. Never accepts a password on the command line.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const argon2 = require('argon2');
const readline = require('node:readline');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function hidden(prompt) {
 if (!process.stdin.isTTY) throw Error('Run this command in an interactive local terminal.');
 process.stdout.write(prompt); readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
 return new Promise((resolve, reject) => {
  let value = '';
  const finish = () => { process.stdin.removeListener('keypress', onKey); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
  function onKey(text, key = {}) {
   if (key.ctrl && key.name === 'c') { finish(); reject(Error('Cancelled.')); }
   else if (key.name === 'return') { finish(); resolve(value); }
   else if (key.name === 'backspace') value = value.slice(0, -1);
   else if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) value += text;
  }
  process.stdin.on('keypress', onKey);
 });
}
async function main() {
 const email = process.argv[2]?.trim().toLowerCase(); if (!email) throw Error('Usage: node tools/recover-admin.cjs admin-email');
 const user = await db.user.findUnique({ where: { email }, include: { memberships: { where: { active: true, role: 'ADMIN' } } } });
 if (!user || user.status !== 'ACTIVE' || !user.memberships.length) throw Error('No active administrator with that email.');
 console.log(`Local recovery for ${email}. All their sessions will be revoked. Cancel with Ctrl+C.`);
 let password = await hidden('New password (12–128 characters, hidden): '); let confirmation = await hidden('Confirm password (hidden): ');
 if (password.length < 12 || password.length > 128 || password !== confirmation) throw Error('Passwords must match and contain 12–128 characters.');
 const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }); password = ''; confirmation = '';
 await db.$transaction(async tx => {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
  await tx.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
  await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await tx.accountRecovery.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  await tx.auditEvent.create({ data: { actorId: user.id, action: 'LOCAL_OPERATOR_ADMIN_RECOVERY', subjectId: user.id } });
 });
 console.log('Administrator password changed. Sign in again.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
