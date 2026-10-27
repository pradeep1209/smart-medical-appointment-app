import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AttendanceFeatures, AttendanceModel } from './attendance-model';
import { localParts } from './availability-policy';

@Injectable()
export class AttendanceService {
  constructor(@Optional() readonly model: AttendanceModel = new AttendanceModel()) {}
  async snapshot(tx: Prisma.TransactionClient, appointment: { id: string; patientId: string; clinicId: string; startsAt: Date; timezone: string; version: number }, asOf: Date) {
    const predictor = this.model.predictor;
    if (!predictor) return tx.attendanceSnapshot.create({ data: { appointmentId: appointment.id, appointmentVersion: appointment.version, startsAt: appointment.startsAt, asOf, status: 'UNAVAILABLE', features: Prisma.JsonNull, historyIds: [], historyScope: 'CLINIC_PATIENT_LATEST_20' } });
    // Outcome events, not merely today's status, determine what was known at prediction time.
    const history = await tx.appointment.findMany({ where: {
      patientId: appointment.patientId, clinicId: appointment.clinicId, id: { not: appointment.id },
      status: { in: ['ATTENDED', 'MISSED'] }, endsAt: { lte: asOf },
      events: { some: { action: { in: ['ATTENDED', 'MISSED'] }, createdAt: { lte: asOf } } },
    }, orderBy: [{ endsAt: 'desc' }, { id: 'asc' }], take: 20, select: { id: true, status: true } });
    const target = localParts(appointment.startsAt, appointment.timezone).date;
    const today = localParts(asOf, appointment.timezone).date;
    const rawLeadDays = Math.max(0, Math.round((Date.parse(target + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000));
    // Mobile notification opt-in/delivery is not server-verifiable. Never trust a client feature claim.
    const f: AttendanceFeatures = { leadDays: Math.min(rawLeadDays, 60), priorAppointments: history.length, priorMissed: history.filter(a => a.status === 'MISSED').length, reminderPlanned: false };
    let probability: number;
    try { probability = predictor.noShowProbability(f); }
    catch { return tx.attendanceSnapshot.create({ data: { appointmentId: appointment.id, appointmentVersion: appointment.version, startsAt: appointment.startsAt, asOf, status: 'UNAVAILABLE', features: Prisma.JsonNull, historyIds: [], historyScope: 'CLINIC_PATIENT_LATEST_20' } }); }
    return tx.attendanceSnapshot.create({ data: {
      appointmentId: appointment.id, appointmentVersion: appointment.version, startsAt: appointment.startsAt, asOf,
      status: 'AVAILABLE', modelVersion: predictor.data.version, modelSha256: predictor.sha256,
      noShowProbability: probability, features: { ...f, rawLeadDays, leadDaysClamped: rawLeadDays > 60, smoothedPriorNoShowRate: (f.priorMissed + 1) / (f.priorAppointments + 4), reminderBasis: 'NOT_SERVER_VERIFIED' },
      historyIds: history.map(a => a.id), historyScope: 'CLINIC_PATIENT_LATEST_20',
    } });
  }
}
