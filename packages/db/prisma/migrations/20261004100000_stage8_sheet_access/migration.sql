-- Stage 8: who may open a table (PLAN §17.9).
-- PUBLIC — everyone, signed in or not; USERS — signed-in people listed by Discord id;
-- ADMINS — «Админ» and above only. Admins see every table whatever its access.

ALTER TABLE "sheet_documents"
  ADD COLUMN "access" TEXT NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN "allowed_discord_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
