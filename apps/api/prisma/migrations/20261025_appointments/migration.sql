CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CANCELLED', 'ATTENDED', 'MISSED');
CREATE TABLE "Appointment" (
  "id" UUID NOT NULL PRIMARY KEY, "clinicId" UUID NOT NULL REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "doctorId" UUID NOT NULL REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "patientId" UUID NOT NULL REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestKey" UUID NOT NULL, "requestedStart" TIMESTAMPTZ(3) NOT NULL,
  "startsAt" TIMESTAMPTZ(3) NOT NULL, "endsAt" TIMESTAMPTZ(3) NOT NULL, "timezone" VARCHAR(80) NOT NULL,
  "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED', "version" INTEGER NOT NULL DEFAULT 0,
  "needsReview" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Appointment_range" CHECK ("endsAt" > "startsAt" AND "version" >= 0)
);
CREATE UNIQUE INDEX "Appointment_patientId_requestKey_key" ON "Appointment"("patientId", "requestKey");
CREATE INDEX "Appointment_doctorId_status_startsAt_idx" ON "Appointment"("doctorId", "status", "startsAt");
CREATE INDEX "Appointment_patientId_status_startsAt_idx" ON "Appointment"("patientId", "status", "startsAt");
CREATE INDEX "Appointment_clinicId_startsAt_idx" ON "Appointment"("clinicId", "startsAt");
CREATE TABLE "AppointmentEvent" (
  "id" UUID NOT NULL PRIMARY KEY,
  "appointmentId" UUID NOT NULL REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "action" VARCHAR(40) NOT NULL, "fromStartsAt" TIMESTAMPTZ(3), "fromEndsAt" TIMESTAMPTZ(3),
  "toStartsAt" TIMESTAMPTZ(3) NOT NULL, "toEndsAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AppointmentEvent_appointmentId_createdAt_idx" ON "AppointmentEvent"("appointmentId", "createdAt");
