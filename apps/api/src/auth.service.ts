import { ConflictException, ForbiddenException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, SessionClient } from '@prisma/client';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaService } from './prisma.service';
import { LoginDto, RegisterDto } from './dto';
import { isTrustedWebOrigin } from './web-origin';

export const userInclude = { patient: true, memberships: { where: { active: true }, include: { clinic: true, doctor: true } } } satisfies Prisma.UserInclude;
export type Account = Prisma.UserGetPayload<{ include: typeof userInclude }>;
export type Actor = { user: Account; sessionId: string; client: SessionClient };
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function equalHash(value: string, expected: string | null) {
  return !!expected && timingSafeEqual(Buffer.from(digest(value), 'hex'), Buffer.from(expected, 'hex'));
}
export const publicUser = (u: Account) => ({
  id: u.id, email: u.email, displayName: u.displayName, patientId: u.patient?.id ?? null,
  memberships: u.memberships.map(m => ({ id: m.id, clinicId: m.clinicId, clinicName: m.clinic.name, role: m.role })),
});

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';
  constructor(private readonly db: PrismaService, private readonly jwt: JwtService) {}
  async onModuleInit() { this.dummyHash = await this.hash(token()); }
  hash(password: string) { return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }); }
  async credentials(dto: LoginDto) {
    const user = await this.db.user.findUnique({ where: { email: dto.email.trim().toLowerCase() }, include: userInclude });
    const valid = await argon2.verify(user?.passwordHash ?? this.dummyHash, dto.password);
    if (!valid || !user || user.status !== 'ACTIVE') throw new UnauthorizedException('Email or password is incorrect.');
    return user;
  }
  async register(dto: RegisterDto) {
    const name = dto.displayName.trim();
    if (name.length < 2) throw new ConflictException('Enter your full name.');
    const passwordHash = await this.hash(dto.password);
    const clinic = await this.db.clinic.findUnique({ where: { slug: 'careslot' } });
    if (!clinic) throw new ConflictException('The clinic has not been configured. Contact the clinic.');
    let user: Account;
    try {
      user = await this.db.$transaction(async tx => {
        const u = await tx.user.create({ data: {
          email: dto.email.trim().toLowerCase(), displayName: name, passwordHash,
          patient: { create: { clinics: { create: { clinicId: clinic.id } } } },
        }, include: userInclude });
        await tx.auditEvent.create({ data: { actorId: u.id, clinicId: clinic.id, action: 'PATIENT_REGISTERED', subjectId: u.id } });
        return u;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('An account already uses this email. Sign in instead.');
      throw error;
    }
    return this.mobileSession(user);
  }
  async mobileLogin(dto: LoginDto) {
    const user = await this.credentials(dto);
    if (!user.patient) throw new ForbiddenException('This is a clinic staff account. Use the clinic web dashboard.');
    return this.mobileSession(user);
  }
  private access(userId: string, sessionId: string, generation: number) {
    return this.jwt.sign({ sid: sessionId, gen: generation }, { subject: userId, issuer: 'careslot', audience: 'careslot-mobile', expiresIn: '15m', algorithm: 'HS256' });
  }
  private async mobileSession(user: Account) {
    const secret = token();
    const session = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (current.status !== 'ACTIVE' || current.passwordHash !== user.passwordHash) throw new UnauthorizedException('Your account changed. Sign in again.');
      return tx.authSession.create({ data: { userId: user.id, client: 'MOBILE', tokenHash: digest(secret), expiresAt: new Date(Date.now() + 30 * 86400000) } });
    });
    return { user: publicUser(user), accessToken: this.access(user.id, session.id, 0), refreshToken: `${session.id}.${secret}`, expiresIn: 900 };
  }
  async refresh(value: string) {
    const [id, secret, extra] = value.split('.');
    if (!id || !secret || extra !== undefined || !uuid.test(id) || !/^[0-9a-f]{64}$/.test(secret)) throw new UnauthorizedException('Sign in again.');
    const saved = await this.db.authSession.findUnique({ where: { id }, include: { user: { include: userInclude } } });
    if (!saved || saved.client !== 'MOBILE' || saved.revokedAt || saved.expiresAt.getTime() <= Date.now() || saved.user.status !== 'ACTIVE') throw new UnauthorizedException('Sign in again.');
    if (!equalHash(secret, saved.tokenHash)) {
      if (equalHash(secret, saved.previousTokenHash)) await this.db.authSession.update({ where: { id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Sign in again.');
    }
    const next = token();
    const changed = await this.db.authSession.updateMany({ where: { id, tokenHash: saved.tokenHash, generation: saved.generation, revokedAt: null, expiresAt: { gt: new Date() } }, data: { tokenHash: digest(next), previousTokenHash: saved.tokenHash, generation: { increment: 1 } } });
    if (changed.count !== 1) throw new UnauthorizedException('Sign in again.');
    return { user: publicUser(saved.user), accessToken: this.access(saved.userId, id, saved.generation + 1), refreshToken: `${id}.${next}`, expiresIn: 900 };
  }
  async webLogin(dto: LoginDto) {
    const user = await this.credentials(dto);
    if (!user.memberships.length) throw new ForbiddenException('Use the patient Android app for this account.');
    const secret = token(), csrf = token();
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id }, include: userInclude });
      if (current.status !== 'ACTIVE' || current.passwordHash !== user.passwordHash || !current.memberships.length) throw new UnauthorizedException('Your account changed. Sign in again.');
      await tx.authSession.create({ data: { userId: user.id, client: 'WEB', tokenHash: digest(secret), csrfHash: digest(csrf), expiresAt: new Date(Date.now() + 8 * 3600000) } });
    });
    return { secret, csrf, user: publicUser(user) };
  }
  async authenticate(bearer: string | undefined, cookie: string | undefined): Promise<Actor> {
    if (bearer) {
      let claims: { sid: string; sub: string; gen: number };
      try { claims = this.jwt.verify(bearer, { issuer: 'careslot', audience: 'careslot-mobile', algorithms: ['HS256'] }); }
      catch { throw new UnauthorizedException('Your session has expired. Sign in again.'); }
      if (typeof claims.sid !== 'string' || !uuid.test(claims.sid)) throw new UnauthorizedException();
      const session = await this.db.authSession.findUnique({ where: { id: claims.sid }, include: { user: { include: userInclude } } });
      if (!session || session.client !== 'MOBILE' || session.userId !== claims.sub || session.generation !== claims.gen || session.revokedAt || session.expiresAt.getTime() <= Date.now() || session.user.status !== 'ACTIVE') throw new UnauthorizedException('Sign in again.');
      return { user: session.user, sessionId: session.id, client: 'MOBILE' };
    }
    if (!cookie || cookie.length !== 64) throw new UnauthorizedException('Sign in to continue.');
    const session = await this.db.authSession.findUnique({ where: { tokenHash: digest(cookie) }, include: { user: { include: userInclude } } });
    if (!session || session.client !== 'WEB' || session.revokedAt || session.expiresAt.getTime() <= Date.now() || session.user.status !== 'ACTIVE' || !session.user.memberships.length) throw new UnauthorizedException('Sign in again.');
    return { user: session.user, sessionId: session.id, client: 'WEB' };
  }
  async csrf(actor: Actor, origin: string | undefined, value: string | undefined) {
    if (!isTrustedWebOrigin(origin) || !value || value.length !== 64) throw new ForbiddenException('Reload this page and try again.');
    const session = await this.db.authSession.findUnique({ where: { id: actor.sessionId } });
    if (!session || !equalHash(value, session.csrfHash)) throw new ForbiddenException('Reload this page and try again.');
  }
  async logout(actor: Actor) { await this.db.authSession.updateMany({ where: { id: actor.sessionId, userId: actor.user.id }, data: { revokedAt: new Date() } }); }
}
