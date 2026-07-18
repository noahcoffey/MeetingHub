-- Custom SQL migration file, put your code below! --
-- Backfill completed_at for already-done tasks so reports have history.
-- updated_at is the best available proxy for when they were marked done.
UPDATE "action_items"
SET "completed_at" = "updated_at"
WHERE "status" = 'done' AND "completed_at" IS NULL;