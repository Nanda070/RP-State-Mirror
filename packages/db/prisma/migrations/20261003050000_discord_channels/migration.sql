-- CreateTable
CREATE TABLE "discord_channels" (
    "id" TEXT NOT NULL,
    "discord_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discord_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discord_channels_discord_id_key" ON "discord_channels"("discord_id");

-- CreateIndex
CREATE INDEX "discord_channels_guild_id_status_idx" ON "discord_channels"("guild_id", "status");

-- AddForeignKey
ALTER TABLE "discord_channels" ADD CONSTRAINT "discord_channels_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
