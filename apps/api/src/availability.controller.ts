import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthGuard, AuthRequest } from './auth.guard';
import { PrismaService } from './prisma.service';
import { MembershipParams } from './dto';
import { BlockDto, BlockParams, DoctorScheduleParams, SaveScheduleDto, SlotsQuery } from './availability.dto';
import { clinicInstant, dateAfter, dateInWindow, generateSlots, localInput, localParts } from './availability-policy';
import { reviewAppointments } from './appointment-policy';

export function scheduleScope(req: AuthRequest, clinicId: string, doctorId?: string, write = false) {
  const membership = req.actor.user.memberships.find(m => m.clinicId === clinicId);
  if (req.actor.client !== 'WEB' || !membership || (write && membership.role === 'RECEPTIONIST') || (membership.role === 'DOCTOR' && doctorId && membership.doctor?.id !== doctorId)) throw new ForbiddenException('You cannot manage this consultation schedule.');
  return membership;
}

@Controller('clinics/:clinicId') @UseGuards(AuthGuard)
export class AvailabilityController {
  constructor(private readonly db: PrismaService) {}
  @Get('schedules') async schedules(@Req() req: AuthRequest, @Param() p: MembershipParams) {
    const membership = scheduleScope(req, p.clinicId);
    return { clinic: { id: p.clinicId, name: membership.clinic.name, timezone: membership.clinic.timezone }, canEdit: membership.role !== 'RECEPTIONIST', doctors: await this.db.doctorProfile.findMany({
      where: { ...(membership.role === 'DOCTOR' ? { membershipId: membership.id } : {}), membership: { clinicId: p.clinicId, active: true, role: 'DOCTOR', user: { status: 'ACTIVE' } } },
      select: { id: true, specialty: true, consultationMinutes: true, scheduleVersion: true, membership: { select: { user: { select: { displayName: true } } } }, workingDays: { orderBy: { weekday: 'asc' } }, blockedPeriods: { where: { endsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' } } }, orderBy: { id: 'asc' },
    }) };
  }
  private async lockDoctor(tx: Prisma.TransactionClient, p: DoctorScheduleParams) {
    await tx.$queryRaw`SELECT "id" FROM "DoctorProfile" WHERE "id" = ${p.doctorId}::uuid FOR UPDATE`;
    const doctor = await tx.doctorProfile.findFirst({ where: { id: p.doctorId, membership: { clinicId: p.clinicId, active: true, role: 'DOCTOR', user: { status: 'ACTIVE' } } } });
    if (!doctor) throw new NotFoundException('This doctor is no longer available at this clinic.');
    return doctor;
  }
  @Post('doctors/:doctorId/schedule') async save(@Req() req: AuthRequest, @Param() p: DoctorScheduleParams, @Body() dto: SaveScheduleDto) {
    scheduleScope(req, p.clinicId, p.doctorId, true);
    if (dto.specialty.trim().length < 2 || dto.days.some(d => d.endMinute <= d.startMinute || d.endMinute - d.startMinute < dto.consultationMinutes) || new Set(dto.days.map(d => d.weekday)).size !== dto.days.length) throw new BadRequestException('Each open day needs a unique weekday and enough time for a full consultation.');
    return this.db.$transaction(async tx => {
      const doctor = await this.lockDoctor(tx, p);
      if (doctor.scheduleVersion !== dto.version) throw new ConflictException('This schedule has changed. Reload before saving your changes.');
      await tx.workingDay.deleteMany({ where: { doctorId: p.doctorId } });
      if (dto.days.length) await tx.workingDay.createMany({ data: dto.days.map(d => ({ doctorId: p.doctorId, ...d })) });
      const updated = await tx.doctorProfile.update({ where: { id: p.doctorId }, data: { specialty: dto.specialty.trim(), consultationMinutes: dto.consultationMinutes, scheduleVersion: { increment: 1 } } });
      await reviewAppointments(tx, p.doctorId, req.actor.user.id);
      await tx.auditEvent.create({ data: { actorId: req.actor.user.id, clinicId: p.clinicId, action: 'DOCTOR_SCHEDULE_UPDATED', subjectId: p.doctorId } });
      return { message: 'Consultation details and weekly hours saved.', version: updated.scheduleVersion };
    });
  }
  @Post('doctors/:doctorId/blocks') async block(@Req() req: AuthRequest, @Param() p: DoctorScheduleParams, @Body() dto: BlockDto) {
    const membership = scheduleScope(req, p.clinicId, p.doctorId, true);
    const timezone = membership.clinic.timezone;
    const startsAt = localInput(dto.startsAt, timezone), endsAt = localInput(dto.endsAt, timezone);
    dateInWindow(localParts(startsAt, timezone).date, timezone);
    if (dto.reason.trim().length < 2 || startsAt >= endsAt || endsAt <= new Date() || endsAt.getTime() - startsAt.getTime() > 90 * 86400000 || endsAt > clinicInstant(dateAfter(localParts(new Date(), timezone).date, 91), 0, timezone)) throw new BadRequestException('Enter a reason and a future blocked period within the next 90 days.');
    return this.db.$transaction(async tx => {
      await this.lockDoctor(tx, p);
      if (await tx.blockedPeriod.count({ where: { doctorId: p.doctorId, endsAt: { gt: new Date() } } }) >= 100) throw new ConflictException('Remove an existing future blocked period before adding another.');
      if (await tx.blockedPeriod.findFirst({ where: { doctorId: p.doctorId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } })) throw new ConflictException('This period overlaps an existing blocked period.');
      const created = await tx.blockedPeriod.create({ data: { doctorId: p.doctorId, startsAt, endsAt, reason: dto.reason.trim() } });
      await tx.doctorProfile.update({ where: { id: p.doctorId }, data: { scheduleVersion: { increment: 1 } } });
      await reviewAppointments(tx, p.doctorId, req.actor.user.id);
      await tx.auditEvent.create({ data: { actorId: req.actor.user.id, clinicId: p.clinicId, action: 'DOCTOR_PERIOD_BLOCKED', subjectId: created.id } });
      return { message: 'Blocked period added.' };
    });
  }
  @Post('doctors/:doctorId/blocks/:blockId/remove') async remove(@Req() req: AuthRequest, @Param() p: BlockParams) {
    scheduleScope(req, p.clinicId, p.doctorId, true);
    return this.db.$transaction(async tx => {
      await this.lockDoctor(tx, p);
      const removed = await tx.blockedPeriod.deleteMany({ where: { id: p.blockId, doctorId: p.doctorId } });
      if (!removed.count) throw new NotFoundException('This blocked period no longer exists. Reload the schedule.');
      await tx.doctorProfile.update({ where: { id: p.doctorId }, data: { scheduleVersion: { increment: 1 } } });
      await reviewAppointments(tx, p.doctorId, req.actor.user.id);
      await tx.auditEvent.create({ data: { actorId: req.actor.user.id, clinicId: p.clinicId, action: 'DOCTOR_BLOCK_REMOVED', subjectId: p.blockId } });
      return { message: 'Blocked period removed.' };
    });
  }
}

@Controller('patient/clinics/:clinicId/doctors/:doctorId') @UseGuards(AuthGuard)
export class PatientAvailabilityController {
  constructor(private readonly db: PrismaService) {}
  @Get('slots') async slots(@Req() req: AuthRequest, @Param() p: DoctorScheduleParams, @Query() query: SlotsQuery) {
    if (req.actor.client !== 'MOBILE' || !req.actor.user.patient) throw new ForbiddenException('Use your patient account to view available times.');
    const enrolled = await this.db.clinicPatient.findUnique({ where: { clinicId_patientId: { clinicId: p.clinicId, patientId: req.actor.user.patient.id } }, include: { clinic: true } });
    if (!enrolled) throw new ForbiddenException('This clinic is not connected to your patient account.');
    dateInWindow(query.date, enrolled.clinic.timezone);
    const doctor = await this.db.doctorProfile.findFirst({ where: { id: p.doctorId, membership: { clinicId: p.clinicId, active: true, role: 'DOCTOR', user: { status: 'ACTIVE' } } }, include: { workingDays: true, blockedPeriods: { where: { endsAt: { gt: new Date() } } }, membership: { include: { user: { select: { displayName: true } } } } } });
    if (!doctor) throw new NotFoundException('This doctor is no longer available at your clinic.');
    const weekday = new Date(`${query.date}T00:00:00Z`).getUTCDay();
    if (query.excludeAppointmentId && !await this.db.appointment.findFirst({ where: { id: query.excludeAppointmentId, patientId: req.actor.user.patient.id, doctorId: p.doctorId, clinicId: p.clinicId, status: 'BOOKED' } })) throw new NotFoundException('This appointment cannot be rescheduled from your account.');
    const occupied = await this.db.appointment.findMany({ where: { ...(query.excludeAppointmentId ? { id: { not: query.excludeAppointmentId } } : {}), status: 'BOOKED', OR: [{ doctorId: p.doctorId }, { patientId: req.actor.user.patient.id }], startsAt: { lt: clinicInstant(dateAfter(query.date, 1), 0, enrolled.clinic.timezone) }, endsAt: { gt: clinicInstant(query.date, 0, enrolled.clinic.timezone) } }, select: { startsAt: true, endsAt: true } });
    const slots = generateSlots(query.date, enrolled.clinic.timezone, doctor.consultationMinutes, doctor.workingDays.find(d => d.weekday === weekday), doctor.blockedPeriods).filter(s => !occupied.some(a => a.startsAt < new Date(s.endsAt) && a.endsAt > new Date(s.startsAt)));
    return { date: query.date, timezone: enrolled.clinic.timezone, doctor: { name: doctor.membership.user.displayName, specialty: doctor.specialty, consultationMinutes: doctor.consultationMinutes }, clinic: enrolled.clinic.name, slots, bookingEnabled: true };
  }
}
