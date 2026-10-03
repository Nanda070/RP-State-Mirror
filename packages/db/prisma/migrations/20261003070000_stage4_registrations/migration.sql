-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "plate" TEXT,
ADD COLUMN     "review_thread_id" TEXT;

-- CreateTable
CREATE TABLE "vehicle_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "year" INTEGER,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_models_name_key" ON "vehicle_models"("name");

-- CreateIndex
CREATE INDEX "vehicle_models_status_name_idx" ON "vehicle_models"("status", "name");

-- CreateIndex
CREATE INDEX "registrations_status_expires_at_idx" ON "registrations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "registrations_plate_idx" ON "registrations"("plate");

-- One ACTIVE vehicle registration per plate (partial; not expressible in Prisma schema).
CREATE UNIQUE INDEX "registrations_plate_active_key" ON "registrations"("plate") WHERE "kind" = 'VEHICLE' AND "status" = 'ACTIVE';
