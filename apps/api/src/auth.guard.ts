import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { Actor, AuthService } from './auth.service';
export type AuthRequest = Request & { actor: Actor };
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const header = req.headers.authorization;
    req.actor = await this.auth.authenticate(header?.startsWith('Bearer ') ? header.slice(7) : undefined, req.cookies?.careslot_session);
    if (req.actor.client === 'WEB' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) await this.auth.csrf(req.actor, req.get('origin'), req.get('x-csrf-token'));
    return true;
  }
}
