import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
export class MedicineDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(1) @MaxLength(100) dose!: string;
  @IsString() @MinLength(1) @MaxLength(160) frequency!: string;
  @IsString() @MinLength(1) @MaxLength(100) duration!: string;
  @IsOptional() @IsString() @MaxLength(500) instructions?: string;
}
export class IssuePrescriptionDto {
  @IsUUID() appointmentId!: string;
  @IsUUID() requestKey!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => MedicineDto) medicines!: MedicineDto[];
}
export class RefillDto {
  @IsUUID() requestKey!: string;
  @IsString() @MinLength(2) @MaxLength(1000) patientNote!: string;
}
export class ReviewRefillDto {
  @IsInt() @Min(0) version!: number;
  @IsIn(['APPROVED', 'REJECTED']) status!: 'APPROVED' | 'REJECTED';
  @IsString() @MinLength(2) @MaxLength(1000) reviewNote!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => MedicineDto) medicines?: MedicineDto[];
}
export class PrescriptionParams { @IsUUID() prescriptionId!: string; }
export class ClinicRefillParams { @IsUUID() clinicId!: string; @IsUUID() refillId!: string; }
export class PatientCareQuery { @IsOptional() @IsUUID() cursor?: string; }
export class DoctorCareQuery { @IsOptional() @IsUUID() appointmentId?: string; }
