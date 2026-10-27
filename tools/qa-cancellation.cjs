require('dotenv').config({ quiet: true });
const fs = require('node:fs'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client'), { PrismaPg } = require('@prisma/adapter-pg'), { JwtService } = require('@nestjs/jwt'), argon2 = require('argon2');
const { AppointmentsService } = require('../apps/api/dist/appointments.service');
const { AuthService, userInclude } = require('../apps/api/dist/auth.service');
const { dateAfter, localParts, clinicInstant } = require('../apps/api/dist/availability-policy');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const file = '.local/cancellation-qa.json', out = 'qa/shared/cancellation';
async function run() {
 fs.mkdirSync(out, { recursive: true });
 if (process.argv[2] === 'cleanup') {
  const f = JSON.parse(fs.readFileSync(file)); assert.equal(f.kind,'cancellation-attribution');
  const clinic = await db.clinic.findUniqueOrThrow({ where: { id: f.clinicId } }); assert(clinic.slug.startsWith('qa-cancel-'));
  assert.equal(await db.user.count({ where: { id: { in: f.users }, email: { endsWith: '@careslot-qa.invalid' } } }), f.users.length);
  await db.$transaction(async tx => {
   await tx.appointmentEvent.deleteMany({ where: { appointment: { clinicId: f.clinicId } } });
   await tx.appointment.deleteMany({ where: { clinicId: f.clinicId } });
   await tx.auditEvent.deleteMany({ where: { clinicId: f.clinicId } });
   await tx.authSession.deleteMany({ where: { userId: { in: f.users } } });
   await tx.doctorProfile.deleteMany({ where: { membership: { clinicId: f.clinicId } } });
   await tx.membership.deleteMany({ where: { clinicId: f.clinicId } });
   await tx.clinicPatient.deleteMany({ where: { clinicId: f.clinicId } });
   await tx.user.deleteMany({ where: { id: { in: f.users } } });
   await tx.clinic.delete({ where: { id: f.clinicId } });
  }); fs.unlinkSync(file); console.log('Owned cancellation QA clinic, visits, staff and test sessions removed; existing patient/session retained.'); return;
 }
 if (fs.existsSync(file)) throw Error('Cancellation QA fixture already exists');
 const patient = await db.user.findUniqueOrThrow({ where: { email: 'sam@gmail.com' }, include: userInclude }); assert(patient.patient);
 const clinic = await db.clinic.create({ data: { slug: `qa-cancel-${randomUUID()}`, name: 'QA Cancellation Clinic' } });
 const f = { kind:'cancellation-attribution', clinicId:clinic.id, users:[], visits:[], date:dateAfter(localParts(new Date(),'Asia/Kolkata').date,2) };
 const save = () => fs.writeFileSync(file,JSON.stringify(f)); save();
 await db.clinicPatient.create({ data: { clinicId:clinic.id, patientId:patient.patient.id } });
 const password = `QA only ${randomUUID()}!`, staff = {};
 for (const role of ['DOCTOR','ADMIN','RECEPTIONIST']) {
  const u = await db.user.create({ data: { email:`cancel-${randomUUID()}@careslot-qa.invalid`,displayName:role === 'DOCTOR' ? 'QA Cancellation Doctor' : `QA ${role}`,passwordHash:await argon2.hash(password),memberships:{create:{clinicId:clinic.id,role,...(role === 'DOCTOR' ? {doctor:{create:{specialty:'QA cancellation'}}} : {})}} },include:userInclude });
  f.users.push(u.id); staff[role]=u; save();
 }
 f.doctorId=staff.DOCTOR.memberships[0].doctor.id;
 const service = new AppointmentsService(db), checks = [];
 for (const [index,role] of ['DOCTOR','PATIENT','ADMIN','RECEPTIONIST'].entries()) {
  const startsAt=clinicInstant(f.date,600+index*60,'Asia/Kolkata'),endsAt=new Date(startsAt.getTime()+1800000);
  const visit=await db.appointment.create({data:{clinicId:clinic.id,doctorId:f.doctorId,patientId:patient.patient.id,requestKey:randomUUID(),requestedStart:startsAt,startsAt,endsAt,timezone:'Asia/Kolkata'}});
  f.visits.push(visit.id); save();
  const actor={user:role === 'PATIENT' ? patient : staff[role],client:role === 'PATIENT' ? 'MOBILE':'WEB'};
  if(role === 'PATIENT') await service.cancel(actor,visit.id,0); else await service.staffStatus(actor,clinic.id,visit.id,{status:'CANCELLED',version:0});
  const event=await db.appointmentEvent.findFirstOrThrow({where:{appointmentId:visit.id,action:'CANCELLED'}});
  assert.equal(event.actorRole,role); assert.equal(event.actorDisplayName,actor.user.displayName);
  checks.push(`${role} cancellation saves actor role/name with the status transition`);
 }
 await db.membership.update({where:{id:staff.ADMIN.memberships[0].id},data:{role:'RECEPTIONIST'}});
 await db.user.update({where:{id:staff.DOCTOR.id},data:{displayName:'QA Cancellation Doctor Renamed'}});
 const patientList=await service.list({user:patient,client:'MOBILE'},{view:'past'});
 const own=patientList.items.filter(v=>f.visits.includes(v.id)); assert.equal(own.length,4);
 for(const role of ['DOCTOR','PATIENT','ADMIN','RECEPTIONIST']) assert(own.some(v=>v.cancellation.role===role));
 assert(own.find(v=>v.cancellation.role==='DOCTOR').cancellation.label.includes('QA Cancellation Doctor'));
 assert(!own.find(v=>v.cancellation.role==='DOCTOR').cancellation.label.includes('Renamed'));
 assert.equal(own.find(v=>v.cancellation.role==='PATIENT').cancellation.label,'Cancelled by you');
 assert.equal(own.find(v=>v.cancellation.role==='ADMIN').cancellation.label,'Cancelled by clinic administrator');
 assert(own.every(v=>v.events.every(e=>!('actorId' in e)&&!('actor' in e))));
 checks.push('Patient list includes all four labels, cancellation timestamps and safe event projections');
 checks.push('Later staff-role/name edits do not rewrite cancellation attribution');
 const auth=new AuthService(db,new JwtService({secret:process.env.JWT_SECRET})); await auth.onModuleInit();
 const login=await auth.webLogin({email:staff.DOCTOR.email,password}); f.session=login.secret;f.csrf=login.csrf;save();
 fs.writeFileSync(`${out}/service-checks.json`,JSON.stringify({recordedAt:new Date().toISOString(),result:'PASS',checks},null,2));
 console.log(`PASS ${checks.length} cancellation database scenario groups; owned fixture ready for browser/phone checks.`);
}
run().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
