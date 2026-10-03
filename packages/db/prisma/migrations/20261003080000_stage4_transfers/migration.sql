-- CreateTable
CREATE TABLE "transfer_rank_rules" (
    "id" TEXT NOT NULL,
    "from_faction_code" TEXT NOT NULL,
    "to_faction_code" TEXT NOT NULL,
    "from_rank" INTEGER NOT NULL,
    "to_rank" INTEGER NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_rank_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfer_rank_rules_from_faction_code_to_faction_code_status_idx" ON "transfer_rank_rules"("from_faction_code", "to_faction_code", "status");

-- One ACTIVE mapping per (from faction, to faction, from rank); not expressible in Prisma schema.
CREATE UNIQUE INDEX "transfer_rank_rules_pair_from_rank_active_key"
  ON "transfer_rank_rules"("from_faction_code", "to_faction_code", "from_rank")
  WHERE "status" = 'ACTIVE';
