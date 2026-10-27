CREATE TABLE "AccountRecovery" (
  "id" UUID NOT NULL PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "issuerId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "verificationNote" VARCHAR(500) NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "usedAt" TIMESTAMPTZ(3)
);
CREATE UNIQUE INDEX "AccountRecovery_tokenHash_key" ON "AccountRecovery"("tokenHash");
CREATE INDEX "AccountRecovery_userId_usedAt_idx" ON "AccountRecovery"("userId", "usedAt");
GRANT SELECT, INSERT, UPDATE, DELETE ON "AccountRecovery" TO careslot_app;
