-- CreateTable: embed manager & button engine
CREATE TABLE "message_designs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "spec" JSONB NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_designs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sent_messages" (
    "id" TEXT NOT NULL,
    "guild_discord_id" TEXT NOT NULL,
    "channel_discord_id" TEXT NOT NULL,
    "message_discord_id" TEXT NOT NULL,
    "design_id" TEXT,
    "spec" JSONB NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sent_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "button_actions" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "button_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: documents
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "faction_code" TEXT NOT NULL,
    "author_discord_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_responses" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "author_discord_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable: federal wanted
CREATE TABLE "wanteds" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "static_id" TEXT NOT NULL,
    "character_name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "issued_by_discord_id" TEXT NOT NULL,
    "closed_by_discord_id" TEXT,
    "evidence" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wanteds_pkey" PRIMARY KEY ("id")
);

-- CreateTable: fines
CREATE TABLE "fines" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "static_id" TEXT NOT NULL,
    "character_name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "issued_by_discord_id" TEXT NOT NULL,
    "faction_code" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3),
    "paid_by_discord_id" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "due_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fines_pkey" PRIMARY KEY ("id")
);

-- CreateTable: personnel events
CREATE TABLE "personnel_events" (
    "id" TEXT NOT NULL,
    "faction_code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject_discord_id" TEXT NOT NULL,
    "subject_name" TEXT NOT NULL,
    "actor_discord_id" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personnel_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable: polymorphic link
CREATE TABLE "sent_message_links" (
    "id" TEXT NOT NULL,
    "sent_message_id" TEXT NOT NULL,
    "document_id" TEXT,
    "response_id" TEXT,
    "wanted_id" TEXT,
    "fine_id" TEXT,
    "personnel_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sent_message_links_pkey" PRIMARY KEY ("id")
);

-- Unique indexes (Prisma style)
CREATE UNIQUE INDEX "sent_messages_channel_discord_id_message_discord_id_key"
  ON "sent_messages"("channel_discord_id", "message_discord_id");

CREATE UNIQUE INDEX "documents_number_key" ON "documents"("number");
CREATE UNIQUE INDEX "wanteds_number_key" ON "wanteds"("number");
CREATE UNIQUE INDEX "fines_number_key" ON "fines"("number");

-- Indexes
CREATE INDEX "sent_messages_guild_discord_id_idx" ON "sent_messages"("guild_discord_id");

CREATE INDEX "button_actions_action_status_idx" ON "button_actions"("action", "status");

CREATE INDEX "documents_faction_code_status_idx" ON "documents"("faction_code", "status");
CREATE INDEX "documents_author_discord_id_idx"   ON "documents"("author_discord_id");

CREATE INDEX "document_responses_document_id_idx" ON "document_responses"("document_id");

CREATE INDEX "wanteds_static_id_idx" ON "wanteds"("static_id");
CREATE INDEX "wanteds_status_idx"    ON "wanteds"("status");

CREATE INDEX "fines_static_id_idx"    ON "fines"("static_id");
CREATE INDEX "fines_status_idx"       ON "fines"("status");
CREATE INDEX "fines_faction_code_idx" ON "fines"("faction_code");

CREATE INDEX "personnel_events_faction_code_idx"      ON "personnel_events"("faction_code");
CREATE INDEX "personnel_events_subject_discord_id_idx" ON "personnel_events"("subject_discord_id");

CREATE INDEX "sent_message_links_sent_message_id_idx" ON "sent_message_links"("sent_message_id");

-- Foreign keys
ALTER TABLE "sent_messages" ADD CONSTRAINT "sent_messages_design_id_fkey"
    FOREIGN KEY ("design_id") REFERENCES "message_designs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_responses" ADD CONSTRAINT "document_responses_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sent_message_links" ADD CONSTRAINT "sent_message_links_sent_message_id_fkey"
    FOREIGN KEY ("sent_message_id") REFERENCES "sent_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sent_message_links" ADD CONSTRAINT "sent_message_links_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sent_message_links" ADD CONSTRAINT "sent_message_links_response_id_fkey"
    FOREIGN KEY ("response_id") REFERENCES "document_responses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sent_message_links" ADD CONSTRAINT "sent_message_links_wanted_id_fkey"
    FOREIGN KEY ("wanted_id") REFERENCES "wanteds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sent_message_links" ADD CONSTRAINT "sent_message_links_fine_id_fkey"
    FOREIGN KEY ("fine_id") REFERENCES "fines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sent_message_links" ADD CONSTRAINT "sent_message_links_personnel_id_fkey"
    FOREIGN KEY ("personnel_id") REFERENCES "personnel_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
