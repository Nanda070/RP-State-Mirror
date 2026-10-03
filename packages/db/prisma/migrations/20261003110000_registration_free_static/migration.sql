-- Registrations store free-text static + applicant Discord id; character link becomes optional.

ALTER TABLE "registrations" ADD COLUMN "static_id" TEXT;
ALTER TABLE "registrations" ADD COLUMN "applicant_discord_id" TEXT;

UPDATE "registrations" AS r
SET
  "static_id" = c."static_id",
  "applicant_discord_id" = u."discord_id"
FROM "characters" AS c
JOIN "users" AS u ON u."id" = c."user_id"
WHERE r."character_id" = c."id";

-- Safety for any orphan rows without a character join.
UPDATE "registrations"
SET
  "static_id" = COALESCE("static_id", 'unknown'),
  "applicant_discord_id" = COALESCE("applicant_discord_id", 'unknown')
WHERE "static_id" IS NULL OR "applicant_discord_id" IS NULL;

ALTER TABLE "registrations" ALTER COLUMN "static_id" SET NOT NULL;
ALTER TABLE "registrations" ALTER COLUMN "applicant_discord_id" SET NOT NULL;
ALTER TABLE "registrations" ALTER COLUMN "character_id" DROP NOT NULL;

DROP INDEX IF EXISTS "registrations_character_id_kind_active_key";

CREATE UNIQUE INDEX "registrations_static_id_kind_active_key"
  ON "registrations"("static_id", "kind")
  WHERE "status" = 'ACTIVE';

CREATE INDEX "registrations_static_id_kind_status_idx"
  ON "registrations"("static_id", "kind", "status");
