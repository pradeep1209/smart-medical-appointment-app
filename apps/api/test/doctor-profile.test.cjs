const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ClinicController } = require('../dist/controllers');

const controller = new ClinicController({});
const clinicId = '68cc2363-fc42-4893-a378-271d1d21c519';
function request(role = 'DOCTOR', client = 'WEB', doctor = { id: 'own-profile', specialty: 'Physiotherapy', consultationMinutes: 30 }) {
  return { actor: { client, user: { displayName: 'Fictional doctor', memberships: [{ clinicId, role, doctor, clinic: { name: 'Fictional clinic', timezone: 'Asia/Kolkata' } }] } } };
}
const forbidden = (action) => assert.throws(action, error => error.getStatus?.() === 403);

test('doctor profile comes from the authenticated membership and exposes only consultation fields', () => {
  assert.deepEqual(controller.doctorProfile(request(), { clinicId }), {
    clinic: { id: clinicId, name: 'Fictional clinic', timezone: 'Asia/Kolkata' },
    doctor: { id: 'own-profile', name: 'Fictional doctor', specialty: 'Physiotherapy', consultationMinutes: 30 },
  });
});
test('administration and reception cannot use the personal doctor-profile route', () => {
  for (const role of ['ADMIN', 'RECEPTIONIST']) forbidden(() => controller.doctorProfile(request(role), { clinicId }));
});
test('a doctor cannot read an unenrolled clinic or use a mobile session for clinic actions', () => {
  forbidden(() => controller.doctorProfile(request(), { clinicId: 'e743c9ab-de6c-4ee6-9c4b-fc3975cb78db' }));
  forbidden(() => controller.doctorProfile(request('DOCTOR', 'MOBILE'), { clinicId }));
});
test('a missing doctor profile stays missing instead of inventing a specialty or consultation length', () => {
  assert.equal(controller.doctorProfile(request('DOCTOR', 'WEB', null), { clinicId }).doctor, null);
});
