-- Stage 6: technical bans, dashboard sessions, global admin role operations, service heartbeats.

CREATE TABLE "tech_bans" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_discord_id" TEXT NOT NULL,
    "revoked_by_discord_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tech_bans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tech_bans_kind_value_status_idx" ON "tech_bans"("kind", "value", "status");
-- One ACTIVE ban per subject; not expressible in Prisma schema.
CREATE UNIQUE INDEX "tech_bans_kind_value_active_key" ON "tech_bans"("kind", "value") WHERE "status" = 'ACTIVE';

CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "discord_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_discord_id" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");
CREATE INDEX "sessions_discord_id_created_at_idx" ON "sessions"("discord_id", "created_at");
CREATE INDEX "sessions_created_at_idx" ON "sessions"("created_at");

CREATE TABLE "admin_role_operations" (
    "id" TEXT NOT NULL,
    "target_discord_id" TEXT NOT NULL,
    "level" "AdminLevel",
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "report" JSONB NOT NULL DEFAULT '[]',
    "requested_by_discord_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "admin_role_operations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "admin_role_operations_target_discord_id_created_at_idx" ON "admin_role_operations"("target_discord_id", "created_at");
CREATE INDEX "admin_role_operations_created_at_idx" ON "admin_role_operations"("created_at");

CREATE TABLE "service_heartbeats" (
    "service" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "service_heartbeats_pkey" PRIMARY KEY ("service")
);
