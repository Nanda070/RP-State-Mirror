-- Stage 8: public spreadsheets (PLAN §17). A table is a workbook snapshot in the editor's own
-- format; revisions keep earlier snapshots; images inserted into a table are media files tied to it.

CREATE TABLE "sheet_documents" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "snapshot" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lock_discord_id" TEXT,
    "lock_expires_at" TIMESTAMP(3),
    "created_by_discord_id" TEXT NOT NULL,
    "updated_by_discord_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sheet_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sheet_documents_status_sort_order_idx" ON "sheet_documents"("status", "sort_order");
CREATE INDEX "sheet_documents_slug_idx" ON "sheet_documents"("slug");
-- An archived table frees its address for a new one.
CREATE UNIQUE INDEX "sheet_documents_slug_active_key" ON "sheet_documents"("slug") WHERE "status" = 'ACTIVE';

CREATE TABLE "sheet_revisions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_discord_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sheet_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sheet_revisions_document_id_created_at_idx" ON "sheet_revisions"("document_id", "created_at");

ALTER TABLE "sheet_revisions"
  ADD CONSTRAINT "sheet_revisions_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "sheet_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "sheet_images" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "media_file_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sheet_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sheet_images_media_file_id_key" ON "sheet_images"("media_file_id");
CREATE INDEX "sheet_images_document_id_idx" ON "sheet_images"("document_id");

ALTER TABLE "sheet_images"
  ADD CONSTRAINT "sheet_images_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "sheet_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
