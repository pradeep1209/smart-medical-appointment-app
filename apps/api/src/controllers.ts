import { Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response, Request } from 'express';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthGuard, AuthRequest } from './auth.guard';
import { AuthService, digest, publicUser, token, userInclude } from './auth.service';
import { AcceptInviteDto, InviteDto, LoginDto, MembershipParams, RefreshDto, RegisterDto } from './dto';
import { PrismaService } from './prisma.service';
import { isTrustedWebOrigin } from './web-origin';

const cookieOptions = () => ({ httpOnly: true, sameSite: 'strict' as const, secure: process.env.COOKIE_SECURE === 'true', path: '/' });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly db: PrismaService) {}
  @Post('mobile/register') register(@Body() dto: RegisterDto) { return this.auth.register(dto); }
  @Post('mobile/login') login(@Body() dto: LoginDto) { return this.auth.mobileLogin(dto); }
  @Post('mobile/refresh') refresh(@Body() dto: RefreshDto) { return this.auth.refresh(dto.refreshToken); }
  @Post('web/login') async web(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!isTrustedWebOrigin(req.get('origin'))) throw new ForbiddenException('Sign in from the clinic dashboard.');
    const result = await this.auth.webLogin(dto);
    res.cookie('careslot_session', result.secret, { ...cookieOptions(), maxAge: 8 * 3600000 });
    res.cookie('careslot_csrf', result.csrf, { ...cookieOptions(), httpOnly: false, maxAge: 8 * 3600000 });
    return { user: result.user };
  }
  @Get('me') @UseGuards(AuthGuard) me(@Req() req: AuthRequest) { return { user: publicUser(req.actor.user) }; }
  @Post('logout') @UseGuards(AuthGuard) async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.actor);
    if (req.actor.client === 'WEB') {
      res.clearCookie('careslot_session', cookieOptions());
      res.clearCookie('careslot_csrf', { ...cookieOptions(), httpOnly: false });
    }
    return { message: 'Signed out.' };
  }
  @Post('accept-invitation') async accept(@Body() dto: AcceptInviteDto) {
    const saved = await this.db.staffInvitation.findUnique({ where: { tokenHash: digest(dto.token) } });
    if (!saved || saved.acceptedAt || saved.revokedAt || saved.expiresAt.getTime() <= Date.now()) throw new ConflictException('This invitation is expired or has already been used. Ask the clinic for a new invitation.');
    const existing = await this.db.user.findUnique({ where: { email: saved.email } });
    if (existing && (existing.status !== 'ACTIVE' || !await argon2.verify(existing.passwordHash, dto.password))) throw new ForbiddenException('Use the password for your existing CareSlot account.');
    const passwordHash = existing?.passwordHash ?? await this.auth.hash(dto.password);
    try {
      await this.db.$transaction(async tx => {
        if (existing) {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${existing.id}::uuid FOR UPDATE`;
          const current = await tx.user.findUniqueOrThrow({ where: { id: existing.id } });
          if (current.status !== 'ACTIVE' || current.passwordHash !== existing.passwordHash) throw new ForbiddenException('Your account changed. Retry with your current password.');
        }
        const used = await tx.staffInvitation.updateMany({ where: { id: saved.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
        if (used.count !== 1) throw new ConflictException('This invitation has already been used.');
        const user = existing ?? await tx.user.create({ data: { email: saved.email, displayName: saved.displayName, passwordHash } });
        const membership = await tx.membership.create({ data: { userId: user.id, clinicId: saved.clinicId, role: saved.role } });
        if (saved.role === 'DOCTOR') await tx.doctorProfile.create({ data: { membershipId: membership.id, specialty: saved.specialty! } });
        await tx.auditEvent.create({ data: { actorId: user.id, clinicId: saved.clinicId, action: 'STAFF_INVITATION_ACCEPTED', subjectId: membership.id } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('An account or membership already exists. Sign in, or ask the clinic to issue a new invitation.');
      throw error;
    }
    return { message: 'Your clinic account is ready. Sign in to continue.' };
  }
}

function scope(req: AuthRequest, clinicId: string, adminOnly = false) {
  const membership = req.actor.user.memberships.find(m => m.clinicId === clinicId);
  if (req.actor.client !== 'WEB' || !membership || (adminOnly && membership.role !== 'ADMIN')) throw new ForbiddenException('You do not have access to this clinic action.');
  return membership;
}

@Controller('clinics/:clinicId') @UseGuards(AuthGuard)
export class ClinicController {
  constructor(private readonly db: PrismaService) {}
  @Get('doctor-profile') doctorProfile(@Req() req: AuthRequest, @Param() p: MembershipParams) {
    const membership = scope(req, p.clinicId);
    if (membership.role !== 'DOCTOR') throw new ForbiddenException('This view is for your own doctor profile.');
    return {
      clinic: { id: membership.clinicId, name: membership.clinic.name, timezone: membership.clinic.timezone },
      doctor: membership.doctor ? {
        id: membership.doctor.id, name: req.actor.user.displayName,
        specialty: membership.doctor.specialty, consultationMinutes: membership.doctor.consultationMinutes,
      } : null,
    };
  }
  @Get('overview') async overview(@Req() req: AuthRequest, @Param() p: MembershipParams) {
    const membership = scope(req, p.clinicId);
    const [staff, doctors, patients] = await Promise.all([
      this.db.membership.count({ where: { clinicId: p.clinicId, active: true, user: { status: 'ACTIVE' } } }),
      this.db.doctorProfile.count({ where: { membership: { clinicId: p.clinicId, active: true, user: { status: 'ACTIVE' } } } }),
      this.db.clinicPatient.count({ where: { clinicId: p.clinicId } }),
    ]);
    return { clinic: { id: membership.clinicId, name: membership.clinic.name, timezone: membership.clinic.timezone }, role: membership.role, counts: { staff, doctors, patients } };
  }
  @Get('team') async team(@Req() req: AuthRequest, @Param() p: MembershipParams) {
    scope(req, p.clinicId, true);
    const [members, invitations] = await Promise.all([
      this.db.membership.findMany({ where: { clinicId: p.clinicId }, include: { user: { select: { displayName: true, email: true, status: true } }, doctor: true }, orderBy: { createdAt: 'asc' } }),
      this.db.staffInvitation.findMany({ where: { clinicId: p.clinicId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, email: true, displayName: true, role: true, expiresAt: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { members, invitations };
  }
  @Get('doctors') async doctors(@Req() req: AuthRequest, @Param() p: MembershipParams) {
    scope(req, p.clinicId);
    return { doctors: await this.db.doctorProfile.findMany({ where: { membership: { clinicId: p.clinicId, active: true, user: { status: 'ACTIVE' } } }, select: { id: true, specialty: true, consultationMinutes: true, membership: { select: { user: { select: { displayName: true } } } } }, orderBy: { id: 'asc' } }) };
  }
  @Get('patients') async patients(@Req() req: AuthRequest, @Param() p: MembershipParams) {
    const membership = scope(req, p.clinicId);
    if (!['ADMIN', 'RECEPTIONIST'].includes(membership.role)) throw new ForbiddenException('Patient registration lists are available to reception and administration.');
    const [items, total] = await Promise.all([
      this.db.clinicPatient.findMany({ where: { clinicId: p.clinicId }, take: 50, orderBy: { createdAt: 'desc' }, select: { createdAt: true, patient: { select: { id: true, user: { select: { displayName: true, email: true } } } } } }),
      this.db.clinicPatient.count({ where: { clinicId: p.clinicId } }),
    ]);
    return { items, total };
  }
  @Post('invitations') async invite(@Req() req: AuthRequest, @Param() p: MembershipParams, @Body() dto: InviteDto) {
    scope(req, p.clinicId, true);
    if (dto.displayName.trim().length < 2 || (dto.role === 'DOCTOR' && !dto.specialty.trim())) throw new ConflictException('Enter a name and a specialty for a doctor.');
    const email = dto.email.trim().toLowerCase();
    if (await this.db.membership.findFirst({ where: { clinicId: p.clinicId, user: { email } } })) throw new ConflictException('This person already has a clinic membership.');
    const secret = token();
    const invitation = await this.db.$transaction(async tx => {
      await tx.staffInvitation.updateMany({ where: { clinicId: p.clinicId, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const created = await tx.staffInvitation.create({ data: { clinicId: p.clinicId, invitedById: req.actor.user.id, email, displayName: dto.displayName.trim(), role: dto.role, specialty: dto.role === 'DOCTOR' ? dto.specialty.trim() : null, tokenHash: digest(secret), expiresAt: new Date(Date.now() + 7 * 86400000) } });
      await tx.auditEvent.create({ data: { actorId: req.actor.user.id, clinicId: p.clinicId, action: 'STAFF_INVITED', subjectId: created.id } });
      return created;
    });
    return { invitation: { id: invitation.id, email, expiresAt: invitation.expiresAt }, invitationUrl: `${process.env.WEB_PUBLIC_URL}/accept-invite#token=${secret}` };
  }
}

@Controller('patient') @UseGuards(AuthGuard)
export class PatientController {
  constructor(private readonly db: PrismaService) {}
  @Get('home') async home(@Req() req: AuthRequest) {
    if (!req.actor.user.patient) throw new ForbiddenException('A patient profile is required.');
    const clinics = await this.db.clinicPatient.findMany({ where: { patientId: req.actor.user.patient.id }, include: { clinic: { include: { memberships: { where: { role: 'DOCTOR', active: true, user: { status: 'ACTIVE' } }, include: { doctor: true, user: { select: { displayName: true } } } } } } } });
    return { user: publicUser(req.actor.user), clinics: clinics.map(c => ({ id: c.clinicId, name: c.clinic.name, timezone: c.clinic.timezone, doctors: c.clinic.memberships.filter(m => m.doctor).map(m => ({ id: m.doctor!.id, name: m.user.displayName, specialty: m.doctor!.specialty, consultationMinutes: m.doctor!.consultationMinutes })) })) };
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly db: PrismaService) {}
  @Get() async health() { await this.db.$queryRaw`SELECT 1`; return { service: 'CareSlot API', database: 'connected' }; }
}
