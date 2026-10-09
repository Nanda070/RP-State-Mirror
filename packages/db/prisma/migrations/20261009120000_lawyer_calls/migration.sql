-- «Вызов адвоката»: a call on the ЧП server, accepted by one lawyer or cancelled by the caller.
CREATE TYPE "LawyerCallStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED');

CREATE TABLE "lawyer_calls" (
    "id" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "caller_discord_id" TEXT NOT NULL,
    "caller_name" TEXT NOT NULL,
    "guild_discord_id" TEXT NOT NULL,
    "channel_discord_id" TEXT NOT NULL,
    "message_discord_id" TEXT,
    "thread_discord_id" TEXT,
    "status" "LawyerCallStatus" NOT NULL DEFAULT 'PENDING',
    "accepted_by_discord_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lawyer_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lawyer_calls_status_idx" ON "lawyer_calls"("status");
CREATE INDEX "lawyer_calls_caller_discord_id_idx" ON "lawyer_calls"("caller_discord_id");
