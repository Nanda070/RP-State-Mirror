-- Last published Discord message that opens this form (form.open button).
ALTER TABLE "forms" ADD COLUMN "open_guild_discord_id" TEXT;
ALTER TABLE "forms" ADD COLUMN "open_channel_discord_id" TEXT;
ALTER TABLE "forms" ADD COLUMN "open_message_discord_id" TEXT;
