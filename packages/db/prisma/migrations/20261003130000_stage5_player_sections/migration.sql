-- Stage 5: vehicle catalog photo, FAQ, account recovery, form builder, share links.

-- Vehicle catalog
ALTER TABLE "vehicle_models" ADD COLUMN "image_file_id" TEXT;
CREATE INDEX "vehicle_models_status_brand_idx" ON "vehicle_models"("status", "brand");

-- Forms: public page + antispam
ALTER TABLE "forms" ADD COLUMN "slug" TEXT;
ALTER TABLE "forms" ADD COLUMN "public_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "forms" ADD COLUMN "captcha_required" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "forms" ADD COLUMN "ip_limit_per_hour" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "forms" ADD COLUMN "success_message" TEXT;
CREATE UNIQUE INDEX "forms_slug_key" ON "forms"("slug");

-- Form fields: extended types, soft removal instead of delete
ALTER TABLE "form_fields" ADD COLUMN "options" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "form_fields" ADD COLUMN "help_text" TEXT;
ALTER TABLE "form_fields" ADD COLUMN "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE';
DROP INDEX "form_fields_form_id_position_key";
CREATE INDEX "form_fields_form_id_status_position_idx" ON "form_fields"("form_id", "status", "position");

-- Form submissions: source metadata for rate limiting
ALTER TABLE "form_submissions" ADD COLUMN "ip_address" TEXT;
ALTER TABLE "form_submissions" ADD COLUMN "user_agent" TEXT;
CREATE INDEX "form_submissions_form_id_ip_address_created_at_idx" ON "form_submissions"("form_id", "ip_address", "created_at");

-- Multi-step Discord form drafts
CREATE TABLE "form_drafts" (
    "id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "author_discord_id" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "step" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_drafts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "form_drafts_form_id_author_discord_id_key" ON "form_drafts"("form_id", "author_discord_id");
ALTER TABLE "form_drafts" ADD CONSTRAINT "form_drafts_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Public form IP bans
CREATE TABLE "form_ip_bans" (
    "id" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_discord_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_ip_bans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "form_ip_bans_ip_address_status_idx" ON "form_ip_bans"("ip_address", "status");
-- One ACTIVE ban per IP; not expressible in Prisma schema.
CREATE UNIQUE INDEX "form_ip_bans_ip_address_active_key" ON "form_ip_bans"("ip_address") WHERE "status" = 'ACTIVE';

-- FAQ
CREATE TABLE "faq_sections" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faq_sections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "faq_sections_status_position_idx" ON "faq_sections"("status", "position");

CREATE TABLE "faq_items" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "updated_by_discord_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faq_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "faq_items_section_id_status_position_idx" ON "faq_items"("section_id", "status", "position");
ALTER TABLE "faq_items" ADD CONSTRAINT "faq_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "faq_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Account recovery
CREATE TABLE "account_recoveries" (
    "id" TEXT NOT NULL,
    "new_discord_id" TEXT NOT NULL,
    "old_discord_id" TEXT NOT NULL,
    "character_name" TEXT NOT NULL,
    "static_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "decision" "DecisionStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_discord_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "moved_character_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_recoveries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "account_recoveries_decision_created_at_idx" ON "account_recoveries"("decision", "created_at");
CREATE INDEX "account_recoveries_new_discord_id_idx" ON "account_recoveries"("new_discord_id");
CREATE INDEX "account_recoveries_old_discord_id_idx" ON "account_recoveries"("old_discord_id");
-- One PENDING request per new account; not expressible in Prisma schema.
CREATE UNIQUE INDEX "account_recoveries_new_discord_id_pending_key" ON "account_recoveries"("new_discord_id") WHERE "decision" = 'PENDING';

-- Share links
CREATE TABLE "share_links" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_discord_id" TEXT NOT NULL,
    "revoked_by_discord_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links"("token");
CREATE INDEX "share_links_entity_type_entity_id_status_idx" ON "share_links"("entity_type", "entity_id", "status");
-- One ACTIVE link per record; not expressible in Prisma schema.
CREATE UNIQUE INDEX "share_links_entity_active_key" ON "share_links"("entity_type", "entity_id") WHERE "status" = 'ACTIVE';
