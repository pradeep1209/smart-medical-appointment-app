import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import * as argon2 from 'argon2';
import { AuthGuard, AuthRequest } from './auth.guard';
import { AuthService, digest, publicUser, token, userInclude } from './auth.service';
import { PrismaService } from './prisma.service';

class ProfileDto { @IsString() @MinLength(2) @MaxLength(100) displayName!: string; }
class PasswordDto {
  @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}
class MemberParams { @IsUUID() clinicId!: string; @IsUUID() memberId!: string; }
class InviteParams { @IsUUID() clinicId!: string; @IsUUID() invitationId!: string; }
class AccessDto { @IsBoolean() active!: boolean; }
class RecoveryIssueDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(10) @MaxLength(500) verificationNote!: string;
}
class RecoveryDto {
  @IsString() @MinLength(64) @MaxLength(64) code!: string;
  @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}

@Controller('auth')
export class RecoveryController {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}
  @Post('recover') async recover(@Body() dto: RecoveryDto) {
    const passwordHash = await this.auth.hash(dto.newPassword);
    await this.db.$transaction(async tx => {
      const code = await tx.accountRecovery.findUnique({ where: { tokenHash: digest(dto.code) } });
      if (!code) throw new BadRequestException('This recovery code is invalid or expired. Contact the clinic.');
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${code.userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: code.userId } });
      const used = await tx.accountRecovery.updateMany({ where: { id: code.id, usedAt: null, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE' } }, data: { usedAt: new Date() } });
      if (!used.count || user.status !== 'ACTIVE') throw new BadRequestException('This recovery code is invalid or expired. Contact the clinic.');
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.accountRecovery.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.auditEvent.create({ data: { actorId: user.id, action: 'ACCOUNT_RECOVERED', subjectId: user.id } });
    });
    return { message: 'Password reset. Sign in with your new password.' };
  }
}

