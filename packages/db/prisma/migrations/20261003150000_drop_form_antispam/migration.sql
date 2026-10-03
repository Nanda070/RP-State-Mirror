-- Captcha, per-IP limit and IP bans were removed from public forms (decision of 2026-10-03).
-- With no limit and no ban there is no reason to keep visitors' addresses either.
DROP TABLE "form_ip_bans";

DROP INDEX "form_submissions_form_id_ip_address_created_at_idx";
ALTER TABLE "form_submissions" DROP COLUMN "ip_address";
ALTER TABLE "form_submissions" DROP COLUMN "user_agent";

ALTER TABLE "forms" DROP COLUMN "captcha_required";
ALTER TABLE "forms" DROP COLUMN "ip_limit_per_hour";
