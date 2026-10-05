-- «Я оплатил»: the fined person reports the payment with a screenshot, the staff confirms it.
CREATE TABLE "fine_payment_claims" (
    "id" TEXT NOT NULL,
    "fine_id" TEXT NOT NULL,
    "claimant_discord_id" TEXT NOT NULL,
    "comment" TEXT,
    "evidence_file_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decision" "DecisionStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_discord_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "review_channel_id" TEXT,
    "review_message_id" TEXT,
    "review_buttons" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fine_payment_claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fine_payment_claims_fine_id_decision_idx" ON "fine_payment_claims"("fine_id", "decision");
CREATE INDEX "fine_payment_claims_decision_idx" ON "fine_payment_claims"("decision");

ALTER TABLE "fine_payment_claims" ADD CONSTRAINT "fine_payment_claims_fine_id_fkey" FOREIGN KEY ("fine_id") REFERENCES "fines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
