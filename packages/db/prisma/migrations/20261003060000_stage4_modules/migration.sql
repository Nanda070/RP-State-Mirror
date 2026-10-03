-- CreateEnum
CREATE TYPE "RegistrationKind" AS ENUM ('VEHICLE', 'UNIFORM');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "WebhookRequestStatus" AS ENUM ('PENDING', 'FORM_BUILT', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FeedbackTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "characters" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "static_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "faction_code" TEXT,
    "department" TEXT,
    "rank" INTEGER,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" TEXT,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" TEXT NOT NULL,
    "kind" "RegistrationKind" NOT NULL,
    "character_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "evidence_file_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "decision" "DecisionStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_discord_id" TEXT,
    "rejection_reason" TEXT,
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "review_guild_id" TEXT,
    "review_channel_id" TEXT,
    "review_message_id" TEXT,
    "review_buttons" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_files" (
    "id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "from_faction_code" TEXT NOT NULL,
    "to_faction_code" TEXT NOT NULL,
    "from_rank" INTEGER NOT NULL,
    "to_rank" INTEGER NOT NULL,
    "document_file_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_decision" "DecisionStatus" NOT NULL DEFAULT 'PENDING',
    "target_decision" "DecisionStatus" NOT NULL DEFAULT 'PENDING',
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "source_decided_by_discord_id" TEXT,
    "target_decided_by_discord_id" TEXT,
    "review_guild_id" TEXT,
    "review_channel_id" TEXT,
    "review_message_id" TEXT,
    "review_buttons" JSONB NOT NULL DEFAULT '{}',
    "created_by_discord_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_requests" (
    "id" TEXT NOT NULL,
    "requester_discord_id" TEXT NOT NULL,
    "guild_discord_id" TEXT NOT NULL,
    "channel_discord_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "webhook_url" TEXT,
    "status" "WebhookRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ic_blacklist" (
    "id" TEXT NOT NULL,
    "static_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence_file_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_discord_id" TEXT NOT NULL,
    "revoked_by_discord_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ic_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_panels" (
    "id" TEXT NOT NULL,
    "guild_discord_id" TEXT NOT NULL,
    "channel_discord_id" TEXT NOT NULL,
    "message_discord_id" TEXT,
    "spec" JSONB NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_discord_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_tickets" (
    "id" TEXT NOT NULL,
    "author_discord_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "FeedbackTicketStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to_discord_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "author_discord_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachment_file_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "webhook_url" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3),
    "response_limit" INTEGER,
    "created_by_discord_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_fields" (
    "id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "validation" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "author_discord_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'discord',
    "values" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "characters_static_id_idx" ON "characters"("static_id");

-- CreateIndex
CREATE INDEX "characters_user_id_status_idx" ON "characters"("user_id", "status");

-- CreateIndex
CREATE INDEX "characters_faction_code_status_idx" ON "characters"("faction_code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_number_key" ON "tokens"("number");

-- CreateIndex
CREATE INDEX "tokens_character_id_status_idx" ON "tokens"("character_id", "status");

-- CreateIndex
CREATE INDEX "tokens_status_idx" ON "tokens"("status");

-- CreateIndex
CREATE INDEX "registrations_character_id_kind_status_idx" ON "registrations"("character_id", "kind", "status");

-- CreateIndex
CREATE INDEX "registrations_decision_status_idx" ON "registrations"("decision", "status");

-- CreateIndex
CREATE UNIQUE INDEX "media_files_object_key_key" ON "media_files"("object_key");

-- CreateIndex
CREATE INDEX "media_files_status_created_at_idx" ON "media_files"("status", "created_at");

-- CreateIndex
CREATE INDEX "transfers_character_id_status_idx" ON "transfers"("character_id", "status");

-- CreateIndex
CREATE INDEX "transfers_from_faction_code_status_idx" ON "transfers"("from_faction_code", "status");

-- CreateIndex
CREATE INDEX "transfers_to_faction_code_status_idx" ON "transfers"("to_faction_code", "status");

-- CreateIndex
CREATE INDEX "webhook_requests_status_created_at_idx" ON "webhook_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "ic_blacklist_static_id_status_idx" ON "ic_blacklist"("static_id", "status");

-- CreateIndex
CREATE INDEX "ic_blacklist_status_expires_at_idx" ON "ic_blacklist"("status", "expires_at");

-- CreateIndex
CREATE INDEX "role_panels_guild_discord_id_channel_discord_id_status_idx" ON "role_panels"("guild_discord_id", "channel_discord_id", "status");

-- CreateIndex
CREATE INDEX "feedback_tickets_status_created_at_idx" ON "feedback_tickets"("status", "created_at");

-- CreateIndex
CREATE INDEX "feedback_tickets_author_discord_id_idx" ON "feedback_tickets"("author_discord_id");

-- CreateIndex
CREATE INDEX "feedback_messages_ticket_id_created_at_idx" ON "feedback_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "forms_status_expires_at_idx" ON "forms"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "form_fields_form_id_key_key" ON "form_fields"("form_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "form_fields_form_id_position_key" ON "form_fields"("form_id", "position");

-- CreateIndex
CREATE INDEX "form_submissions_form_id_created_at_idx" ON "form_submissions"("form_id", "created_at");

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_messages" ADD CONSTRAINT "feedback_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "feedback_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique indexes (not expressible in Prisma schema): uniqueness applies to live rows only,
-- so revoked tokens, archived characters and closed applications never block new ones.
CREATE UNIQUE INDEX "characters_static_id_active_key" ON "characters"("static_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "characters_user_id_slot_active_key" ON "characters"("user_id", "slot") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "tokens_character_id_active_key" ON "tokens"("character_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "registrations_character_id_kind_active_key" ON "registrations"("character_id", "kind") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "transfers_character_id_pending_key" ON "transfers"("character_id") WHERE "status" = 'PENDING';
