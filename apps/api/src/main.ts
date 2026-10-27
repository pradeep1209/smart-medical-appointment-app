import './environment';
import 'reflect-metadata';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authRateLimits } from './auth-rate-limits';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { PrismaService } from './prisma.service';
import { AuthController, ClinicController, HealthController, PatientController } from './controllers';
import { AvailabilityController, PatientAvailabilityController } from './availability.controller';
import { AppointmentsService } from './appointments.service';
import { AttendanceService } from './attendance.service';
import { AttendanceModel } from './attendance-model';
import { PredictionController } from './prediction.controller';
import { PatientAppointmentsController, ClinicAppointmentsController } from './appointments.controller';
import { PrescriptionsService } from './prescriptions.service';
import { AccountController, AccessController, RecoveryController } from './account.controller';
import { PatientPrescriptionsController, DoctorPrescriptionsController } from './prescriptions.controller';
import { ExperienceController, VerificationController } from './experience.controller';
import { ExperienceService } from './experience.service';

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [AuthController, ClinicController, HealthController, PatientController, AvailabilityController, PatientAvailabilityController, PatientAppointmentsController, ClinicAppointmentsController, PatientPrescriptionsController, DoctorPrescriptionsController, AccountController, AccessController, RecoveryController, PredictionController, ExperienceController, VerificationController],
  providers: [PrismaService, AuthService, AuthGuard, AppointmentsService, PrescriptionsService, AttendanceService, AttendanceModel, ExperienceService],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.use('/api/v1/experience/documents', json({ limit: '7mb' }));
  app.use('/api/v1/experience/profiles/clinic', json({ limit: '300kb' }));
  // Nest detects the route parsers above by name and skips its default parser.
  // Keep a small global parser for all other JSON endpoints.
  app.use(json({ limit: '100kb' }));
  app.use('/api/v1/verify', rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }));
  if (process.env.ALLOW_LAN_DEV === 'true') {
    const { networkInterfaces } = await import('node:os');
    const address = process.env.API_LAN_ADDRESS!;
    if (!Object.values(networkInterfaces()).flat().some(n => n?.address === address)) throw Error('Configured Wi-Fi address is not assigned to this computer. Reconfigure Wi-Fi access.');
    // Keep loopback access for the dashboard; reject the computer's other network interfaces.
    app.use((req: { socket: { localAddress?: string } }, res: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) => {
      const local = req.socket.localAddress?.replace(/^::ffff:/, '');
      if (local !== address && local !== '127.0.0.1' && local !== '::1') return res.status(403).json({ message: 'Use the configured clinic Wi-Fi connection.' });
      next();
    });
  }
  app.use((_req: unknown, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); next();
  });
  app.use('/api/v1/auth', authRateLimits());
  app.use('/api/v1/account/password', rateLimit({ windowMs: 15 * 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many password-change attempts. Please try again later.' } }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT ?? 3001), process.env.API_HOST ?? '127.0.0.1');
}
bootstrap().catch(() => { console.error('CareSlot API could not start. Check the local PostgreSQL service and environment configuration.'); process.exitCode = 1; });
