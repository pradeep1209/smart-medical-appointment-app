type CancellationActor = {
  actorId: string;
  actorRole: string | null;
  actorDisplayName: string | null;
  actor: { displayName: string };
};

export function cancellationView(event: CancellationActor, patientUserId: string, doctorUserId: string, staff: boolean) {
  // Older events have an actor ID but no role snapshot. Do not infer a historic
  // administrator/reception role from today's membership.
  let role = event.actorRole;
  if (!role) {
    const patient = event.actorId === patientUserId, doctor = event.actorId === doctorUserId;
    role = patient && doctor ? 'UNKNOWN' : patient ? 'PATIENT' : doctor ? 'DOCTOR' : 'CLINIC_STAFF';
  }
  const name = role === 'DOCTOR' || staff ? event.actorDisplayName ?? event.actor.displayName : null;
  const label = role === 'PATIENT' ? (staff ? 'Cancelled by patient' : 'Cancelled by you')
    : role === 'DOCTOR' ? `Cancelled by doctor${name ? ` · ${name}` : ''}`
    : role === 'ADMIN' ? 'Cancelled by clinic administrator'
    : role === 'RECEPTIONIST' ? 'Cancelled by reception'
    : role === 'CLINIC_STAFF' ? 'Cancelled by clinic'
    : 'Cancelled · who cancelled was not recorded';
  return { role, name, label };
}
