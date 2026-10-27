const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { LogisticAttendancePredictor, AttendanceModel } = require('../dist/attendance-model');
const { acceptsExtra, simulateScheduling } = require('../dist/scheduling-simulation');
const json = fs.readFileSync(path.join(__dirname, '../models/attendance_model.json'), 'utf8'), model = new LogisticAttendancePredictor(json);
test('server predictions match independent reference cases within 1e-12', () => {
 for (const c of JSON.parse(fs.readFileSync(path.join(__dirname, '../../../evaluation/reference_predictions.json')))) assert(Math.abs(model.noShowProbability(c) - c.expectedNoShow) < 1e-12);
});
test('new patient smoothing and positive no-show class are explicit', () => {
 const p = model.noShowProbability({ leadDays: 0, priorAppointments: 0, priorMissed: 0, reminderPlanned: false }); assert(Math.abs(p - .1859140281196037) < 1e-12); assert(Math.abs(1 - p - .8140859718803963) < 1e-12);
});
test('invalid feature ranges and counts rejected', () => {
 const f = { leadDays: 1, priorAppointments: 2, priorMissed: 1, reminderPlanned: false };
 for (const invalid of [{ leadDays: -1 }, { leadDays: 61 }, { leadDays: 1.5 }, { priorAppointments: 21 }, { priorMissed: 3 }, { priorMissed: -1 }, { reminderPlanned: 'true' }]) assert.throws(() => model.noShowProbability({ ...f, ...invalid }));
});
test('invalid metadata and parameters fail model loading', () => {
 for (const change of [{ positive_class: 'attended' }, { training_data: 'unknown' }, { features: ['wrong'] }, { scale: [0, 1, 1, 1] }, { weights: [1, 2] }, { intercept: null }, { history_smoothing: 'none' }, { feature_bounds: {} }]) assert.throws(() => new LogisticAttendancePredictor(JSON.stringify({ ...JSON.parse(json), ...change })));
 assert.throws(() => new LogisticAttendancePredictor('not json'));
});
test('disabled model is unavailable without throwing', () => {
 const before = process.env.ATTENDANCE_MODEL_ENABLED; process.env.ATTENDANCE_MODEL_ENABLED = 'false'; try { assert.equal(new AttendanceModel().metadata().available, false); } finally { if (before === undefined) delete process.env.ATTENDANCE_MODEL_ENABLED; else process.env.ATTENDANCE_MODEL_ENABLED = before; }
});
test('missing or invalid model artifact fails gracefully at provider startup', () => {
 const original = fs.readFileSync;
 try {
  fs.readFileSync = () => { throw Error('QA missing model file'); }; assert.equal(new AttendanceModel().metadata().available, false);
  fs.readFileSync = () => '{"features":[]}'; assert.equal(new AttendanceModel().metadata().available, false);
 } finally { fs.readFileSync = original; }
});
test('overbooking boundaries enforce two and expected attendance at most 1.2', () => {
 assert(acceptsExtra([.6], .6)); assert(!acceptsExtra([.6], .600000001)); assert(!acceptsExtra([.2, .2], .2)); assert(!acceptsExtra([.5], NaN)); assert(!acceptsExtra([.5], 1.1)); assert(!acceptsExtra([-.1], .3));
});
test('paired scheduling deterministic and identical with overbooking off', () => {
 const one = simulateScheduling(model, 20261025, 100, false); assert.deepEqual(one, simulateScheduling(model, 20261025, 100, false)); assert.deepEqual(one.policies.standard, one.policies.comparison); assert.equal(one.affectsLiveAppointments, false);
 const enabled = simulateScheduling(model, 20261025, 100, true); assert(enabled.policies.comparison.booked >= enabled.policies.standard.booked); assert(enabled.policies.comparison.booked <= 24); assert.equal(enabled.policies.standard.collisionSlots, 0);
});
test('missing model disables assisted simulation but permits standard comparison', () => {
 assert.throws(() => simulateScheduling(null, 1, 1, true)); const standard = simulateScheduling(null, 1, 1, false); assert.deepEqual(standard.policies.standard, standard.policies.comparison);
});
