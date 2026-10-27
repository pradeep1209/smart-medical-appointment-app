-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "address" VARCHAR(500) NOT NULL DEFAULT '',
ADD COLUMN     "contactEmail" VARCHAR(254) NOT NULL DEFAULT '',
ADD COLUMN     "logoData" TEXT,
ADD COLUMN     "phone" VARCHAR(40) NOT NULL DEFAULT '',
ADD COLUMN     "profileVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PatientProfile" ADD COLUMN     "allergies" VARCHAR(1000) NOT NULL DEFAULT '',
ADD COLUMN     "dateOfBirth" VARCHAR(10),
ADD COLUMN     "healthNotes" VARCHAR(2000) NOT NULL DEFAULT '',
ADD COLUMN     "phone" VARCHAR(40) NOT NULL DEFAULT '',
ADD COLUMN     "profileVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DoctorProfile" ADD COLUMN     "profileVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "qualifications" VARCHAR(200) NOT NULL DEFAULT '',
ADD COLUMN     "registrationNumber" VARCHAR(100) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "changeReason" VARCHAR(500) NOT NULL DEFAULT '',
ADD COLUMN     "documentNumber" VARCHAR(40),
ADD COLUMN     "documentStatus" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "issuedSnapshot" JSONB,
ADD COLUMN     "replacesId" UUID,
ADD COLUMN     "revokedAt" TIMESTAMPTZ(3),
ADD COLUMN     "verificationToken" VARCHAR(64);

-- CreateTable
CREATE TABLE "VisitSummary" (
    "id" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "issuerId" UUID NOT NULL,
    "summary" VARCHAR(4000) NOT NULL DEFAULT '',
    "instructions" VARCHAR(4000) NOT NULL DEFAULT '',
    "followUpDate" VARCHAR(10),
    "followUpInstructions" VARCHAR(1000) NOT NULL DEFAULT '',
    "issuedAt" TIMESTAMPTZ(3),
    "issuedSnapshot" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VisitSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthDocument" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "filename" VARCHAR(160) NOT NULL,
    "mime" VARCHAR(80) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "data" BYTEA,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "HealthDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentGrant" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DocumentGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxNotice" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clinicId" UUID,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "targetType" VARCHAR(40) NOT NULL,
    "targetId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "InboxNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationPlan" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "medicineId" UUID NOT NULL,
    "times" JSONB NOT NULL,
    "timezone" VARCHAR(80) NOT NULL,
    "startDate" VARCHAR(10) NOT NULL,
    "endDate" VARCHAR(10) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MedicationPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoseLog" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoseLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VisitSummary_appointmentId_key" ON "VisitSummary"("appointmentId");

-- CreateIndex
CREATE INDEX "HealthDocument_patientId_uploadedAt_idx" ON "HealthDocument"("patientId", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentGrant_documentId_appointmentId_key" ON "DocumentGrant"("documentId", "appointmentId");

-- CreateIndex
CREATE INDEX "InboxNotice_userId_createdAt_idx" ON "InboxNotice"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationPlan_userId_medicineId_key" ON "MedicationPlan"("userId", "medicineId");

-- CreateIndex
CREATE UNIQUE INDEX "DoseLog_planId_scheduledAt_key" ON "DoseLog"("planId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_documentNumber_key" ON "Prescription"("documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_verificationToken_key" ON "Prescription"("verificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_replacesId_key" ON "Prescription"("replacesId");

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitSummary" ADD CONSTRAINT "VisitSummary_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthDocument" ADD CONSTRAINT "HealthDocument_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGrant" ADD CONSTRAINT "DocumentGrant_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "HealthDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGrant" ADD CONSTRAINT "DocumentGrant_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGrant" ADD CONSTRAINT "DocumentGrant_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxNotice" ADD CONSTRAINT "InboxNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationPlan" ADD CONSTRAINT "MedicationPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationPlan" ADD CONSTRAINT "MedicationPlan_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "PrescriptionMedicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseLog" ADD CONSTRAINT "DoseLog_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MedicationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "Prescription_initial_visit_key";
CREATE UNIQUE INDEX "Prescription_initial_visit_key" ON "Prescription"("appointmentId") WHERE "renewalOfId" IS NULL AND "replacesId" IS NULL;
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_document_status" CHECK ("documentStatus" IN ('ACTIVE','REPLACED','REVOKED'));
ALTER TABLE "DoseLog" ADD CONSTRAINT "DoseLog_status" CHECK ("status" IN ('TAKEN','SKIPPED'));
ALTER TABLE "MedicationPlan" ADD CONSTRAINT "MedicationPlan_date_order" CHECK ("startDate" <= "endDate" AND jsonb_typeof("times") = 'array' AND jsonb_array_length("times") BETWEEN 1 AND 6);
ALTER TABLE "HealthDocument" ADD CONSTRAINT "HealthDocument_size" CHECK ("size" BETWEEN 1 AND 5242880);
