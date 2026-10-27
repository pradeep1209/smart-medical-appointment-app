import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

export function authRateLimits() {
  const router = Router();
  const common = { windowMs: 15 * 60000, standardHeaders: 'draft-8' as const, legacyHeaders: false };
  // Session checks and logout must remain available even when sign-in is throttled.
  router.post(['/web/login', '/mobile/login'], rateLimit({
    ...common, limit: 40, skipSuccessfulRequests: true,
    message: { message: 'Too many sign-in attempts. Please try again later.' },
  }));
  router.post('/mobile/register', rateLimit({
    ...common, limit: 40,
    message: { message: 'Too many registration attempts. Please try again later.' },
  }));
  router.post('/accept-invitation', rateLimit({
    ...common, limit: 40,
    message: { message: 'Too many invitation attempts. Please try again later.' },
  }));
  router.post('/mobile/refresh', rateLimit({
    ...common, limit: 120, skipSuccessfulRequests: true,
    message: { message: 'Too many session-refresh attempts. Please try again later.' },
  }));
  return router;
}
