import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthRequest } from './auth.guard';
import { AppointmentParams, BookDto, ClinicAppointmentParams, MoveDto, QueueQuery, StatusDto, VersionDto, VisitsQuery } from './appointments.dto';
import { MembershipParams } from './dto';
import { AppointmentsService } from './appointments.service';
@Controller('patient/appointments') @UseGuards(AuthGuard)
export class PatientAppointmentsController {
  constructor(private readonly visits: AppointmentsService) {}
  @Get() list(@Req() req: AuthRequest, @Query() query: VisitsQuery) { return this.visits.list(req.actor, query); }
  @Post() book(@Req() req: AuthRequest, @Body() dto: BookDto) { return this.visits.book(req.actor, dto); }
  @Post(':appointmentId/reschedule') move(@Req() req: AuthRequest, @Param() p: AppointmentParams, @Body() dto: MoveDto) { return this.visits.reschedule(req.actor, p.appointmentId, dto); }
  @Post(':appointmentId/cancel') cancel(@Req() req: AuthRequest, @Param() p: AppointmentParams, @Body() dto: VersionDto) { return this.visits.cancel(req.actor, p.appointmentId, dto.version); }
}
@Controller('clinics/:clinicId/appointments') @UseGuards(AuthGuard)
export class ClinicAppointmentsController {
  constructor(private readonly visits: AppointmentsService) {}
  @Get() queue(@Req() req: AuthRequest, @Param() p: MembershipParams, @Query() query: QueueQuery) { return this.visits.queue(req.actor, p.clinicId, query); }
  @Post(':appointmentId/status') status(@Req() req: AuthRequest, @Param() p: ClinicAppointmentParams, @Body() dto: StatusDto) { return this.visits.staffStatus(req.actor, p.clinicId, p.appointmentId, dto); }
}
