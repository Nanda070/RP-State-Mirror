-- Form answers that wait for a decision: «Одобрить / Отказать» under the answer in Discord.
ALTER TABLE "forms" ADD COLUMN "requires_decision" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "forms" ADD COLUMN "decider_role_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "forms" ADD COLUMN "approved_dm_text" TEXT;
ALTER TABLE "forms" ADD COLUMN "rejected_dm_text" TEXT;

-- NULL decision: the form asked for no decision when the answer came.
ALTER TABLE "form_submissions" ADD COLUMN "decision" "DecisionStatus";
ALTER TABLE "form_submissions" ADD COLUMN "decided_by_discord_id" TEXT;
ALTER TABLE "form_submissions" ADD COLUMN "decided_at" TIMESTAMP(3);
ALTER TABLE "form_submissions" ADD COLUMN "rejection_reason" TEXT;
ALTER TABLE "form_submissions" ADD COLUMN "review_channel_id" TEXT;
ALTER TABLE "form_submissions" ADD COLUMN "review_message_id" TEXT;
ALTER TABLE "form_submissions" ADD COLUMN "review_buttons" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX "form_submissions_decision_idx" ON "form_submissions"("decision");
