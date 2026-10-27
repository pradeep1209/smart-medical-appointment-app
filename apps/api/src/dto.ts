import { IsEmail, IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
export class LoginDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class RegisterDto extends LoginDto {
  @IsString() @MinLength(2) @MaxLength(100) displayName!: string;
  @IsString() @MinLength(12) @MaxLength(128) declare password: string;
}
export class RefreshDto {
  @IsString() @MinLength(70) @MaxLength(150) refreshToken!: string;
}
export class InviteDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(2) @MaxLength(100) displayName!: string;
  @IsIn(['DOCTOR', 'RECEPTIONIST']) role!: 'DOCTOR' | 'RECEPTIONIST';
  @IsString() @MaxLength(100) specialty!: string;
}
export class AcceptInviteDto {
  @IsString() @MinLength(64) @MaxLength(64) token!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
export class MembershipParams {
  @IsUUID() clinicId!: string;
}
