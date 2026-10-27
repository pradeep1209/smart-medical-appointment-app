import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Actor } from './auth.service';
import { patientScope } from './appointments.service';
import { PrismaService } from './prisma.service';
import { DoctorCareQuery, IssuePrescriptionDto, MedicineDto, PatientCareQuery, RefillDto, ReviewRefillDto } from './prescriptions.dto';
import { freezePrescription, notice } from './experience-policy';

export function prescribingScope(actor: Actor, clinicId: string) {
  const member = actor.user.memberships.find(m => m.clinicId === clinicId);
  if (actor.client !== 'WEB' || member?.role !== 'DOCTOR' || !member.doctor) throw new ForbiddenException('Prescriptions and refill decisions are available only to the assigned doctor.');
  return member;
}
export function medicines(input: MedicineDto[] | undefined) {
  if (!input || input.length < 1 || input.length > 10) throw new BadRequestException('Enter between one and ten medicines.');
  return input.map((m, position) => {
    const line = { position, name: m.name.trim(), dose: m.dose.trim(), frequency: m.frequency.trim(), duration: m.duration.trim(), instructions: (m.instructions ?? '').trim() };
    if (!line.name || !line.dose || !line.frequency || !line.duration) throw new BadRequestException('Each medicine needs a name, dose, frequency and duration.');
    return line;
  });
}
const refillSelect = { id: true, status: true, version: true, patientNote: true, requestedAt: true, reviewedAt: true, reviewNote: true, renewalId: true } satisfies Prisma.RefillRequestSelect;
const rxInclude = {
  medicines: { orderBy: { position: 'asc' } },
  refillRequests: { orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }], select: refillSelect },
  renewal: { select: { id: true } },
  appointment: { include: {
    clinic: { select: { id: true, name: true } },
    doctor: { include: { membership: { select: { userId: true, active: true, role: true, user: { select: { displayName: true, status: true } } } } } },
    patient: { select: { id: true, user: { select: { displayName: true, email: true } }, clinics: { select: { clinicId: true } } } },
  } },
} satisfies Prisma.PrescriptionInclude;
type Rx = Prisma.PrescriptionGetPayload<{ include: typeof rxInclude }>;
function rxView(rx: Rx, staff = false) {
  const visit = rx.appointment, member = visit.doctor.membership;
  return { id: rx.id, appointmentId: rx.appointmentId, issuedAt: rx.issuedAt, visitStartsAt: visit.startsAt,
    clinic: { ...visit.clinic, timezone: visit.timezone }, doctor: { id: visit.doctorId, name: member.user.displayName },
    notes: rx.notes, renewalOfId: rx.renewalOfId, renewalId: rx.renewal?.id ?? null,
    documentNumber: rx.documentNumber, documentStatus: rx.documentStatus, replacesId: rx.replacesId,
    medicines: rx.medicines.map(m => ({ id: m.id, name: m.name, dose: m.dose, frequency: m.frequency, duration: m.duration, instructions: m.instructions })),
    refillRequests: rx.refillRequests,
    canRequestRefill: rx.documentStatus === 'ACTIVE' && !rx.renewal && !rx.refillRequests.some(r => r.status === 'PENDING') && member.active && member.role === 'DOCTOR' && member.user.status === 'ACTIVE' && visit.patient.clinics.some(c => c.clinicId === visit.clinicId),
    ...(staff ? { patient: { id: visit.patientId, name: visit.patient.user.displayName, email: visit.patient.user.email } } : {}),
  };
}
@Injectable()
export class PrescriptionsService {
  constructor(private readonly db: PrismaService) {}
  async issue(actor: Actor, clinicId: string, dto: IssuePrescriptionDto) {
    const member = prescribingScope(actor, clinicId), lines = medicines(dto.medicines), notes = (dto.notes ?? '').trim();
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${dto.appointmentId}::uuid FOR UPDATE`;
      const visit = await tx.appointment.findFirst({ where: { id: dto.appointmentId, clinicId, doctorId: member.doctor!.id } });
      if (!visit) throw new NotFoundException('This visit is not assigned to you at this clinic.');
      if (visit.status !== 'ATTENDED') throw new ConflictException('Record attendance before issuing a prescription.');
      const replay = await tx.prescription.findUnique({ where: { requestKey: dto.requestKey }, include: rxInclude });
      if (replay) {
        const saved = replay.medicines.map(m => ({ position: m.position, name: m.name, dose: m.dose, frequency: m.frequency, duration: m.duration, instructions: m.instructions }));
        if (replay.appointmentId !== visit.id || replay.issuerId !== actor.user.id || replay.renewalOfId || replay.replacesId || replay.notes !== notes || JSON.stringify(saved) !== JSON.stringify(lines)) throw new ConflictException('This confirmation belongs to another prescription. Reload care records.');
        return { message: 'This prescription was already issued.', prescription: rxView(replay, true) };
      }
      if (await tx.prescription.findFirst({ where: { appointmentId: visit.id, renewalOfId: null } })) throw new ConflictException('A prescription has already been issued for this visit. Reload care records.');
      const created = await tx.prescription.create({ data: { appointmentId: visit.id, issuerId: actor.user.id, requestKey: dto.requestKey, notes, medicines: { create: lines } }, include: rxInclude });
      await freezePrescription(tx, created.id);
      const patient = await tx.patientProfile.findUniqueOrThrow({ where: { id: visit.patientId } });
      await notice(tx, patient.userId, clinicId, 'Prescription available', 'Your doctor issued a prescription. Open My care to review it.', 'PRESCRIPTION', created.id);
      await tx.auditEvent.create({ data: { actorId: actor.user.id, clinicId, action: 'PRESCRIPTION_ISSUED', subjectId: created.id } });
      return { message: 'Prescription issued to the patient.', prescription: rxView(await tx.prescription.findUniqueOrThrow({ where: { id: created.id }, include: rxInclude }), true) };
    });
  }
  async patientCare(actor: Actor, query: PatientCareQuery) {
    const patientId = patientScope(actor), where = { appointment: { patientId } };
    if (query.cursor && !await this.db.prescription.findFirst({ where: { ...where, id: query.cursor }, select: { id: true } })) throw new BadRequestException('This care page has changed. Refresh your prescriptions.');
    const items = await this.db.prescription.findMany({ where, include: rxInclude, take: 51, orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }], ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
    return { items: items.slice(0, 50).map(rx => rxView(rx)), nextCursor: items.length > 50 ? items[49]!.id : null };
  }
  async request(actor: Actor, prescriptionId: string, dto: RefillDto) {
    const patientId = patientScope(actor), note = dto.patientNote.trim();
    if (note.length < 2) throw new BadRequestException('Add a brief note for your doctor.');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Prescription" WHERE "id" = ${prescriptionId}::uuid FOR UPDATE`;
      const rx = await tx.prescription.findFirst({ where: { id: prescriptionId, appointment: { patientId } }, include: rxInclude });
      if (!rx) throw new NotFoundException('This prescription is not available in your account.');
      if (rx.documentStatus !== 'ACTIVE') throw new ConflictException('Use the latest current prescription or contact your doctor.');
      const existing = await tx.refillRequest.findUnique({ where: { prescriptionId_requestKey: { prescriptionId, requestKey: dto.requestKey } } });
      if (existing) {
        if (existing.patientNote !== note) throw new ConflictException('This request confirmation was already used. Refresh your care records.');
        return { message: 'This refill request was already saved. Check its current status.', request: { id: existing.id, status: existing.status } };
      }
      if (rx.renewal) throw new ConflictException('A newer prescription is available. Request a refill from the latest prescription.');
      const member = rx.appointment.doctor.membership;
      if (!member.active || member.role !== 'DOCTOR' || member.user.status !== 'ACTIVE' || !rx.appointment.patient.clinics.some(c => c.clinicId === rx.appointment.clinicId)) throw new ForbiddenException('Contact your clinic to arrange a prescription review.');
      const pending = rx.refillRequests.find(r => r.status === 'PENDING');
      if (pending) return { message: 'A refill request is already waiting for your doctor.', request: { id: pending.id, status: pending.status } };
      const created = await tx.refillRequest.create({ data: { prescriptionId, requestKey: dto.requestKey, patientNote: note }, select: refillSelect });
      await notice(tx, rx.appointment.doctor.membership.userId, rx.appointment.clinicId, 'Refill review requested', 'A patient requested review of an assigned prescription.', 'REFILL', created.id);
      await tx.auditEvent.create({ data: { actorId: actor.user.id, clinicId: rx.appointment.clinicId, action: 'REFILL_REQUESTED', subjectId: created.id } });
      return { message: 'Refill request sent to your doctor.', request: created };
    });
  }
  async review(actor: Actor, clinicId: string, refillId: string, dto: ReviewRefillDto) {
    const member = prescribingScope(actor, clinicId), note = dto.reviewNote.trim();
    if (note.length < 2) throw new BadRequestException('Add a review note for the patient.');
    const lines = dto.status === 'APPROVED' ? medicines(dto.medicines) : undefined;
    if (dto.status === 'REJECTED' && (dto.medicines !== undefined || dto.notes !== undefined)) throw new BadRequestException('Prescription details are used only when approving a renewal.');
    const saved = await this.db.refillRequest.findFirst({ where: { id: refillId, prescription: { appointment: { clinicId, doctorId: member.doctor!.id } } } });
    if (!saved) throw new NotFoundException('This refill request is not assigned to you.');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Prescription" WHERE "id" = ${saved.prescriptionId}::uuid FOR UPDATE`;
      const request = await tx.refillRequest.findUniqueOrThrow({ where: { id: refillId }, include: { prescription: { include: rxInclude } } });
      if (request.status !== 'PENDING' || request.version !== dto.version) throw new ConflictException('This request has already changed or been reviewed. Reload care records.');
      if (request.prescription.renewal) throw new ConflictException('A newer prescription already exists. Reload care records.');
      if (request.prescription.documentStatus !== 'ACTIVE') throw new ConflictException('This prescription is no longer current. Reload care records.');
      let renewalId: string | null = null;
      if (dto.status === 'APPROVED') {
        const renewal = await tx.prescription.create({ data: { appointmentId: request.prescription.appointmentId, issuerId: actor.user.id, requestKey: randomUUID(), renewalOfId: request.prescriptionId, notes: (dto.notes ?? '').trim(), medicines: { create: lines! } } });
        renewalId = renewal.id;
        await freezePrescription(tx, renewal.id);
      }
      const updated = await tx.refillRequest.update({ where: { id: refillId }, data: { status: dto.status, reviewedAt: new Date(), reviewerId: actor.user.id, reviewNote: note, renewalId, version: { increment: 1 } }, select: refillSelect });
      const patient = await tx.patientProfile.findUniqueOrThrow({ where: { id: request.prescription.appointment.patientId } });
      await notice(tx, patient.userId, clinicId, 'Refill decision available', 'Your doctor reviewed a refill request. Open My care for the decision.', 'REFILL', refillId);
      await tx.auditEvent.create({ data: { actorId: actor.user.id, clinicId, action: dto.status === 'APPROVED' ? 'REFILL_APPROVED' : 'REFILL_REJECTED', subjectId: refillId } });
      return { message: dto.status === 'APPROVED' ? 'Refill approved and a new prescription issued.' : 'Refill request rejected with your note.', request: updated };
    });
  }
  async doctorCare(actor: Actor, clinicId: string, query: DoctorCareQuery) {
    const member = prescribingScope(actor, clinicId), own = { clinicId, doctorId: member.doctor!.id };
    const selected = query.appointmentId ? await this.db.appointment.findFirst({ where: { ...own, id: query.appointmentId, status: 'ATTENDED' }, include: { patient: { select: { user: { select: { displayName: true } } } }, prescriptions: { select: { id: true } } } }) : null;
    if (query.appointmentId && !selected) throw new NotFoundException('Choose an attended visit assigned to you.');
    const [eligible, issued, pending, recent, pendingCount] = await Promise.all([
      this.db.appointment.findMany({ where: { ...own, status: 'ATTENDED', prescriptions: { none: { renewalOfId: null } } }, select: { id: true, startsAt: true, timezone: true, patient: { select: { user: { select: { displayName: true } } } } }, take: 50, orderBy: { startsAt: 'desc' } }),
      this.db.prescription.findMany({ where: { appointment: { ...own, ...(query.appointmentId ? { id: query.appointmentId } : {}) } }, include: rxInclude, take: 50, orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }] }),
      this.db.refillRequest.findMany({ where: { status: 'PENDING', prescription: { appointment: own } }, include: { prescription: { include: rxInclude } }, take: 50, orderBy: { requestedAt: 'asc' } }),
      this.db.refillRequest.findMany({ where: { status: { not: 'PENDING' }, prescription: { appointment: own } }, include: { prescription: { include: rxInclude } }, take: 20, orderBy: { reviewedAt: 'desc' } }),
      this.db.refillRequest.count({ where: { status: 'PENDING', prescription: { appointment: own } } }),
    ]);
    if (selected && !selected.prescriptions.length && !eligible.some(v => v.id === selected.id)) eligible.unshift(selected);
    const viewRequest = (request: (typeof pending)[number]) => ({ ...Object.fromEntries(Object.keys(refillSelect).map(key => [key, request[key as keyof typeof refillSelect]])), prescription: rxView(request.prescription, true) });
    return { clinic: { id: clinicId, name: member.clinic.name, timezone: member.clinic.timezone }, eligibleVisits: eligible.map(v => ({ id: v.id, startsAt: v.startsAt, timezone: v.timezone, patient: v.patient.user.displayName })), selectedVisitId: selected?.id ?? null, items: issued.map(rx => rxView(rx, true)), pending: pending.map(viewRequest), recent: recent.map(viewRequest), pendingCount };
  }
}
