-- Additive snapshots: existing event identities and appointment records are retained.
ALTER TABLE "AppointmentEvent"
  ADD COLUMN "actorRole" VARCHAR(24),
  ADD COLUMN "actorDisplayName" VARCHAR(100);
ALTER TABLE "AppointmentEvent" ADD CONSTRAINT "AppointmentEvent_actor_role"
  CHECK ("actorRole" IS NULL OR "actorRole" IN ('PATIENT', 'DOCTOR', 'ADMIN', 'RECEPTIONIST'));
