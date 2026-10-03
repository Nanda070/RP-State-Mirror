-- IC blacklist → federal-wanted-like government list (number, forum evidence, close flow, Discord message link).

ALTER TABLE "ic_blacklist" ADD COLUMN "number" TEXT;
ALTER TABLE "ic_blacklist" ADD COLUMN "forum_link" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ic_blacklist" ADD COLUMN "closed_by_discord_id" TEXT;
ALTER TABLE "ic_blacklist" ADD COLUMN "close_reason" TEXT;

-- Backfill system numbers for any pre-existing rows (BL-001 …).
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS seq
  FROM "ic_blacklist"
)
UPDATE "ic_blacklist" AS bl
SET "number" = 'BL-' || LPAD(numbered.seq::text, 3, '0')
FROM numbered
WHERE bl.id = numbered.id;

ALTER TABLE "ic_blacklist" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX "ic_blacklist_number_key" ON "ic_blacklist"("number");

-- Migrate close actor from revoked_by → closed_by where present.
UPDATE "ic_blacklist"
SET "closed_by_discord_id" = "revoked_by_discord_id"
WHERE "revoked_by_discord_id" IS NOT NULL AND "closed_by_discord_id" IS NULL;

ALTER TABLE "ic_blacklist" DROP COLUMN "evidence_file_ids";
ALTER TABLE "ic_blacklist" DROP COLUMN "revoked_by_discord_id";

ALTER TABLE "ic_blacklist" ALTER COLUMN "forum_link" DROP DEFAULT;

-- Link published Discord messages (wanted analogy).
ALTER TABLE "sent_message_links" ADD COLUMN "ic_blacklist_id" TEXT;
ALTER TABLE "sent_message_links" ADD CONSTRAINT "sent_message_links_ic_blacklist_id_fkey"
  FOREIGN KEY ("ic_blacklist_id") REFERENCES "ic_blacklist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "sent_message_links_ic_blacklist_id_idx" ON "sent_message_links"("ic_blacklist_id");
