import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';
import { validDate, dateAfter, localParts } from './availability-policy';

export const prescriptionIdentity = () => ({ documentNumber: `RX-${randomBytes(8).toString('hex').toUpperCase()}`, verificationToken: randomBytes(24).toString('hex') });
export async function freezePrescription(tx: Prisma.TransactionClient, id: string, legacy = false) {
  await tx.$queryRaw`SELECT "id" FROM "Prescription" WHERE "id"=${id}::uuid FOR UPDATE`;
  const rx = await tx.prescription.findUniqueOrThrow({ where: { id }, include: { medicines: { orderBy: { position: 'asc' } }, issuer: { select: { displayName: true } }, appointment: { include: { clinic: true, patient: { include: { user: { select: { displayName: true } } } }, doctor: true } } } });
  if (rx.issuedSnapshot) return rx;
  const a=rx.appointment;
  const identity=prescriptionIdentity();
  const snapshot={schema:1,number:identity.documentNumber,issuedAt:rx.issuedAt.toISOString(),capturedAt:new Date().toISOString(),legacyIdentity:legacy,patient:{id:a.patientId,name:a.patient.user.displayName},doctor:{name:rx.issuer.displayName,qualifications:a.doctor.qualifications,registrationNumber:a.doctor.registrationNumber},clinic:{name:a.clinic.name,address:a.clinic.address,phone:a.clinic.phone,contactEmail:a.clinic.contactEmail,logoData:a.clinic.logoData},visitAt:a.startsAt.toISOString(),timezone:a.timezone,notes:rx.notes,medicines:rx.medicines.map(m=>({name:m.name,dose:m.dose,frequency:m.frequency,duration:m.duration,instructions:m.instructions}))};
  return tx.prescription.update({where:{id},data:{...identity,issuedSnapshot:snapshot}});
}
export async function notice(tx: Prisma.TransactionClient, userId: string, clinicId: string, title: string, body: string, targetType: string, targetId: string) {
  await tx.inboxNotice.create({data:{userId,clinicId,title,body,targetType,targetId}});
}
export async function appointmentNotices(tx: Prisma.TransactionClient, visit: {id:string;clinicId:string;patientId:string;doctorId:string}, title:string, body:string) {
  const [patient,doctor,staff]=await Promise.all([tx.patientProfile.findUniqueOrThrow({where:{id:visit.patientId},select:{userId:true}}),tx.doctorProfile.findUniqueOrThrow({where:{id:visit.doctorId},select:{membership:{select:{userId:true}}}}),tx.membership.findMany({where:{clinicId:visit.clinicId,active:true,role:{in:['ADMIN','RECEPTIONIST']},user:{status:'ACTIVE'}},select:{userId:true}})]);
  const users=new Set([patient.userId,doctor.membership.userId,...staff.map(s=>s.userId)]);
  for(const userId of users) await notice(tx,userId,visit.clinicId,title,body,'APPOINTMENT',visit.id);
}
export function safeFile(filename:string,mime:string,base64:string,limit=5*1024*1024) {
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)||base64.length%4!==0) throw new BadRequestException('The selected file could not be read.');
  const data=Buffer.from(base64,'base64');
  if(!data.length||data.length>limit) throw new BadRequestException('Choose a file no larger than 5 MB.');
  const actual=data.subarray(0,5).toString()==='%PDF-'?'application/pdf':data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':data[0]===255&&data[1]===216&&data[2]===255?'image/jpeg':'';
  if(actual!==mime) throw new BadRequestException('Choose a PDF, PNG or JPEG file with a matching file type.');
  const clean=filename.replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,160).trim();
  if(!clean) throw new BadRequestException('A filename is required.');
  return {data,filename:clean,mime,size:data.length,sha256:createHash('sha256').update(data).digest('hex')};
}
export function validatePlan(times:string[],timezone:string,startDate:string,endDate:string, enabled=true) {
  validDate(startDate);validDate(endDate);
  try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format();}catch{throw new BadRequestException('Choose a valid time zone.');}
  if(!times.length||times.length>6||new Set(times).size!==times.length||times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new BadRequestException('Confirm one to six different reminder times in HH:mm format.');
  const today=localParts(new Date(),timezone).date;
  if(endDate<startDate||endDate>dateAfter(startDate,90)||(enabled&&(endDate<today||startDate>dateAfter(today,90)))) throw new BadRequestException('Choose a current or upcoming schedule of at most 90 days.');
  return [...times].sort();
}
export const escapeHtml=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function calendarText(a:{id:string;startsAt:Date;endsAt:Date;status:string;version:number},clinic:{name:string;address:string},doctor:string) {
  const esc=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const date=(d:Date)=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CareSlot//Appointment//EN','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${a.id}@careslot`,`DTSTAMP:${date(new Date())}`,`SEQUENCE:${a.version}`,`DTSTART:${date(a.startsAt)}`,`DTEND:${date(a.endsAt)}`,`SUMMARY:${esc(`Consultation with ${doctor}`)}`,`LOCATION:${esc(clinic.address||clinic.name)}`,`DESCRIPTION:${esc(`${clinic.name}. Check CareSlot for the latest appointment status.`)}`,`STATUS:${a.status==='CANCELLED'?'CANCELLED':'CONFIRMED'}`,'END:VEVENT','END:VCALENDAR'];
  // RFC 5545 line folding uses bytes, so a UTF-8 character is never split.
  return lines.map(line=>{let out='',chunk='';for(const c of line){if(Buffer.byteLength(chunk+c)>73){out+=chunk+'\r\n ';chunk='';}chunk+=c;}return out+chunk;}).join('\r\n')+'\r\n';
}
