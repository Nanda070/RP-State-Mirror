-- Legacy slash-command field parity (documents / responses / wanted / fines)

ALTER TABLE "documents" ADD COLUMN "notified_person" TEXT NOT NULL DEFAULT '';
ALTER TABLE "documents" ADD COLUMN "forum_link" TEXT NOT NULL DEFAULT '';
ALTER TABLE "documents" ADD COLUMN "leader_text" TEXT NOT NULL DEFAULT '';
ALTER TABLE "documents" ADD COLUMN "deputy_text" TEXT NOT NULL DEFAULT '';
ALTER TABLE "documents" ALTER COLUMN "notified_person" DROP DEFAULT;
ALTER TABLE "documents" ALTER COLUMN "forum_link" DROP DEFAULT;
ALTER TABLE "documents" ALTER COLUMN "leader_text" DROP DEFAULT;
ALTER TABLE "documents" ALTER COLUMN "deputy_text" DROP DEFAULT;

ALTER TABLE "document_responses" ADD COLUMN "personal_file" TEXT NOT NULL DEFAULT '';
ALTER TABLE "document_responses" ADD COLUMN "video" TEXT NOT NULL DEFAULT '';
ALTER TABLE "document_responses" ALTER COLUMN "personal_file" DROP DEFAULT;
ALTER TABLE "document_responses" ALTER COLUMN "video" DROP DEFAULT;

ALTER TABLE "wanteds" ADD COLUMN "term_text" TEXT NOT NULL DEFAULT '';
ALTER TABLE "wanteds" ADD COLUMN "forum_link" TEXT NOT NULL DEFAULT '';
ALTER TABLE "wanteds" ALTER COLUMN "term_text" DROP DEFAULT;
ALTER TABLE "wanteds" ALTER COLUMN "forum_link" DROP DEFAULT;

ALTER TABLE "fines" ADD COLUMN "payment_deadline_text" TEXT NOT NULL DEFAULT '';
ALTER TABLE "fines" ADD COLUMN "overdue_notified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "fines" ALTER COLUMN "payment_deadline_text" DROP DEFAULT;
