-- Stage 7: Discord badges and avatar frame in the member snapshot; legal texts with versions;
-- record of which version each user accepted.

ALTER TABLE "discord_guild_members"
  ADD COLUMN "public_flags" INTEGER,
  ADD COLUMN "avatar_decoration_url" TEXT;

CREATE TABLE "legal_documents" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_discord_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "legal_documents_kind_created_at_idx" ON "legal_documents"("kind", "created_at");
-- One published text per document; older versions stay as history.
CREATE UNIQUE INDEX "legal_documents_kind_active_key" ON "legal_documents"("kind") WHERE "status" = 'ACTIVE';

CREATE TABLE "legal_consents" (
    "id" TEXT NOT NULL,
    "discord_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_consents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "legal_consents_discord_id_version_key" ON "legal_consents"("discord_id", "version");
