-- Custom SQL migration file, put your code below! --
-- Rescale productivity/anxiety from the old 1–10 scale to the new 1–5 labeled scale.
-- ceil(v/2) maps pairs evenly: 1,2->1  3,4->2  5,6->3  7,8->4  9,10->5.
-- Runs once (drizzle tracks applied migrations), so it rescales every value.
UPDATE "journal_entries"
SET "productivity" = CEIL("productivity" / 2.0)::int
WHERE "productivity" IS NOT NULL;
UPDATE "journal_entries"
SET "anxiety" = CEIL("anxiety" / 2.0)::int
WHERE "anxiety" IS NOT NULL;