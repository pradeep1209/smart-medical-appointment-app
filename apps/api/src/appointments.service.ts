import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { Appointment, Prisma } from '@prisma/client';
import { Actor } from './auth.service';
import { PrismaService } from './prisma.service';
import { BookDto, MoveDto, QueueQuery, StatusDto, VisitsQuery } from './appointments.dto';
import { appointmentNotices } from './experience-policy';
import { appointmentInclude, appointmentView } from './appointment-policy';
import { clinicInstant, dateAfter, dateInWindow, generateSlots, localParts, validDate } from './availability-policy';

export function patientScope(actor: Actor) {
  if (actor.client !== 'MOBILE' || !actor.user.patient) throw new ForbiddenException('Use your patient account for this action.');
  return actor.user.patient.id;
}
export function visitStaffScope(actor: Actor, clinicId: string, doctorId?: string) {
  const membership = actor.user.memberships.find(m => m.clinicId === clinicId);
  if (actor.client !== 'WEB' || !membership || (membership.role === 'DOCTOR' && doctorId && membership.doctor?.id !== doctorId)) throw new ForbiddenException('This appointment is outside your clinic access.');
  return membership;
}

@Injectable()
export class AppointmentsService {
  constructor(private readonly db: PrismaService, @Optional() private readonly attendance: AttendanceService = new AttendanceService()) {}
  private async locks(tx: Prisma.TransactionClient, doctorId: string, patientId: string) {
    // Every appointment mutation takes the same lock order. Doctor capacity and
    // patient overlap checks then serialize even across different doctors/clinics.
    await tx.$queryRaw`SELECT "id" FROM "DoctorProfile" WHERE "id" = ${doctorId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "PatientProfile" WHERE "id" = ${patientId}::uuid FOR UPDATE`;
  }
  private async slot(tx: Prisma.TransactionClient, clinicId: string, doctorId: string, patientId: string, requested: string, excludeId?: string) {
    if (!await tx.clinicPatient.findUnique({ where: { clinicId_patientId: { clinicId, patientId } } })) throw new ForbiddenException('This clinic is not connected to your patient account.');
    const doctor = await tx.doctorProfile.findFirst({ where: { id: doctorId, membership: { clinicId, role: 'DOCTOR', active: true, user: { status: 'ACTIVE' } } }, include: { workingDays: true, blockedPeriods: true, membership: { include: { clinic: true } } } });
    if (!doctor) throw new NotFoundException('This doctor is no longer available at your clinic.');
    const startsAt = new Date(requested);
    if (!Number.isFinite(startsAt.getTime())) throw new BadRequestException('Choose a valid consultation time.');
    const timezone = doctor.membership.clinic.timezone;
    const date = localParts(startsAt, timezone).date;
    dateInWindow(date, timezone);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const available = generateSlots(date, timezone, doctor.consultationMinutes, doctor.workingDays.find(d => d.weekday === weekday), doctor.blockedPeriods).find(s => s.startsAt === startsAt.toISOString());
    if (!available) throw new ConflictException('This consultation time is no longer available. Choose another time.');
    const endsAt = new Date(available.endsAt);
    const occupied = await tx.appointment.findFirst({ where: { ...(excludeId ? { id: { not: excludeId } } : {}), status: 'BOOKED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, OR: [{ doctorId }, { patientId }] } });
    if (occupied) throw new ConflictException(occupied.patientId === patientId ? 'This time overlaps another of your appointments.' : 'Someone has just booked this time. Choose another time.');
    return { startsAt, endsAt, timezone };
  }
  async book(actor: Actor, dto: BookDto) {
    const patientId = patientScope(actor);
    return this.db.$transaction(async tx => {
      await this.locks(tx, dto.doctorId, patientId);
      const existing = await tx.appointment.findUnique({ where: { patientId_requestKey: { patientId, requestKey: dto.requestKey } }, include: appointmentInclude });
      if (existing) {
        if (existing.doctorId !== dto.doctorId || existing.clinicId !== dto.clinicId || existing.requestedStart.getTime() !== new Date(dto.startsAt).getTime()) throw new ConflictException('This confirmation was already used for another visit. Refresh your visits.');
        return { message: 'This booking request was already saved. Showing its current status.', appointment: appointmentView(existing) };
      }
      const slot = await this.slot(tx, dto.clinicId, dto.doctorId, patientId, dto.startsAt);
      const created = await tx.appointment.create({ data: { clinicId: dto.clinicId, doctorId: dto.doctorId, patientId, requestKey: dto.requestKey, requestedStart: slot.startsAt, ...slot, events: { create: { actorId: actor.user.id, action: 'BOOKED', toStartsAt: slot.startsAt, toEndsAt: slot.endsAt } } }, include: appointmentInclude });
      await this.attendance.snapshot(tx, created, new Date());
      const saved = await tx.appointment.findUniqueOrThrow({ where: { id: created.id }, include: appointmentInclude });
      await appointmentNotices(tx, saved, 'Appointment confirmed', 'A consultation was booked. Review its latest details.');
      return { message: 'Your appointment is confirmed.', appointment: appointmentView(saved) };
    });
  }
  private async owned(actor: Actor, id: string) {
    const patientId = patientScope(actor);
    const appointment = await this.db.appointment.findFirst({ where: { id, patientId } });
    if (!appointment) throw new NotFoundException('This appointment is not available in your account.');
    return appointment;
  }
  private async current(tx: Prisma.TransactionClient, saved: Appointment, version: number) {
    await this.locks(tx, saved.doctorId, saved.patientId);
    const current = await tx.appointment.findUniqueOrThrow({ where: { id: saved.id } });
    if (current.version !== version) throw new ConflictException('This appointment has changed. Refresh your visits before continuing.');
    if (current.status !== 'BOOKED') throw new ConflictException('Only a booked appointment can be changed.');
    return current;
  }
  async reschedule(actor: Actor, id: string, dto: MoveDto) {
    const saved = await this.owned(actor, id);
    return this.db.$transaction(async tx => {
      const current = await this.current(tx, saved, dto.version);
      if (current.startsAt <= new Date()) throw new ConflictException('An appointment that has started cannot be rescheduled. Contact your clinic.');
      if (current.startsAt.getTime() === new Date(dto.startsAt).getTime()) throw new ConflictException('Choose a different consultation time.');
      const slot = await this.slot(tx, current.clinicId, current.doctorId, current.patientId, dto.startsAt, id);
      const changed = await tx.appointment.update({ where: { id }, data: { ...slot, needsReview: false, version: { increment: 1 }, events: { create: { actorId: actor.user.id, action: 'RESCHEDULED', fromStartsAt: current.startsAt, fromEndsAt: current.endsAt, toStartsAt: slot.startsAt, toEndsAt: slot.endsAt } } }, include: appointmentInclude });
      await this.attendance.snapshot(tx, changed, new Date());
      const reloaded = await tx.appointment.findUniqueOrThrow({ where: { id }, include: appointmentInclude });
      await appointmentNotices(tx, reloaded, 'Appointment rescheduled', 'A consultation time changed. Review the latest appointment details.');
      return { message: 'Your appointment has been rescheduled.', appointment: appointmentView(reloaded) };
    });
  }
  async cancel(actor: Actor, id: string, version: number) {
    return this.change(actor, await this.owned(actor, id), { status: 'CANCELLED', version }, false);
  }
  private async change(actor: Actor, saved: Appointment, dto: StatusDto, staff: boolean) {
    return this.db.$transaction(async tx => {
      const current = await this.current(tx, saved, dto.version);
      const now = new Date();
      if (dto.status === 'CANCELLED' && current.startsAt <= now) throw new ConflictException('This visit has started. Contact the clinic to update its attendance.');
      if (dto.status === 'ATTENDED' && current.startsAt > now) throw new ConflictException('Attendance can be recorded after the visit starts.');
      if (dto.status === 'MISSED' && current.endsAt > now) throw new ConflictException('A visit can be marked missed after it ends.');
      const cancellationActor = dto.status === 'CANCELLED' ? {
        actorRole: staff ? actor.user.memberships.find(m => m.clinicId === current.clinicId)!.role : 'PATIENT',
        actorDisplayName: actor.user.displayName,
      } : {};
      const changed = await tx.appointment.update({ where: { id: current.id }, data: { status: dto.status, needsReview: false, version: { increment: 1 }, events: { create: { actorId: actor.user.id, ...cancellationActor, action: dto.status, toStartsAt: current.startsAt, toEndsAt: current.endsAt } } }, include: appointmentInclude });
      await appointmentNotices(tx, changed, dto.status === 'CANCELLED' ? 'Appointment cancelled' : 'Visit status updated', 'Review the latest status and history in your appointment records.');
      return { message: dto.status === 'CANCELLED' ? 'Appointment cancelled.' : 'Attendance updated.', appointment: appointmentView(changed, staff) };
    });
  }
  async staffStatus(actor: Actor, clinicId: string, id: string, dto: StatusDto) {
    visitStaffScope(actor, clinicId);
    const saved = await this.db.appointment.findFirst({ where: { id, clinicId } });
    if (!saved) throw new NotFoundException('This appointment is not available in your clinic.');
    visitStaffScope(actor, clinicId, saved.doctorId);
    return this.change(actor, saved, dto, true);
  }
  async list(actor: Actor, query: VisitsQuery) {
    const patientId = patientScope(actor), now = new Date(), view = query.view ?? 'upcoming';
    const where: Prisma.AppointmentWhereInput = { patientId, ...(view === 'upcoming' ? { status: 'BOOKED', startsAt: { gt: now } } : { OR: [{ status: { not: 'BOOKED' } }, { startsAt: { lte: now } }] }) };
    if (query.cursor && !await this.db.appointment.findFirst({ where: { ...where, id: query.cursor }, select: { id: true } })) throw new BadRequestException('This visit page has changed. Refresh the list.');
    const items = await this.db.appointment.findMany({ where, include: appointmentInclude, orderBy: [{ startsAt: view === 'upcoming' ? 'asc' : 'desc' }, { id: 'asc' }], take: 51, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
    return { view, items: items.slice(0, 50).map(a => appointmentView(a)), nextCursor: items.length > 50 ? items[49]!.id : null };
  }
  async queue(actor: Actor, clinicId: string, query: QueueQuery) {
    const membership = visitStaffScope(actor, clinicId);
    const timezone = membership.clinic.timezone, date = validDate(query.date ?? localParts(new Date(), timezone).date);
    const items = await this.db.appointment.findMany({ where: { clinicId, ...(membership.role === 'DOCTOR' ? { doctorId: membership.doctor?.id ?? '00000000-0000-0000-0000-000000000000' } : {}), startsAt: { gte: clinicInstant(date, 0, timezone), lt: clinicInstant(dateAfter(date, 1), 0, timezone) } }, include: appointmentInclude, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: 501 });
    return { date, timezone, clinic: membership.clinic.name, items: items.slice(0, 500).map(a => appointmentView(a, true)), truncated: items.length > 500 };
  }
}
