-- IC blacklist numbers (BL-001 …) come from a sequence, so two simultaneous entries cannot get
-- the same number. The sequence starts after the highest number already issued.
CREATE SEQUENCE "ic_blacklist_number_seq" AS BIGINT START WITH 1 INCREMENT BY 1;

SELECT setval(
  'ic_blacklist_number_seq',
  GREATEST((SELECT COALESCE(MAX(NULLIF(regexp_replace("number", '\D', '', 'g'), '')::BIGINT), 0) FROM "ic_blacklist"), 1),
  (SELECT COUNT(*) > 0 FROM "ic_blacklist")
);

-- Owned by the column: TRUNCATE … RESTART IDENTITY (used by tests) resets it together with the table.
ALTER SEQUENCE "ic_blacklist_number_seq" OWNED BY "ic_blacklist"."number";
