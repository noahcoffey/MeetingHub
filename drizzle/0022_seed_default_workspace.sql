-- Seed the default workspace at a fixed id. All pre-workspace data is adopted
-- into it by the transitional column defaults added in 0023. Idempotent so
-- deploy re-runs and local/prod drift are safe.
INSERT INTO "workspaces" ("id", "name", "is_default", "sort_order")
VALUES ('00000000-0000-4000-8000-000000000001', 'Personal', true, 0)
ON CONFLICT ("id") DO NOTHING;
