CREATE TYPE "RefillStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TABLE "Prescription" (
  "id" UUID NOT NULL PRIMARY KEY,
  "appointmentId" UUID NOT NULL REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "issuerId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestKey" UUID NOT NULL, "renewalOfId" UUID REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "notes" VARCHAR(1000) NOT NULL DEFAULT '', "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Prescription_requestKey_key" ON "Prescription"("requestKey");
CREATE UNIQUE INDEX "Prescription_renewalOfId_key" ON "Prescription"("renewalOfId");
-- One initial prescription per attended visit; approved renewals remain separate immutable documents.
CREATE UNIQUE INDEX "Prescription_initial_visit_key" ON "Prescription"("appointmentId") WHERE "renewalOfId" IS NULL;
CREATE INDEX "Prescription_appointmentId_issuedAt_idx" ON "Prescription"("appointmentId", "issuedAt");
CREATE TABLE "PrescriptionMedicine" (
  "id" UUID NOT NULL PRIMARY KEY, "prescriptionId" UUID NOT NULL REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "position" INTEGER NOT NULL CHECK ("position" BETWEEN 0 AND 9),
  "name" VARCHAR(120) NOT NULL CHECK (length(trim("name")) > 0),
  "dose" VARCHAR(100) NOT NULL CHECK (length(trim("dose")) > 0),
  "frequency" VARCHAR(160) NOT NULL CHECK (length(trim("frequency")) > 0),
  "duration" VARCHAR(100) NOT NULL CHECK (length(trim("duration")) > 0), "instructions" VARCHAR(500) NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX "PrescriptionMedicine_prescriptionId_position_key" ON "PrescriptionMedicine"("prescriptionId", "position");
CREATE TABLE "RefillRequest" (
  "id" UUID NOT NULL PRIMARY KEY, "prescriptionId" UUID NOT NULL REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestKey" UUID NOT NULL, "patientNote" VARCHAR(1000) NOT NULL,
  "status" "RefillStatus" NOT NULL DEFAULT 'PENDING', "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version" >= 0),
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedAt" TIMESTAMPTZ(3),
  "reviewerId" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reviewNote" VARCHAR(1000), "renewalId" UUID REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RefillRequest_decision" CHECK (
    ("status" = 'PENDING' AND "reviewedAt" IS NULL AND "reviewerId" IS NULL AND "reviewNote" IS NULL AND "renewalId" IS NULL) OR
    ("status" = 'REJECTED' AND "reviewedAt" IS NOT NULL AND "reviewerId" IS NOT NULL AND "reviewNote" IS NOT NULL AND length(trim("reviewNote")) >= 2 AND "renewalId" IS NULL) OR
    ("status" = 'APPROVED' AND "reviewedAt" IS NOT NULL AND "reviewerId" IS NOT NULL AND "reviewNote" IS NOT NULL AND length(trim("reviewNote")) >= 2 AND "renewalId" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "RefillRequest_renewalId_key" ON "RefillRequest"("renewalId");
CREATE UNIQUE INDEX "RefillRequest_prescriptionId_requestKey_key" ON "RefillRequest"("prescriptionId", "requestKey");
CREATE UNIQUE INDEX "RefillRequest_one_pending_key" ON "RefillRequest"("prescriptionId") WHERE "status" = 'PENDING';
CREATE INDEX "RefillRequest_status_requestedAt_idx" ON "RefillRequest"("status", "requestedAt");
