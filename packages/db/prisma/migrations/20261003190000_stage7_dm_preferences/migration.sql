-- Stage 7: which direct messages a player switched off (PLAN §5.6).
-- Kinds are listed in packages/core/src/notifications.ts; an empty list means «send everything».

ALTER TABLE "users"
  ADD COLUMN "dm_muted" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