@Controller('account') @UseGuards(AuthGuard)
export class AccountController {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}
  @Post('profile') async profile(@Req() req: AuthRequest, @Body() dto: ProfileDto) {
    const name = dto.displayName.trim();
    if (name.length < 2) throw new BadRequestException('Enter at least two characters for your name.');
    const user = await this.db.$transaction(async tx => {
      const updated = await tx.user.update({ where: { id: req.actor.user.id }, data: { displayName: name }, include: userInclude });
      await tx.auditEvent.create({ data: { actorId: updated.id, action: 'PROFILE_UPDATED', subjectId: updated.id } });
      return updated;
    });
    return { user: publicUser(user), message: 'Your name has been updated.' };
  }
  @Post('password') async password(@Req() req: AuthRequest, @Body() dto: PasswordDto) {
    const hash = await this.auth.hash(dto.newPassword);
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${req.actor.user.id}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: req.actor.user.id } });
      if (!await argon2.verify(user.passwordHash, dto.currentPassword)) throw new ForbiddenException('Your current password is incorrect.');
      if (dto.currentPassword === dto.newPassword) throw new BadRequestException('Choose a different password.');
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
      await tx.accountRecovery.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditEvent.create({ data: { actorId: user.id, action: 'PASSWORD_CHANGED', subjectId: user.id } });
    }, { timeout: 15000 });
    return { message: 'Password changed. Sign in again on each device.' };
  }
  @Get('sessions') async sessions(@Req() req: AuthRequest) {
    const items = await this.db.authSession.findMany({ where: { userId: req.actor.user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, client: true, createdAt: true, expiresAt: true } });
    return { items: items.map(s => ({ ...s, current: s.id === req.actor.sessionId })) };
  }
  @Post('sessions/revoke-others') async revoke(@Req() req: AuthRequest) {
    const changed = await this.db.authSession.updateMany({ where: { userId: req.actor.user.id, id: { not: req.actor.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.db.auditEvent.create({ data: { actorId: req.actor.user.id, action: 'OTHER_SESSIONS_REVOKED', subjectId: req.actor.user.id } });
    return { message: 'Other sessions have been signed out.', count: changed.count };
  }
}

@Controller('clinics/:clinicId') @UseGuards(AuthGuard)
export class AccessController {
  constructor(private readonly db: PrismaService) {}
  private admin(req: AuthRequest, clinicId: string) {
    if (req.actor.client !== 'WEB' || !req.actor.user.memberships.some(m => m.clinicId === clinicId && m.role === 'ADMIN')) throw new ForbiddenException('Clinic administrator access is required.');
  }
  @Post('recovery-codes') async recovery(@Req() req: AuthRequest, @Param('clinicId') clinicId: string, @Body() dto: RecoveryIssueDto) {
    this.admin(req, clinicId);
    if (dto.verificationNote.trim().length < 10) throw new BadRequestException('Describe how you verified this person.');
    const secret = token();
    const expiresAt = new Date(Date.now() + 30 * 60000);
    await this.db.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { email: dto.email.trim().toLowerCase() }, include: userInclude });
      if (!user || user.status !== 'ACTIVE' || user.id === req.actor.user.id || user.memberships.some(m => m.role === 'ADMIN') || (!user.memberships.some(m => m.clinicId === clinicId) && !await tx.clinicPatient.count({ where: { clinicId, patient: { userId: user.id } } }))) throw new ForbiddenException('Recovery is available for active patients and non-admin staff in your clinic.');
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      await tx.accountRecovery.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.accountRecovery.create({ data: { userId: user.id, issuerId: req.actor.user.id, verificationNote: dto.verificationNote.trim(), tokenHash: digest(secret), expiresAt } });
      await tx.auditEvent.create({ data: { actorId: req.actor.user.id, clinicId, action: 'RECOVERY_CODE_ISSUED', subjectId: user.id } });
    });
    return { code: secret, expiresAt, message: 'Share this code privately with the verified account holder. It expires in 30 minutes and works once.' };
  }
  @Post('members/:memberId/access') async access(@Req() req: AuthRequest, @Param() p: MemberParams, @Body() dto: AccessDto) {
    this.admin(req, p.clinicId);
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Clinic" WHERE "id" = ${p.clinicId}::uuid FOR UPDATE`;
      const member = await tx.membership.findFirst({ where: { id: p.memberId, clinicId: p.clinicId } });
      if (!member) throw new ConflictException('This clinic membership no longer exists.');
      if (member.userId === req.actor.user.id) throw new ConflictException('You cannot change your own clinic access.');
      if (!dto.active && member.role === 'ADMIN' && member.active && await tx.membership.count({ where: { clinicId: p.clinicId, active: true, role: 'ADMIN', user: { status: 'ACTIVE' } } }) <= 1) throw new ConflictException('Keep at least one active clinic administrator.');
      await tx.membership.update({ where: { id: member.id }, data: { active: dto.active } });
      if (!dto.active) await tx.authSession.updateMany({ where: { userId: member.userId, client: 'WEB', revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditEvent.create({ data: { actorId: req.actor.user.id, clinicId: p.clinicId, action: dto.active ? 'CLINIC_ACCESS_RESTORED' : 'CLINIC_ACCESS_REVOKED', subjectId: member.id } });
    });
    return { message: dto.active ? 'Clinic access restored. They can sign in again.' : 'Clinic access removed. Existing appointments and clinical history are retained.' };
  }
  @Post('invitations/:invitationId/revoke') async revoke(@Req() req: AuthRequest, @Param() p: InviteParams) {
    this.admin(req, p.clinicId);
    await this.db.$transaction(async tx => {
      const result = await tx.staffInvitation.updateMany({ where: { id: p.invitationId, clinicId: p.clinicId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      if (!result.count) throw new ConflictException('This invitation is already used or revoked.');
      await tx.auditEvent.create({ data: { actorId: req.actor.user.id, clinicId: p.clinicId, action: 'INVITATION_REVOKED', subjectId: p.invitationId } });
    });
    return { message: 'Invitation revoked.' };
  }
}
