import { Body, Controller, ForbiddenException, Get, Param, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { AuthGuard, AuthRequest } from './auth.guard';
import { MembershipParams } from './dto';
import { AttendanceModel } from './attendance-model';
import { simulateScheduling } from './scheduling-simulation';
class SimulationDto {
  @IsInt() @Min(1) @Max(2147483647) seed: number = 20261025;
  @IsInt() @Min(1) @Max(2000) sessions: number = 500;
  @IsBoolean() overbookingEnabled: boolean = false;
}
@Controller('clinics/:clinicId/prediction') @UseGuards(AuthGuard)
export class PredictionController {
  constructor(private readonly model: AttendanceModel) {}
  private scope(req: AuthRequest, clinicId: string) {
    if (req.actor.client !== 'WEB' || !req.actor.user.memberships.some(m => m.clinicId === clinicId && ['ADMIN', 'DOCTOR'].includes(m.role))) throw new ForbiddenException('Prediction planning is available to clinic administrators and doctors.');
  }
  @Get() metadata(@Req() req: AuthRequest, @Param() p: MembershipParams) { this.scope(req, p.clinicId); return this.model.metadata(); }
  @Post('simulate') simulate(@Req() req: AuthRequest, @Param() p: MembershipParams, @Body() dto: SimulationDto) {
    this.scope(req, p.clinicId);
    try { return simulateScheduling(this.model.predictor, dto.seed, dto.sessions, dto.overbookingEnabled); }
    catch { throw new ServiceUnavailableException('The experimental model is unavailable. Run the standard comparison or try again after the service is restored.'); }
  }
}
