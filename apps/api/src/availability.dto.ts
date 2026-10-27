import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
export class DoctorScheduleParams {
  @IsUUID() clinicId!: string;
  @IsUUID() doctorId!: string;
}
export class BlockParams extends DoctorScheduleParams { @IsUUID() blockId!: string; }
export class WorkingDayDto {
  @IsInt() @Min(0) @Max(6) weekday!: number;
  @IsInt() @Min(0) @Max(1439) startMinute!: number;
  @IsInt() @Min(1) @Max(1440) endMinute!: number;
}
export class SaveScheduleDto {
  @IsString() @MinLength(2) @MaxLength(100) specialty!: string;
  @IsInt() @Min(10) @Max(120) consultationMinutes!: number;
  @IsInt() @Min(0) version!: number;
  @IsArray() @ArrayMaxSize(7) @ValidateNested({ each: true }) @Type(() => WorkingDayDto) days!: WorkingDayDto[];
}
export class BlockDto {
  @IsString() @MaxLength(16) startsAt!: string;
  @IsString() @MaxLength(16) endsAt!: string;
  @IsString() @MinLength(2) @MaxLength(160) reason!: string;
}
export class SlotsQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsOptional() @IsUUID() excludeAppointmentId?: string;
}
