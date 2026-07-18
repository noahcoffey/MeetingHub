-- Custom SQL migration file, put your code below! --

-- Fold the old per-project running-log notes into the new first-class notes.
-- The old row id is reused as the note id so the copy is trivially verifiable.
-- Title = first line of content (trimmed, max 80 chars); if that's empty,
-- fall back to "Note from <created date>". Full content becomes the body.
INSERT INTO "notes" ("id", "title", "notes", "notes_updated_at", "created_at", "updated_at")
SELECT
  id,
  coalesce(
    nullif(left(btrim(split_part(content, E'\n', 1)), 80), ''),
    'Note from ' || to_char(created_at, 'FMMon FMDD, YYYY')
  ),
  content,
  updated_at,
  created_at,
  updated_at
FROM "project_notes";
--> statement-breakpoint
INSERT INTO "note_projects" ("note_id", "project_id", "created_at")
SELECT id, project_id, created_at FROM "project_notes";
