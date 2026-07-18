-- Migrate the fixed journal meta columns (productivity, anxiety, wins, learnings)
-- into user-definable journal_stats + journal_stat_values. Idempotent: seeds the
-- four defaults only for workspaces that have no stats yet, and backfills values
-- with ON CONFLICT DO NOTHING so re-runs / prod-drift are safe. The old columns
-- are dropped in the next migration, after this backfill.

-- 1. Seed the four default stats per workspace (skip any workspace that already
--    has stats, so we never clobber a customized set). Anxiety is seeded archived
--    if the legacy "hide anxiety" advanced toggle was on.
INSERT INTO "journal_stats"
  ("workspace_id", "name", "type", "direction", "config", "show_on_dashboard", "sort_order", "archived_at")
SELECT
  w.id,
  s.name,
  s.type::"journal_stat_type",
  s.direction::"journal_stat_direction",
  s.config::jsonb,
  s.show_on_dashboard,
  s.sort_order,
  CASE
    WHEN s.name = 'Anxiety'
      AND EXISTS (SELECT 1 FROM "app_settings" a WHERE a.key = 'hide_anxiety' AND a.value = '1')
    THEN now()
    ELSE NULL
  END
FROM "workspaces" w
CROSS JOIN (VALUES
  ('Productivity', 'scale',   'good',    '{"labels":["Very low","Low","Moderate","High","Very high"]}', true,  0),
  ('Anxiety',      'scale',   'bad',     '{"labels":["Calm","Mild","Moderate","High","Severe"]}',        true,  1),
  ('Wins',         'text',    'neutral', '{"placeholder":"What did you achieve today?"}',                 false, 2),
  ('Learnings',    'text',    'neutral', '{"placeholder":"What did you learn today?"}',                   false, 3)
) AS s(name, type, direction, config, show_on_dashboard, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "journal_stats" js WHERE js.workspace_id = w.id);
--> statement-breakpoint

-- 2. Backfill scale values (productivity, anxiety) into num_value.
INSERT INTO "journal_stat_values" ("journal_entry_id", "stat_id", "num_value")
SELECT e.id, js.id, e."productivity"
FROM "journal_entries" e
JOIN "journal_stats" js
  ON js.workspace_id = e.workspace_id AND js.name = 'Productivity' AND js.type = 'scale'
WHERE e."productivity" IS NOT NULL
ON CONFLICT ("journal_entry_id", "stat_id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "journal_stat_values" ("journal_entry_id", "stat_id", "num_value")
SELECT e.id, js.id, e."anxiety"
FROM "journal_entries" e
JOIN "journal_stats" js
  ON js.workspace_id = e.workspace_id AND js.name = 'Anxiety' AND js.type = 'scale'
WHERE e."anxiety" IS NOT NULL
ON CONFLICT ("journal_entry_id", "stat_id") DO NOTHING;
--> statement-breakpoint

-- 3. Backfill text values (wins, learnings) into text_value.
INSERT INTO "journal_stat_values" ("journal_entry_id", "stat_id", "text_value")
SELECT e.id, js.id, e."wins"
FROM "journal_entries" e
JOIN "journal_stats" js
  ON js.workspace_id = e.workspace_id AND js.name = 'Wins' AND js.type = 'text'
WHERE coalesce(e."wins", '') <> ''
ON CONFLICT ("journal_entry_id", "stat_id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "journal_stat_values" ("journal_entry_id", "stat_id", "text_value")
SELECT e.id, js.id, e."learnings"
FROM "journal_entries" e
JOIN "journal_stats" js
  ON js.workspace_id = e.workspace_id AND js.name = 'Learnings' AND js.type = 'text'
WHERE coalesce(e."learnings", '') <> ''
ON CONFLICT ("journal_entry_id", "stat_id") DO NOTHING;
