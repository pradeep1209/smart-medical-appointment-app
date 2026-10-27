import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthRequest } from './auth.guard';
import { MembershipParams } from './dto';
import { PrescriptionsService } from './prescriptions.service';
import { ClinicRefillParams, DoctorCareQuery, IssuePrescriptionDto, PatientCareQuery, PrescriptionParams, RefillDto, ReviewRefillDto } from './prescriptions.dto';
@Controller('patient') @UseGuards(AuthGuard)
export class PatientPrescriptionsController {
  constructor(private readonly care: PrescriptionsService) {}
  @Get('care') list(@Req() req: AuthRequest, @Query() query: PatientCareQuery) { return this.care.patientCare(req.actor, query); }
  @Post('prescriptions/:prescriptionId/refills') request(@Req() req: AuthRequest, @Param() p: PrescriptionParams, @Body() dto: RefillDto) { return this.care.request(req.actor, p.prescriptionId, dto); }
}
@Controller('clinics/:clinicId') @UseGuards(AuthGuard)
export class DoctorPrescriptionsController {
  constructor(private readonly care: PrescriptionsService) {}
  @Get('care') list(@Req() req: AuthRequest, @Param() p: MembershipParams, @Query() query: DoctorCareQuery) { return this.care.doctorCare(req.actor, p.clinicId, query); }
  @Post('prescriptions') issue(@Req() req: AuthRequest, @Param() p: MembershipParams, @Body() dto: IssuePrescriptionDto) { return this.care.issue(req.actor, p.clinicId, dto); }
  @Post('refills/:refillId/review') review(@Req() req: AuthRequest, @Param() p: ClinicRefillParams, @Body() dto: ReviewRefillDto) { return this.care.review(req.actor, p.clinicId, p.refillId, dto); }
}
