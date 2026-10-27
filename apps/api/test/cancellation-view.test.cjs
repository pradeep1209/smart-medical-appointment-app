const test = require('node:test'), assert = require('node:assert/strict');
const { cancellationView } = require('../dist/cancellation-view');
const { appointmentView } = require('../dist/appointment-policy');
const event = (role, id = 'staff') => ({ actorId: id, actorRole: role, actorDisplayName: 'Name at cancellation', actor: { displayName: 'Renamed later' } });

test('cancellation identifies patient, doctor, administrator and reception with stable snapshots', () => {
 assert.equal(cancellationView(event('PATIENT','patient'),'patient','doctor',false).label,'Cancelled by you');
 assert.equal(cancellationView(event('PATIENT','patient'),'patient','doctor',true).label,'Cancelled by patient');
 assert.equal(cancellationView(event('DOCTOR','doctor'),'patient','doctor',false).label,'Cancelled by doctor · Name at cancellation');
 assert.equal(cancellationView(event('ADMIN'),'patient','doctor',false).label,'Cancelled by clinic administrator');
 assert.equal(cancellationView(event('RECEPTIONIST'),'patient','doctor',false).label,'Cancelled by reception');
 assert.equal(cancellationView(event('ADMIN'),'patient','doctor',false).name,null);
 assert.equal(cancellationView(event('ADMIN'),'patient','doctor',true).name,'Name at cancellation');
});

test('older records use the saved actor identity without guessing historical staff roles', () => {
 assert.equal(cancellationView(event(null,'patient'),'patient','doctor',false).role,'PATIENT');
 assert.equal(cancellationView(event(null,'doctor'),'patient','doctor',false).role,'DOCTOR');
 assert.equal(cancellationView(event(null),'patient','doctor',false).label,'Cancelled by clinic');
 assert.equal(cancellationView(event(null,'same'),'same','same',false).role,'UNKNOWN');
});

test('patient appointment projection exposes cancellation time and safe labels without raw actor data', () => {
 const at = new Date('2026-10-25T10:00:00Z');
 const value = { id:'visit', clinic:{id:'clinic',name:'Clinic'}, timezone:'Asia/Kolkata', doctor:{id:'doctor',specialty:'QA',membership:{userId:'doctor-user',user:{displayName:'Doctor'}}},patient:{id:'patient-profile',userId:'patient',user:{displayName:'Patient',email:'private@example.invalid'}},startsAt:at,endsAt:at,status:'CANCELLED',version:1,needsReview:false,createdAt:at,attendanceSnapshots:[],events:[{id:'event',action:'CANCELLED',createdAt:at,...event('ADMIN')}] };
 const view = appointmentView(value);
 assert.equal(view.cancellation.label,'Cancelled by clinic administrator');
 assert.equal(view.cancellation.at,at);
 assert.equal(view.events[0].cancelledBy.role,'ADMIN');
 assert(!('actorId' in view.events[0])); assert(!('actor' in view.events[0]));
 assert(!JSON.stringify(view).includes('Name at cancellation')); assert(!JSON.stringify(view).includes('private@example.invalid'));
 assert.equal(appointmentView({...value,status:'BOOKED'}).cancellation,null);
});
