-- AlterTable
ALTER TABLE "role_mappings" ADD COLUMN "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "role_mappings_status_idx" ON "role_mappings"("status");
