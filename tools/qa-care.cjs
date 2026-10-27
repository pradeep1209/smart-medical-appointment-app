require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { PrescriptionsService } = require('../apps/api/dist/prescriptions.service');
const { userInclude } = require('../apps/api/dist/auth.service');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const output = 'qa/shared/care', privatePath = '.local/care-qa.json';
const medicine = (name = 'QA Fictional Medicine') => ({ name, dose: 'QA dose', frequency: 'QA frequency', duration: 'QA duration', instructions: 'Fictional QA instructions only.' });
const actor = user => ({ user, client: user.patient ? 'MOBILE' : 'WEB' });
async function makeUser(clinicId, role, displayName) {
  const id = randomUUID();
  return db.user.create({ data: { id, email: `care-${id}@careslot-qa.invalid`, displayName, passwordHash: 'No usable QA password', ...(role ? { memberships: { create: { clinicId, role, ...(role === 'DOCTOR' ? { doctor: { create: { specialty: 'QA care' } } } : {}) } } } : { patient: { create: { clinics: { create: { clinicId } } } } }) }, include: userInclude });
}
async function visit(clinicId, doctorId, patientId, status = 'ATTENDED') {
  return db.appointment.create({ data: { clinicId, doctorId, patientId, status, timezone: 'Asia/Kolkata', requestKey: randomUUID(), requestedStart: new Date(Date.now() - 7200000), startsAt: new Date(Date.now() - 7200000), endsAt: new Date(Date.now() - 5400000) } });
}
async function cleanup(users, doctorIds, clinicId) {
  assert.equal(await db.user.count({ where: { id: { in: users }, email: { endsWith: '@careslot-qa.invalid' } } }), users.length, 'Refusing to remove unrelated users');
  assert.equal(await db.doctorProfile.count({ where: { id: { in: doctorIds }, membership: { userId: { in: users } } } }), doctorIds.length, 'Refusing to remove doctors outside this QA fixture');
  await db.$transaction(async tx => {
    const rx = await tx.prescription.findMany({ where: { appointment: { doctorId: { in: doctorIds } } }, select: { id: true, renewalOfId: true } });
    const rxIds = rx.map(r => r.id);
    const refills = await tx.refillRequest.findMany({ where: { prescriptionId: { in: rxIds } }, select: { id: true } });
    await tx.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: users } }, { subjectId: { in: [...rxIds, ...refills.map(r => r.id)] } }] } });
    await tx.refillRequest.deleteMany({ where: { prescriptionId: { in: rxIds } } });
    await tx.prescriptionMedicine.deleteMany({ where: { prescriptionId: { in: rxIds } } });
    let remaining = rx;
    while (remaining.length) {
      const parents = new Set(remaining.map(r => r.renewalOfId).filter(Boolean));
      const leaves = remaining.filter(r => !parents.has(r.id));
      assert(leaves.length, 'Invalid QA renewal graph');
      await tx.prescription.deleteMany({ where: { id: { in: leaves.map(r => r.id) } } });
      const deleted = new Set(leaves.map(r => r.id)); remaining = remaining.filter(r => !deleted.has(r.id));
    }
    await tx.appointmentEvent.deleteMany({ where: { appointment: { doctorId: { in: doctorIds } } } });
    await tx.appointment.deleteMany({ where: { doctorId: { in: doctorIds } } });
    await tx.authSession.deleteMany({ where: { userId: { in: users } } });
    await tx.workingDay.deleteMany({ where: { doctorId: { in: doctorIds } } });
    await tx.blockedPeriod.deleteMany({ where: { doctorId: { in: doctorIds } } });
    await tx.doctorProfile.deleteMany({ where: { id: { in: doctorIds } } });
    await tx.membership.deleteMany({ where: { userId: { in: users } } });
    await tx.clinicPatient.deleteMany({ where: { patient: { userId: { in: users } } } });
    await tx.patientProfile.deleteMany({ where: { userId: { in: users } } });
    await tx.user.deleteMany({ where: { id: { in: users } } });
    if (clinicId) await tx.clinic.delete({ where: { id: clinicId } });
  }, { timeout: 15000 });
}
async function integration() {
  const clinic = await db.clinic.create({ data: { slug: `qa-care-${randomUUID()}`, name: 'QA Care Clinic' } });
  const users = [], doctors = [], checks = [];
  try {
    const add = async (role, name) => { const u = await makeUser(clinic.id, role, name); users.push(u.id); if (role === 'DOCTOR') doctors.push(u.memberships[0].doctor.id); return u; };
    const doctor = await add('DOCTOR', 'QA Doctor One'), other = await add('DOCTOR', 'QA Doctor Two'), patient = await add(null, 'QA Patient One'), foreign = await add(null, 'QA Patient Two'), admin = await add('ADMIN', 'QA Administrator'), reception = await add('RECEPTIONIST', 'QA Receptionist');
    const service = new PrescriptionsService(db), own = actor(doctor), mobile = actor(patient);
    const attended = await visit(clinic.id, doctors[0], patient.patient.id);
    const dto = { appointmentId: attended.id, requestKey: randomUUID(), notes: 'QA original notes', medicines: [medicine()] };
    const expect = status => error => error.getStatus?.() === status;
    for (const u of [admin, reception]) await assert.rejects(() => service.doctorCare(actor(u), clinic.id, {}), expect(403));
    await assert.rejects(() => service.issue({ ...own, client: 'MOBILE' }, clinic.id, dto), expect(403));
    await assert.rejects(() => service.issue(actor(other), clinic.id, dto), expect(404));
    checks.push('Only the assigned web doctor can issue/read clinical prescriptions; admin and reception denied');
    for (const status of ['BOOKED', 'CANCELLED', 'MISSED']) {
      const wrong = await visit(clinic.id, doctors[0], patient.patient.id, status);
      await assert.rejects(() => service.issue(own, clinic.id, { ...dto, appointmentId: wrong.id }), expect(409));
    }
    checks.push('Booked, cancelled and missed visits cannot receive a prescription');
    await assert.rejects(() => service.issue(own, clinic.id, { ...dto, medicines: [{ ...medicine(), dose: '   ' }] }), expect(400));
    checks.push('Whitespace-only medicine fields rejected before any prescription is saved');
    const issued = (await service.issue(own, clinic.id, dto)).prescription;
    assert.equal(issued.medicines[0].dose, 'QA dose'); assert.equal(issued.notes, dto.notes);
    assert.equal((await service.issue(own, clinic.id, dto)).prescription.id, issued.id);
    await assert.rejects(() => service.issue(own, clinic.id, { ...dto, notes: 'Changed payload' }), expect(409));
    await assert.rejects(() => service.issue(own, clinic.id, { ...dto, requestKey: randomUUID() }), expect(409));
    checks.push('Issued medicine/notes persisted; replay returns same document; duplicate or changed confirmations rejected');
    assert.equal((await service.patientCare(actor(foreign), {})).items.length, 0);
    await assert.rejects(() => service.request(actor(foreign), issued.id, { requestKey: randomUUID(), patientNote: 'QA request' }), expect(404));
    await assert.rejects(() => service.patientCare({ ...mobile, client: 'WEB' }, {}), expect(403));
    const care = (await service.patientCare(mobile, {})).items[0];
    assert.equal(care.id, issued.id); assert.equal(care.patient, undefined); assert(!JSON.stringify(care).includes('requestKey'));
    checks.push('Patient sees only own prescriptions; staff-only metadata and request identities are not exposed');
    const first = { requestKey: randomUUID(), patientNote: 'QA first request' };
    const request = (await service.request(mobile, issued.id, first)).request;
    assert.equal((await service.request(mobile, issued.id, first)).request.id, request.id);
    await assert.rejects(() => service.request(mobile, issued.id, { ...first, patientNote: 'Different note' }), expect(409));
    const waiting = await Promise.all([service.request(mobile, issued.id, { requestKey: randomUUID(), patientNote: 'QA duplicate one' }), service.request(mobile, issued.id, { requestKey: randomUUID(), patientNote: 'QA duplicate two' })]);
    assert(waiting.every(r => r.request.id === request.id)); assert.equal(await db.refillRequest.count({ where: { prescriptionId: issued.id, status: 'PENDING' } }), 1);
    assert.equal((await service.patientCare(mobile, {})).items[0].canRequestRefill, false);
    checks.push('Refill replay/concurrent duplicate requests retain one pending review and disable repeat action');
    const reject = { status: 'REJECTED', version: 0, reviewNote: 'QA rejected review note' };
    await assert.rejects(() => service.review(actor(other), clinic.id, request.id, reject), expect(404));
    for (const u of [admin, reception]) await assert.rejects(() => service.review(actor(u), clinic.id, request.id, reject), expect(403));
    checks.push('Refill decisions restricted to assigned doctor, independently of dashboard controls');
    await service.review(own, clinic.id, request.id, reject);
    await assert.rejects(() => service.review(own, clinic.id, request.id, reject), expect(409));
    const rejected = (await service.patientCare(mobile, {})).items[0];
    assert.equal(rejected.refillRequests[0].reviewNote, reject.reviewNote); assert.equal(rejected.canRequestRefill, true);
    checks.push('Rejection persists its note/history, is final, and permits a later new request');
    const second = (await service.request(mobile, issued.id, { requestKey: randomUUID(), patientNote: 'QA second request' })).request;
    await assert.rejects(() => service.review(own, clinic.id, second.id, { status: 'APPROVED', version: 0, reviewNote: 'QA note' }), expect(400));
    const approved = await service.review(own, clinic.id, second.id, { status: 'APPROVED', version: 0, reviewNote: 'QA approval note', medicines: [medicine('QA Renewed Medicine')], notes: 'QA renewed notes' });
    assert(approved.request.renewalId);
    const records = await service.patientCare(mobile, {}), original = records.items.find(r => r.id === issued.id), renewal = records.items.find(r => r.id === approved.request.renewalId);
    assert.equal(original.medicines[0].name, 'QA Fictional Medicine'); assert.equal(renewal.medicines[0].name, 'QA Renewed Medicine'); assert.equal(renewal.renewalOfId, issued.id); assert.equal(original.refillRequests.length, 2);
    checks.push('Approval requires clinician-confirmed medicine fields and atomically issues a linked immutable renewal');
    await assert.rejects(() => service.request(mobile, issued.id, { requestKey: randomUUID(), patientNote: 'QA obsolete prescription' }), expect(409));
    checks.push('Older renewed prescriptions cannot start another request');
    const raceRequests = await Promise.all([service.request(mobile, renewal.id, { requestKey: randomUUID(), patientNote: 'QA concurrent one' }), service.request(mobile, renewal.id, { requestKey: randomUUID(), patientNote: 'QA concurrent two' })]);
    assert.equal(raceRequests[0].request.id, raceRequests[1].request.id);
    const nextId = raceRequests[0].request.id;
    const reviews = await Promise.allSettled([service.review(own, clinic.id, nextId, { status: 'APPROVED', version: 0, reviewNote: 'QA concurrent approval', medicines: [medicine('QA Third Medicine')] }), service.review(own, clinic.id, nextId, { status: 'REJECTED', version: 0, reviewNote: 'QA concurrent rejection' })]);
    assert.equal(reviews.filter(r => r.status === 'fulfilled').length, 1); assert.equal(reviews.find(r => r.status === 'rejected').reason.getStatus(), 409);
    assert((await db.prescription.count({ where: { renewalOfId: renewal.id } })) <= 1);
    checks.push('Concurrent decisions produce one final review and at most one renewal');
    const latest = await db.prescription.findFirstOrThrow({ where: { appointmentId: attended.id, renewal: { is: null } } });
    await db.membership.update({ where: { id: doctor.memberships[0].id }, data: { active: false } });
    await assert.rejects(() => service.request(mobile, latest.id, { requestKey: randomUUID(), patientNote: 'QA inactive doctor request' }), expect(403));
    assert.equal((await service.patientCare(mobile, {})).items.find(r => r.id === latest.id).canRequestRefill, false);
    await db.membership.update({ where: { id: doctor.memberships[0].id }, data: { active: true } });
    checks.push('Inactive doctor blocks new refill requests without removing patient history');
    assert.equal((await service.doctorCare(actor(other), clinic.id, {})).items.length, 0);
    await assert.rejects(() => service.doctorCare(own, clinic.id, { appointmentId: randomUUID() }), expect(404));
    checks.push('Doctor list/deep links do not expose unassigned visits or prescriptions');
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(`${output}/database-checks.json`, JSON.stringify({ recordedAt: new Date().toISOString(), result: 'PASS', checks, cleanup: 'Isolated fictional clinic removed in finally' }, null, 2));
    console.log(`PASS: ${checks.length} prescription/refill database scenarios`);
  } finally { await cleanup(users, doctors, clinic.id); }
}
async function prepare() {
  if (fs.existsSync(privatePath)) throw new Error('Clean the existing care fixture first');
  const clinic = await db.clinic.findUniqueOrThrow({ where: { slug: 'careslot' } });
  const patient = await db.user.findUnique({ where: { email: process.env.CARESLOT_QA_PATIENT_EMAIL ?? 'sam@gmail.com' }, include: userInclude });
  if (!patient?.patient || !await db.clinicPatient.findUnique({ where: { clinicId_patientId: { clinicId: clinic.id, patientId: patient.patient.id } } })) throw new Error('The identified fictional phone patient is not connected to this clinic');
  const doctor = await makeUser(clinic.id, 'DOCTOR', 'QA Care Doctor');
  const fixture = { users: [doctor.id], doctorIds: [doctor.memberships[0].doctor.id], doctorId: doctor.memberships[0].doctor.id, clinicId: clinic.id, patientId: patient.patient.id };
  fs.mkdirSync('.local', { recursive: true }); fs.writeFileSync(privatePath, JSON.stringify(fixture));
  const attended = await visit(clinic.id, fixture.doctorId, patient.patient.id);
  const secret = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex'), hash = value => createHash('sha256').update(value).digest('hex');
  await db.authSession.create({ data: { userId: doctor.id, client: 'WEB', tokenHash: hash(secret), csrfHash: hash(csrf), expiresAt: new Date(Date.now() + 7200000) } });
  Object.assign(fixture, { appointmentId: attended.id, session: secret, csrf }); fs.writeFileSync(privatePath, JSON.stringify(fixture));
  fs.mkdirSync(output, { recursive: true }); console.log('QA Care Doctor and fictional attended visit prepared; private session not printed.');
}
async function checkpoint(label) {
  assert(['issued', 'pending', 'rejected', 'approved'].includes(label));
  const fixture = JSON.parse(fs.readFileSync(privatePath));
  const items = await db.prescription.findMany({ where: { appointmentId: fixture.appointmentId }, include: { medicines: { orderBy: { position: 'asc' } }, refillRequests: { orderBy: { requestedAt: 'asc' } } }, orderBy: { issuedAt: 'asc' } });
  assert(items.length > 0); const original = items.find(r => !r.renewalOfId);
  if (fixture.prescriptionId) assert.equal(original.id, fixture.prescriptionId); else { fixture.prescriptionId = original.id; fs.writeFileSync(privatePath, JSON.stringify(fixture)); }
  assert.equal(original.medicines[0].name, 'QA Fictional Medicine');
  if (label === 'pending') { assert.equal(original.refillRequests.length, 1); assert.equal(original.refillRequests[0].status, 'PENDING'); }
  if (label === 'rejected') { assert.equal(original.refillRequests[0].status, 'REJECTED'); assert.equal(items.length, 1); }
  if (label === 'approved') { assert.equal(original.refillRequests.length, 2); assert.equal(original.refillRequests[1].status, 'APPROVED'); assert.equal(items.length, 2); assert(items.some(r => r.renewalOfId === original.id && r.medicines[0].name === 'QA Renewed Medicine')); }
  fs.writeFileSync(`${output}/phone-${label}-database.json`, JSON.stringify({ checkpoint: label, result: 'PASS', prescriptionId: original.id, records: items.map(r => ({ id: r.id, renewalOfId: r.renewalOfId, medicines: r.medicines.map(m => ({ name: m.name, dose: m.dose, frequency: m.frequency, duration: m.duration, instructions: m.instructions })), refills: r.refillRequests.map(q => ({ status: q.status, patientNote: q.patientNote, reviewNote: q.reviewNote, renewalId: q.renewalId })) })) }, null, 2));
  console.log(`PASS: ${label} care state verified in PostgreSQL.`);
}
async function httpChecks() {
  const fixture = JSON.parse(fs.readFileSync(privatePath));
  const own = { Cookie: `careslot_session=${fixture.session}`, Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json', 'X-CSRF-Token': fixture.csrf };
  const results = [];
  const check = async (path, expected, headers, body) => {
    const response = await fetch(`http://127.0.0.1:3001/api/v1${path}`, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, expected, path); results.push({ path, expected, actual: response.status }); return response;
  };
  const refill = await db.refillRequest.findFirstOrThrow({ where: { prescriptionId: fixture.prescriptionId, status: 'PENDING' } });
  const dto = { appointmentId: fixture.appointmentId, requestKey: randomUUID(), medicines: [medicine()] };
  await check('/patient/care', 401, {});
  await check(`/clinics/${fixture.clinicId}/prescriptions`, 403, { ...own, 'X-CSRF-Token': '' }, dto);
  await check(`/clinics/${fixture.clinicId}/prescriptions`, 400, own, { ...dto, medicines: [{ ...medicine(), patientId: randomUUID() }] });
  await check(`/clinics/${fixture.clinicId}/refills/${refill.id}/review`, 400, own, { status: 'APPROVED', version: 0, reviewNote: 'QA invalid approval', medicines: [] });
  await check(`/clinics/${fixture.clinicId}/refills/${refill.id}/review`, 400, own, { status: 'REJECTED', version: 0, reviewNote: 'QA invalid rejection', medicines: [medicine()] });
  for (const role of ['ADMIN', 'RECEPTIONIST', 'DOCTOR', null]) {
    const u = await makeUser(fixture.clinicId, role, role ? `QA ${role} care access` : 'QA Other Care Patient');
    fixture.users.push(u.id); if (role === 'DOCTOR') fixture.doctorIds.push(u.memberships[0].doctor.id);
    fs.writeFileSync(privatePath, JSON.stringify(fixture));
    if (role) {
      const secret = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex'), hash = value => createHash('sha256').update(value).digest('hex');
      await db.authSession.create({ data: { userId: u.id, client: 'WEB', tokenHash: hash(secret), csrfHash: hash(csrf), expiresAt: new Date(Date.now() + 3600000) } });
      const headers = { ...own, Cookie: `careslot_session=${secret}`, 'X-CSRF-Token': csrf };
      await check(`/clinics/${fixture.clinicId}/care?appointmentId=${fixture.appointmentId}`, role === 'DOCTOR' ? 404 : 403, headers);
      await check(`/clinics/${fixture.clinicId}/prescriptions`, role === 'DOCTOR' ? 404 : 403, headers, dto);
      await check(`/clinics/${fixture.clinicId}/refills/${refill.id}/review`, role === 'DOCTOR' ? 404 : 403, headers, { status: 'REJECTED', version: 0, reviewNote: 'QA unassigned review' });
      if (role !== 'DOCTOR') await check(`/clinics/${fixture.clinicId}/appointments`, 200, headers);
    } else {
      const password = randomBytes(24).toString('hex');
      await db.user.update({ where: { id: u.id }, data: { passwordHash: await require('argon2').hash(password, { type: require('argon2').argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }) } });
      const login = await (await check('/auth/mobile/login', 201, { 'Content-Type': 'application/json' }, { email: u.email, password })).json();
      const headers = { Authorization: `Bearer ${login.accessToken}`, 'Content-Type': 'application/json' };
      const ownCare = await (await check('/patient/care', 200, headers)).json(); assert.equal(ownCare.items.length, 0);
      await check(`/patient/prescriptions/${fixture.prescriptionId}/refills`, 404, headers, { requestKey: randomUUID(), patientNote: 'QA foreign request' });
      await check(`/patient/prescriptions/${fixture.prescriptionId}/refills`, 400, headers, { requestKey: randomUUID(), patientNote: 'QA tampering', medicines: [medicine()] });
      await check(`/clinics/${fixture.clinicId}/care`, 403, headers);
    }
  }
  assert.equal(await db.refillRequest.count({ where: { prescriptionId: fixture.prescriptionId, status: 'PENDING' } }), 1);
  fs.writeFileSync(`${output}/http-checks.json`, JSON.stringify({ recordedAt: new Date().toISOString(), result: 'PASS', checks: results, state: 'Existing pending request and prescription unchanged' }, null, 2));
  console.log(`PASS: ${results.length} real HTTP care authorization/validation checks.`);
}
(async () => { try {
  if (process.argv[2] === 'prepare') await prepare();
  else if (process.argv[2] === 'checkpoint') await checkpoint(process.argv[3]);
  else if (process.argv[2] === 'http') await httpChecks();
  else if (process.argv[2] === 'cleanup') { const fixture = JSON.parse(fs.readFileSync(privatePath)); await cleanup(fixture.users, fixture.doctorIds); fs.unlinkSync(privatePath); console.log('Care QA records and private sessions removed; unrelated records preserved.'); }
  else await integration();
} finally { await db.$disconnect(); } })().catch(error => { console.error(error.message); process.exitCode = 1; });
