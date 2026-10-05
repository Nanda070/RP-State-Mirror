-- «В сети» in the profile: the Discord status of a person as the bot last saw it.
CREATE TABLE "user_presences" (
    "discord_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "last_online_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_presences_pkey" PRIMARY KEY ("discord_id")
);
