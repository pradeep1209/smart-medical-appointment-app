CREATE TABLE "AttendanceSnapshot" (
  "id" UUID NOT NULL PRIMARY KEY,
  "appointmentId" UUID NOT NULL REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "appointmentVersion" INTEGER NOT NULL CHECK ("appointmentVersion" >= 0),
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "asOf" TIMESTAMPTZ(3) NOT NULL,
  "status" VARCHAR(20) NOT NULL CHECK ("status" IN ('AVAILABLE','UNAVAILABLE')),
  "modelVersion" VARCHAR(100), "modelSha256" CHAR(64), "noShowProbability" DOUBLE PRECISION,
  "features" JSONB NOT NULL, "historyIds" UUID[] NOT NULL, "historyScope" VARCHAR(50) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceSnapshot_probability" CHECK (
    ("status" = 'AVAILABLE' AND "noShowProbability" BETWEEN 0 AND 1 AND "modelVersion" IS NOT NULL AND "modelSha256" IS NOT NULL AND jsonb_typeof("features") = 'object')
    OR ("status" = 'UNAVAILABLE' AND "noShowProbability" IS NULL AND "modelVersion" IS NULL AND "modelSha256" IS NULL)
  )
);
CREATE UNIQUE INDEX "AttendanceSnapshot_appointmentId_appointmentVersion_key" ON "AttendanceSnapshot"("appointmentId", "appointmentVersion");
CREATE INDEX "AttendanceSnapshot_appointmentId_createdAt_idx" ON "AttendanceSnapshot"("appointmentId", "createdAt");
GRANT SELECT, INSERT, DELETE ON "AttendanceSnapshot" TO careslot_app;
