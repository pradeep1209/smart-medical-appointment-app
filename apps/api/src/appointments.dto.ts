import { IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Matches, Min } from 'class-validator';
export class AppointmentParams { @IsUUID() appointmentId!: string; }
export class ClinicAppointmentParams extends AppointmentParams { @IsUUID() clinicId!: string; }
export class BookDto {
  @IsUUID() clinicId!: string;
  @IsUUID() doctorId!: string;
  @IsISO8601({ strict: true }) startsAt!: string;
  @IsUUID() requestKey!: string;
}
export class VersionDto { @IsInt() @Min(0) version!: number; }
export class MoveDto extends VersionDto { @IsISO8601({ strict: true }) startsAt!: string; }
export class StatusDto extends VersionDto { @IsIn(['ATTENDED', 'MISSED', 'CANCELLED']) status!: 'ATTENDED' | 'MISSED' | 'CANCELLED'; }
export class VisitsQuery {
  @IsOptional() @IsIn(['upcoming', 'past']) view?: 'upcoming' | 'past';
  @IsOptional() @IsUUID() cursor?: string;
}
export class QueueQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
}
