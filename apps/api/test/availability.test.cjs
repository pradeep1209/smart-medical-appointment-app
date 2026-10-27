const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clinicInstant, dateInWindow, generateSlots, localInput } = require('../dist/availability-policy');
const { scheduleScope } = require('../dist/availability.controller');
const now = new Date('2026-10-25T00:00:00Z');
const hours = { startMinute: 540, endMinute: 660 };
const slots = (blocks = [], date = '2026-10-26') => generateSlots(date, 'Asia/Kolkata', 30, hours, blocks, now);
test('clinic local times cross UTC dates correctly and reject invalid dates and DST gaps', () => {
  assert.equal(clinicInstant('2026-10-26', 0, 'Asia/Kolkata').toISOString(), '2026-10-25T18:30:00.000Z');
  assert.equal(localInput('2026-10-26T09:00', 'Asia/Kolkata').toISOString(), '2026-10-26T03:30:00.000Z');
  assert.throws(() => localInput('2026-02-30T09:00', 'Asia/Kolkata'));
  assert.throws(() => clinicInstant('2026-03-08', 150, 'America/New_York'));
});
test('slots fit whole consultations, closed days and elapsed times have no availability', () => {
  assert.equal(slots().length, 4);
  assert.deepEqual(generateSlots('2026-10-26', 'Asia/Kolkata', 30, undefined, [], now), []);
  assert.equal(generateSlots('2026-10-26', 'Asia/Kolkata', 45, hours, [], now).length, 2);
  assert.equal(generateSlots('2026-10-24', 'Asia/Kolkata', 30, hours, [], now).length, 0);
  assert.throws(() => dateInWindow('2026-10-24', 'Asia/Kolkata', now));
  assert.throws(() => dateInWindow('2027-02-01', 'Asia/Kolkata', now));
});
test('blocked periods remove every overlap but preserve exact adjacent boundaries', () => {
  const block = { startsAt: new Date('2026-10-26T04:00:00Z'), endsAt: new Date('2026-10-26T04:30:00Z') };
  assert.deepEqual(slots([block]).map(s => s.startsAt), ['2026-10-26T03:30:00.000Z', '2026-10-26T04:30:00.000Z', '2026-10-26T05:00:00.000Z']);
  assert.equal(slots([{ startsAt: new Date('2026-10-26T03:45:00Z'), endsAt: new Date('2026-10-26T04:15:00Z') }]).length, 2);
});
test('scope allows doctor own edits and admin edits; rejects cross-doctor, reception writes, wrong clinic and mobile', () => {
  const request = (role, client = 'WEB') => ({ actor: { client, user: { memberships: [{ clinicId: 'clinic', role, doctor: { id: 'own' } }] } } });
  assert.equal(scheduleScope(request('DOCTOR'), 'clinic', 'own', true).role, 'DOCTOR');
  assert.equal(scheduleScope(request('ADMIN'), 'clinic', 'other', true).role, 'ADMIN');
  assert.equal(scheduleScope(request('RECEPTIONIST'), 'clinic').role, 'RECEPTIONIST');
  for (const args of [[request('DOCTOR'), 'clinic', 'other', true], [request('RECEPTIONIST'), 'clinic', 'own', true], [request('ADMIN'), 'other'], [request('ADMIN', 'MOBILE'), 'clinic']]) assert.throws(() => scheduleScope(...args), error => error.getStatus() === 403);
});
