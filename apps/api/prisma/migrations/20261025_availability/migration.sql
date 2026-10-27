-- Additive migration: existing identities and directory records stay unchanged.
ALTER TABLE "DoctorProfile" ADD COLUMN "scheduleVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "WorkingDay" (
  "id" UUID NOT NULL, "doctorId" UUID NOT NULL, "weekday" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL, "endMinute" INTEGER NOT NULL,
  CONSTRAINT "WorkingDay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkingDay_range" CHECK ("weekday" BETWEEN 0 AND 6 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute"),
  CONSTRAINT "WorkingDay_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkingDay_doctorId_weekday_key" ON "WorkingDay"("doctorId", "weekday");
CREATE TABLE "BlockedPeriod" (
  "id" UUID NOT NULL, "doctorId" UUID NOT NULL, "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL, "reason" VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlockedPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BlockedPeriod_range" CHECK ("startsAt" < "endsAt"),
  CONSTRAINT "BlockedPeriod_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BlockedPeriod_doctorId_startsAt_idx" ON "BlockedPeriod"("doctorId", "startsAt");
