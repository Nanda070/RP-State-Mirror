-- Colour preset and own accent colour of the dashboard, chosen in the profile.
ALTER TABLE "users" ADD COLUMN "theme" TEXT;
ALTER TABLE "users" ADD COLUMN "accent_color" TEXT;
