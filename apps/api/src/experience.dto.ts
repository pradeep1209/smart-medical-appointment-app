import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MedicineDto } from './prescriptions.dto';
export class ExperienceQuery { @IsOptional() @IsUUID() clinicId?:string; }
export class ItemParams { @IsUUID() id!:string; }
export class ClinicItemParams { @IsUUID() clinicId!:string; }
export class ClinicProfileDto {
 @IsInt() @Min(0) version!:number;
 @IsString() @MinLength(2) @MaxLength(120) name!:string;
 @IsString() @MaxLength(500) address!:string;
 @IsString() @MaxLength(40) phone!:string;
 @IsString() @MaxLength(254) contactEmail!:string;
 @IsOptional() @IsString() @MaxLength(280000) logoData?:string|null;
}
export class DoctorProfessionalDto {
 @IsInt() @Min(0) version!:number;
 @IsString() @MaxLength(200) qualifications!:string;
 @IsString() @MaxLength(100) registrationNumber!:string;
}
export class PatientProfileDto {
 @IsInt() @Min(0) version!:number;
 @IsString() @MaxLength(40) phone!:string;
 @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateOfBirth?:string|null;
 @IsString() @MaxLength(1000) allergies!:string;
 @IsString() @MaxLength(2000) healthNotes!:string;
}
export class SummaryDto {
 @IsInt() @Min(0) version!:number;
 @IsString() @MaxLength(4000) summary!:string;
 @IsString() @MaxLength(4000) instructions!:string;
 @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) followUpDate?:string|null;
 @IsString() @MaxLength(1000) followUpInstructions!:string;
 @IsBoolean() issue!:boolean;
}
export class ReplaceDto {
 @IsUUID() requestKey!:string;
 @IsString() @MinLength(3) @MaxLength(500) reason!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({each:true}) @Type(()=>MedicineDto) medicines!:MedicineDto[];
 @IsString() @MaxLength(1000) notes!:string;
}
export class RevokeDto { @IsString() @MinLength(3) @MaxLength(500) reason!:string; }
export class UploadDocumentDto {
 @IsString() @MinLength(2) @MaxLength(120) title!:string;
 @IsString() @MinLength(1) @MaxLength(160) filename!:string;
 @IsIn(['application/pdf','image/png','image/jpeg']) mime!:string;
 @IsString() @MaxLength(6990510) dataBase64!:string;
}
export class ShareDocumentDto { @IsUUID() appointmentId!:string; }
export class MedicationPlanDto {
 @IsBoolean() confirmed!:boolean;
 @IsUUID() medicineId!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @IsString({each:true}) times!:string[];
 @IsString() @MaxLength(80) timezone!:string;
 @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
 @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!:string;
 @IsBoolean() enabled!:boolean;
 @IsInt() @Min(0) version!:number;
}
export class DoseDto { @IsISO8601({strict:true}) scheduledAt!:string; @IsIn(['TAKEN','SKIPPED']) status!:'TAKEN'|'SKIPPED'; }
export class ExportDto {
 @IsIn(['prescription','appointment','calendar','history','document']) kind!:'prescription'|'appointment'|'calendar'|'history'|'document';
 @IsOptional() @IsUUID() id?:string;
 @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?:string;
 @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?:string;
 @IsOptional() @IsString() @MaxLength(80) timezone?:string;
}
export class VerifyParams { @Matches(/^[a-f0-9]{48}$/) token!:string; }
