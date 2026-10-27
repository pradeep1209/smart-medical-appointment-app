require('dotenv').config({quiet:true});
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client'),{PrismaPg}=require('@prisma/adapter-pg'),{JwtService}=require('@nestjs/jwt'),argon2=require('argon2');
const {ExperienceService}=require('../apps/api/dist/experience.service'),{PrescriptionsService}=require('../apps/api/dist/prescriptions.service');
const {AuthService,userInclude}=require('../apps/api/dist/auth.service');
const {localParts,dateAfter,clinicInstant}=require('../apps/api/dist/availability-policy');
const {calendarText,validatePlan}=require('../apps/api/dist/experience-policy');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const privatePath='.local/experience-qa.json',out='qa/shared/experience',service=new ExperienceService(db),care=new PrescriptionsService(db);
const actor=user=>({user,client:user.patient?'MOBILE':'WEB'}),expect=status=>e=>e.getStatus?.()===status;
const medicine=(name='Fictional QA medicine')=>({name,dose:'Fictional dose',frequency:'As entered by QA clinician',duration:'QA seven days',instructions:'Fictional record for software testing only.'});
async function cleanup(f){
 assert.equal(f.kind,'experience-release');
 const c=await db.clinic.findUniqueOrThrow({where:{id:f.clinicId}});assert(c.slug.startsWith('qa-experience-'));
 assert.equal(await db.user.count({where:{id:{in:f.users},email:{endsWith:'@careslot-qa.invalid'}}}),f.users.length);
 await db.$transaction(async tx=>{
  const rx=await tx.prescription.findMany({where:{appointment:{clinicId:c.id}}});const ids=rx.map(r=>r.id);
  await tx.doseLog.deleteMany({where:{plan:{medicine:{prescriptionId:{in:ids}}}}});
  await tx.medicationPlan.deleteMany({where:{medicine:{prescriptionId:{in:ids}}}});
  await tx.documentGrant.deleteMany({where:{OR:[{appointment:{clinicId:c.id}},{document:{id:{in:f.documents||[]}}}]}});
  await tx.healthDocument.deleteMany({where:{id:{in:f.documents||[]}}});
  await tx.visitSummary.deleteMany({where:{appointment:{clinicId:c.id}}});
  await tx.inboxNotice.deleteMany({where:{clinicId:c.id}});
  await tx.auditEvent.deleteMany({where:{OR:[{clinicId:c.id},{actorId:{in:f.users}}]}});
  await tx.refillRequest.deleteMany({where:{prescriptionId:{in:ids}}});
  await tx.prescriptionMedicine.deleteMany({where:{prescriptionId:{in:ids}}});
  let pending=rx;while(pending.length){const parents=new Set(pending.flatMap(r=>[r.renewalOfId,r.replacesId]).filter(Boolean)),leaves=pending.filter(r=>!parents.has(r.id));assert(leaves.length);await tx.prescription.deleteMany({where:{id:{in:leaves.map(r=>r.id)}}});pending=pending.filter(r=>!leaves.some(l=>l.id===r.id));}
  await tx.appointmentEvent.deleteMany({where:{appointment:{clinicId:c.id}}});await tx.appointment.deleteMany({where:{clinicId:c.id}});
  await tx.authSession.deleteMany({where:{userId:{in:f.users}}});await tx.workingDay.deleteMany({where:{doctor:{membership:{clinicId:c.id}}}});await tx.blockedPeriod.deleteMany({where:{doctor:{membership:{clinicId:c.id}}}});
  await tx.doctorProfile.deleteMany({where:{membership:{clinicId:c.id}}});await tx.membership.deleteMany({where:{clinicId:c.id}});await tx.clinicPatient.deleteMany({where:{clinicId:c.id}});
  await tx.patientProfile.deleteMany({where:{userId:{in:f.users}}});await tx.user.deleteMany({where:{id:{in:f.users}}});await tx.clinic.delete({where:{id:c.id}});
 },{timeout:20000});
}
async function fixture(phone=false){
 const c=await db.clinic.create({data:{slug:`qa-experience-${randomUUID()}`,name:'QA Care Documents Clinic',address:'Fictional Care Street, Chennai',phone:'+91 00000 00000',contactEmail:'clinic@careslot-qa.invalid'}});
 const f={kind:'experience-release',clinicId:c.id,users:[],documents:[],phone};
 const save=()=>{if(phone)fs.writeFileSync(privatePath,JSON.stringify(f));};save();
 const password=`QA ${randomUUID()}!`,hash=await argon2.hash(password);
 async function user(role,name){const u=await db.user.create({data:{email:`experience-${randomUUID()}@careslot-qa.invalid`,displayName:name,passwordHash:hash,...(role?{memberships:{create:{clinicId:c.id,role,...(role==='DOCTOR'?{doctor:{create:{specialty:'Fictional QA care',qualifications:'QA qualification',registrationNumber:'QA-REG-ONLY'}}}:{})}}}:{patient:{create:{clinics:{create:{clinicId:c.id}}}}})},include:userInclude});f.users.push(u.id);save();return u;}
 const doctor=await user('DOCTOR','QA Experience Doctor'),other=await user('DOCTOR','QA Other Doctor'),admin=await user('ADMIN','QA Experience Admin'),reception=await user('RECEPTIONIST','QA Experience Reception');
 const patient=phone?await db.user.findUniqueOrThrow({where:{email:'sam@gmail.com'},include:userInclude}):await user(null,'QA Experience Patient');
 if(phone)await db.clinicPatient.create({data:{clinicId:c.id,patientId:patient.patient.id}});
 const foreign=await user(null,'QA Other Patient'),did=doctor.memberships[0].doctor.id,today=localParts(new Date(),'Asia/Kolkata').date;
 async function visit(status,date,minute){const startsAt=clinicInstant(date,minute,'Asia/Kolkata');return db.appointment.create({data:{clinicId:c.id,doctorId:did,patientId:patient.patient.id,status,timezone:'Asia/Kolkata',requestKey:randomUUID(),requestedStart:startsAt,startsAt,endsAt:new Date(+startsAt+1800000)}});}
 const attended=await visit('ATTENDED',dateAfter(today,-1),600),booked=await visit('BOOKED',dateAfter(today,2),600);
 for(let day=0;day<7;day++)await db.workingDay.create({data:{doctorId:did,weekday:day,startMinute:540,endMinute:1020}});
 const rx=(await care.issue(actor(doctor),c.id,{appointmentId:attended.id,requestKey:randomUUID(),notes:'Fictional instructions only.',medicines:[medicine()]})).prescription;
 f.doctorId=did;f.patientUserId=patient.id;f.patientId=patient.patient.id;f.visitId=attended.id;f.bookedId=booked.id;f.rxId=rx.id;f.medicineId=rx.medicines[0].id;f.today=today;
 const auth=new AuthService(db,new JwtService({secret:process.env.JWT_SECRET}));await auth.onModuleInit();
 const web=await auth.webLogin({email:doctor.email,password});f.session=web.secret;f.csrf=web.csrf;
 const adm=await auth.webLogin({email:admin.email,password});f.adminSession=adm.secret;f.adminCsrf=adm.csrf;
 if(!phone)f.mobile=(await auth.mobileLogin({email:patient.email,password})).accessToken;
 save();return {f,c,doctor,other,admin,reception,patient,foreign,attended,booked,rx,save};
}
async function run(){
 fs.mkdirSync(out,{recursive:true});
 if(process.argv[2]==='cleanup'){const f=JSON.parse(fs.readFileSync(privatePath));await cleanup(f);fs.unlinkSync(privatePath);console.log('Owned experience QA fixture removed; existing patient and sessions retained.');return;}
 if(process.argv[2]==='verify-phone'){
  const f=JSON.parse(fs.readFileSync(privatePath));assert.equal(f.kind,'experience-release');
  const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync(`${out}/prescription.pdf`)).digest('hex');
  const docs=await db.healthDocument.findMany({where:{patientId:f.patientId,filename:'CareSlot-QA-experience.pdf',sha256:hash}});assert.equal(docs.length,1);
  f.documents=[...new Set([...f.documents,docs[0].id])];fs.writeFileSync(privatePath,JSON.stringify(f));
  const plan=await db.medicationPlan.findUniqueOrThrow({where:{userId_medicineId:{userId:f.patientUserId,medicineId:f.medicineId}},include:{logs:true}});assert.equal(plan.enabled,false);assert.equal(plan.logs.length,1);assert.equal(plan.logs[0].status,'SKIPPED');
  const auth=new AuthService(db,new JwtService({secret:process.env.JWT_SECRET})),doctor=await auth.authenticate(undefined,f.session),shared=process.argv[3]==='shared';
  assert.equal((await service.bundle(doctor,f.clinicId)).sharedDocuments.some(g=>g.document.id===docs[0].id),shared);
  if(shared)assert.equal((await service.export(doctor,{kind:'document',id:docs[0].id})).base64,fs.readFileSync(`${out}/prescription.pdf`).toString('base64'));else await assert.rejects(()=>service.export(doctor,{kind:'document',id:docs[0].id}),expect(404));
  const resultFile=`${out}/phone-state-checks.json`,report=fs.existsSync(resultFile)?JSON.parse(fs.readFileSync(resultFile)):[];report.push({recordedAt:new Date().toISOString(),result:'PASS',checks:['Phone-uploaded bytes match the selected fictional PDF','Taken/skipped updates retain one dose log and reminder disable persisted',shared?'Assigned doctor can list/download the phone-shared document':'Revoking on phone removes listing and denies doctor download immediately']});fs.writeFileSync(resultFile,JSON.stringify(report,null,2));console.log(`PASS physical-phone database state and ${shared?'shared':'revoked'} doctor access.`);return;
 }
 if(process.argv[2]==='prepare'){assert(!fs.existsSync(privatePath),'Experience QA fixture already exists');const x=await fixture(true);await service.summary(actor(x.doctor),x.attended.id,{version:0,summary:'Fictional consultation completed for interface validation.',instructions:'Follow the fictional instructions recorded in this test visit.',followUpDate:dateAfter(x.f.today,2),followUpInstructions:'Book a fictional follow-up for demonstration.',issue:true});console.log('Owned fictional records ready for phone and dashboard checks.');return;}
 const x=await fixture(),{f,c,doctor,other,admin,reception,patient,foreign,attended,booked,rx}=x,checks=[];
 const pass=(name)=>{checks.push({name,expected:'Allowed scoped behavior; invalid/unrelated access denied',actual:'Assertions passed',result:'PASS'});console.log(`PASS ${name}`);};
 try{
  const mobile=actor(patient),own=actor(doctor),outsider=actor(foreign);
  const http=async(path,body,web=false,status=body===undefined?200:201)=>{const headers=web?{Cookie:`careslot_session=${f.session}; careslot_csrf=${f.csrf}`,Origin:'http://127.0.0.1:3000','X-CSRF-Token':f.csrf}:{Authorization:`Bearer ${f.mobile}`};const response=await fetch(`http://127.0.0.1:3001/api/v1${path}`,{method:body===undefined?'GET':'POST',headers:{...headers,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(response.status,status,(await response.clone().text()).slice(0,250));return response.json();};
  await http('/experience');await http('/experience/medication-plans');await http('/experience/exports',{kind:'prescription'},false,400);await http('/experience/exports',{kind:'document',id:rx.id,unexpected:true},false,400);pass('HTTP authentication, DTO whitelist and missing export IDs');
  for(const staff of [admin,reception,other])await assert.rejects(()=>service.prescriptionRecord(actor(staff),rx.id),e=>[403,404].includes(e.getStatus?.()));
  await assert.rejects(()=>service.prescriptionRecord(outsider,rx.id),expect(404));await assert.rejects(()=>service.export(outsider,{kind:'appointment',id:booked.id}),expect(404));
  assert.equal((await service.prescriptionRecord(mobile,rx.id)).id,rx.id);assert.equal((await service.visitRecord(own,attended.id)).id,attended.id);pass('Single-record links enforce patient ownership and assigned-doctor clinical access');
  const issued=await db.prescription.findUniqueOrThrow({where:{id:rx.id}}),snap=issued.issuedSnapshot;
  await service.clinicProfile(actor(admin),c.id,{version:0,name:'QA Updated Clinic',address:c.address,phone:c.phone,contactEmail:c.contactEmail});
  await service.doctorProfile(own,{version:0,qualifications:'QA updated qualification',registrationNumber:'QA-UPDATED'});
  assert.deepEqual((await db.prescription.findUniqueOrThrow({where:{id:rx.id}})).issuedSnapshot,snap);
  await assert.rejects(()=>service.clinicProfile(own,c.id,{version:1,name:'Wrong',address:'',phone:'',contactEmail:''}),expect(403));
  await assert.rejects(()=>service.clinicProfile(actor(admin),c.id,{version:0,name:'Wrong',address:'',phone:'',contactEmail:''}),expect(409));pass('Professional profile edits preserve issued identity; role and version checks');
  const summary={version:0,summary:'Fictional assessment for QA patient.',instructions:'Fictional self-care instructions.',followUpDate:dateAfter(f.today,7),followUpInstructions:'Choose an available visit after this date.',issue:false};
  await assert.rejects(()=>service.summary(own,booked.id,summary),expect(409));await assert.rejects(()=>service.summary(actor(other),attended.id,summary),expect(403));
  await service.summary(own,attended.id,summary);assert.equal((await service.visitRecord(mobile,attended.id)).summary,null);
  await service.summary(own,attended.id,{...summary,version:1,issue:true});assert.equal((await service.visitRecord(mobile,attended.id)).summary.followUpDate,summary.followUpDate);
  await assert.rejects(()=>service.summary(own,attended.id,{...summary,version:2,issue:true}),expect(409));assert.equal((await service.bundle(actor(reception),c.id)).visits.find(a=>a.id===attended.id).summary,null);pass('Draft privacy, attended-only summaries, final issue and follow-up persistence');
  const exportPdf=async(kind,id,name)=>{const r=await http('/experience/exports',{kind,...(id?{id}:{}),...(kind==='history'?{from:dateAfter(f.today,-2),to:f.today,timezone:'Asia/Kolkata'}:{})});const b=Buffer.from(r.base64,'base64');assert.equal(b.subarray(0,5).toString(),'%PDF-');fs.writeFileSync(`${out}/${name}.pdf`,b);return b;};
  const pdf=await exportPdf('prescription',rx.id,'prescription');await exportPdf('appointment',booked.id,'appointment');await exportPdf('history',null,'care-history');
  const verify=await service.verificationLink(mobile,rx.id),vr=await fetch(verify.url.replace(`http://${process.env.API_LAN_ADDRESS}:3001`,'http://127.0.0.1:3001'));assert.equal(vr.status,200);const html=await vr.text();assert(!html.includes(patient.displayName));assert(!html.includes('Fictional QA medicine'));assert(html.includes('QA Experience Doctor'));assert(html.includes('QA Care Documents Clinic'));
  fs.writeFileSync(`${out}/verification.html`,html);pass('Three real HTTP PDF exports and minimal QR verification without patient/medicine data');
  const ics=await http('/experience/exports',{kind:'calendar',id:booked.id});const text=Buffer.from(ics.base64,'base64').toString();assert(text.includes(`UID:${booked.id}@careslot`));assert(text.includes('DTSTART:'));assert(text.includes('STATUS:CONFIRMED'));fs.writeFileSync(`${out}/appointment.ics`,text);
  assert(calendarText({...booked,status:'CANCELLED'},c,doctor.displayName).includes('STATUS:CANCELLED'));pass('Calendar UID, UTC event times and cancellation status');
  await assert.rejects(()=>service.upload(mobile,{title:'Wrong format',filename:'x.png',mime:'image/png',dataBase64:pdf.toString('base64')}),expect(400));
  // Exercise the raised JSON limit with a real PDF larger than Express's default 100 KB.
  const large=Buffer.concat([pdf,Buffer.alloc(150000,32)]);const doc=(await http('/experience/documents',{title:'QA private report',filename:'qa-report.pdf',mime:'application/pdf',dataBase64:large.toString('base64')})).document;f.documents.push(doc.id);
  await assert.rejects(()=>service.export(own,{kind:'document',id:doc.id}),expect(404));await assert.rejects(()=>service.export(outsider,{kind:'document',id:doc.id}),expect(404));
  await service.share(mobile,doc.id,booked.id);assert.equal((await service.export(own,{kind:'document',id:doc.id})).base64,large.toString('base64'));
  await assert.rejects(()=>service.export(actor(admin),{kind:'document',id:doc.id}),expect(404));await assert.rejects(()=>service.export(actor(other),{kind:'document',id:doc.id}),expect(404));
  const grant=await db.documentGrant.findUniqueOrThrow({where:{documentId_appointmentId:{documentId:doc.id,appointmentId:booked.id}}});await service.revokeShare(mobile,grant.id);await assert.rejects(()=>service.export(own,{kind:'document',id:doc.id}),expect(404));
  await service.share(mobile,doc.id,booked.id);await db.documentGrant.update({where:{id:grant.id},data:{expiresAt:new Date(Date.now()-1000)}});await assert.rejects(()=>service.export(own,{kind:'document',id:doc.id}),expect(404));
  await service.share(mobile,doc.id,booked.id);await db.appointment.update({where:{id:booked.id},data:{status:'CANCELLED'}});await assert.rejects(()=>service.export(own,{kind:'document',id:doc.id}),expect(404));await service.deleteDocument(mobile,doc.id);assert.equal((await db.healthDocument.findUniqueOrThrow({where:{id:doc.id}})).data,null);pass('Private upload over 100 KB, explicit sharing, expiry, cancellation, revocation and removal');
  const schedule={medicineId:rx.medicines[0].id,times:['00:00'],timezone:'Asia/Kolkata',startDate:f.today,endDate:dateAfter(f.today,7),version:0,enabled:true,confirmed:true};
  await assert.rejects(()=>service.plan(mobile,{...schedule,confirmed:false}),expect(400));await assert.rejects(()=>service.plan(outsider,schedule),expect(404));
  const plan=(await service.plan(mobile,schedule)).plan;await assert.rejects(()=>service.plan(mobile,schedule),expect(409));
  for(const times of [['25:00'],['08:00','08:00']])assert.throws(()=>validatePlan(times,'Asia/Kolkata',f.today,f.today));
  const due=clinicInstant(f.today,0,'Asia/Kolkata').toISOString();await service.dose(mobile,plan.id,{scheduledAt:due,status:'TAKEN'});await service.dose(mobile,plan.id,{scheduledAt:due,status:'SKIPPED'});assert.equal(await db.doseLog.count({where:{planId:plan.id}}),1);await assert.rejects(()=>service.dose(outsider,plan.id,{scheduledAt:due,status:'TAKEN'}),expect(404));pass('Explicit reminder consent, patient ownership, schedule validation, versioning and dose-log upsert');
  const replacement={requestKey:randomUUID(),reason:'QA correction reason',notes:'QA corrected instructions',medicines:[medicine('Fictional corrected medicine')]};const next=await service.replace(own,rx.id,replacement);
  assert.equal((await service.replace(own,rx.id,replacement)).id,next.id);await assert.rejects(()=>service.replace(own,rx.id,{...replacement,medicines:[medicine('Different medicine')]}),expect(409));
  assert.equal((await service.verify(issued.verificationToken)).status,'REPLACED');assert.equal((await service.medicationPlans(mobile)).plans[0].available,false);await assert.rejects(()=>care.request(mobile,rx.id,{requestKey:randomUUID(),patientNote:'QA'}),expect(409));
  await service.plan(mobile,{...schedule,enabled:false,version:1});await service.revoke(own,next.id,'QA revoked replacement');assert.equal((await service.prescriptionRecord(mobile,next.id)).status,'REVOKED');assert.deepEqual((await db.prescription.findUniqueOrThrow({where:{id:rx.id}})).issuedSnapshot,snap);pass('Replacement preserves original, rejects changed replays, disables stale reminders/refills and supports revocation');
  const inbox=(await service.bundle(mobile)).notices;assert(inbox.some(n=>n.targetType==='SUMMARY'));assert(inbox.some(n=>n.targetType==='PRESCRIPTION'));assert.equal((await service.readNotice(outsider,inbox[0].id)).count,0);await service.readNotice(mobile,inbox[0].id);assert((await db.inboxNotice.findUniqueOrThrow({where:{id:inbox[0].id}})).readAt);assert((await service.bundle(actor(reception),c.id)).notices.every(n=>n.targetType==='APPOINTMENT'));pass('Role-scoped inbox, clinical notice privacy and per-user read state');
  await assert.rejects(()=>service.export(actor(admin),{kind:'history',from:f.today,to:f.today}),expect(403));await assert.rejects(()=>service.export(mobile,{kind:'history',from:f.today,to:dateAfter(f.today,367)}),expect(400));pass('Care-history export is patient-only and bounds date range');
  fs.writeFileSync(`${out}/service-checks.json`,JSON.stringify({recordedAt:new Date().toISOString(),result:'PASS',checks,fixture:'Fictional isolated clinic/patients; cleaned after run'},null,2));
 }finally{await cleanup(f);}
 console.log(`PASS ${checks.length} integrated scenario groups; fictional database records cleaned.`);
}
run().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>db.$disconnect());
