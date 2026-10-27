import { Prisma } from '@prisma/client';
import { generateSlots, localParts } from './availability-policy';
import { cancellationView } from './cancellation-view';

// Availability writes and appointment writes both hold this doctor's row lock.
// An edit preserves confirmed times and only flags visits whose schedule no longer fits.
export async function reviewAppointments(tx: Prisma.TransactionClient, doctorId: string, actorId: string) {
  const doctor = await tx.doctorProfile.findUniqueOrThrow({ where: { id: doctorId }, include: { workingDays: true, blockedPeriods: true, membership: { include: { clinic: true } } } });
  const visits = await tx.appointment.findMany({ where: { doctorId, status: 'BOOKED', startsAt: { gt: new Date() } } });
  for (const visit of visits) {
    const date = localParts(visit.startsAt, doctor.membership.clinic.timezone).date;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const fits = generateSlots(date, doctor.membership.clinic.timezone, doctor.consultationMinutes, doctor.workingDays.find(d => d.weekday === weekday), doctor.blockedPeriods)
      .some(slot => slot.startsAt === visit.startsAt.toISOString() && slot.endsAt === visit.endsAt.toISOString());
    if (visit.needsReview === !fits) continue;
    await tx.appointment.update({ where: { id: visit.id }, data: { needsReview: !fits, version: { increment: 1 } } });
    await tx.appointmentEvent.create({ data: { appointmentId: visit.id, actorId, action: fits ? 'SCHEDULE_REVIEW_CLEARED' : 'SCHEDULE_REVIEW_REQUIRED', toStartsAt: visit.startsAt, toEndsAt: visit.endsAt } });
  }
}

export const appointmentInclude = {
  attendanceSnapshots: { orderBy: { appointmentVersion: 'desc' }, take: 1 },
  clinic: { select: { id: true, name: true } },
  doctor: { select: { id: true, specialty: true, membership: { select: { userId: true, user: { select: { displayName: true } } } } } },
  patient: { select: { id: true, userId: true, user: { select: { displayName: true, email: true } } } },
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, action: true, actorId: true, actorRole: true, actorDisplayName: true, actor: { select: { displayName: true } }, fromStartsAt: true, fromEndsAt: true, toStartsAt: true, toEndsAt: true, createdAt: true } },
} satisfies Prisma.AppointmentInclude;
export function appointmentView(value: Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>, staff = false) {
  const events = value.events.map(({ actorId, actorRole, actorDisplayName, actor, ...event }) => ({
    ...event,
    cancelledBy: event.action === 'CANCELLED' ? cancellationView({ actorId, actorRole, actorDisplayName, actor }, value.patient.userId, value.doctor.membership.userId, staff) : null,
  }));
  const cancelled = [...events].reverse().find(event => event.action === 'CANCELLED');
  const snapshot = value.attendanceSnapshots[0];
  const prediction = snapshot && snapshot.startsAt.getTime() === value.startsAt.getTime() ? {
    status: snapshot.status, source: 'SERVER', experimental: true, trainingData: 'synthetic',
    attendanceProbability: snapshot.noShowProbability == null ? null : 1 - snapshot.noShowProbability,
    modelVersion: snapshot.modelVersion, asOf: snapshot.asOf,
    ...(staff ? { modelSha256: snapshot.modelSha256, features: snapshot.features, historyScope: snapshot.historyScope } : {}),
  } : null;
  return {
    id: value.id, clinic: { ...value.clinic, timezone: value.timezone }, doctor: { id: value.doctor.id, name: value.doctor.membership.user.displayName, specialty: value.doctor.specialty },
    startsAt: value.startsAt, endsAt: value.endsAt, status: value.status, version: value.version, needsReview: value.needsReview,
    createdAt: value.createdAt, events,
    cancellation: value.status === 'CANCELLED' && cancelled ? { ...cancelled.cancelledBy!, at: cancelled.createdAt } : null,
    prediction,
    ...(staff ? { patient: { id: value.patient.id, name: value.patient.user.displayName, email: value.patient.user.email } } : {}),
  };
}
