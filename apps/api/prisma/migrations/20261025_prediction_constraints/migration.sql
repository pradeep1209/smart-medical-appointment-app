-- CHECK accepts SQL NULL; require a probability for an available snapshot.
ALTER TABLE "AttendanceSnapshot" DROP CONSTRAINT "AttendanceSnapshot_probability";
ALTER TABLE "AttendanceSnapshot" ADD CONSTRAINT "AttendanceSnapshot_probability" CHECK (
  ("status" = 'AVAILABLE' AND "noShowProbability" IS NOT NULL AND "noShowProbability" BETWEEN 0 AND 1 AND "modelVersion" IS NOT NULL AND "modelSha256" IS NOT NULL AND jsonb_typeof("features") = 'object')
  OR ("status" = 'UNAVAILABLE' AND "noShowProbability" IS NULL AND "modelVersion" IS NULL AND "modelSha256" IS NULL)
);
