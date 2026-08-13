-- Hand-written (like 0004's pg_trgm): expresses invariants Drizzle's schema
-- builder can't, so they are NOT mirrored in schema.ts. Keep them here.
--
-- The lib layer already rejects self-edges and either-direction duplicates, but
-- two racing requests can both pass those checks before either inserts. These
-- put the one-edge-per-pair contract where it can't be raced.

-- A relation to itself is never meaningful.
ALTER TABLE "project_relations"
  ADD CONSTRAINT "project_relations_no_self_edge"
  CHECK ("from_id" <> "to_id");
--> statement-breakpoint
-- Direction-agnostic uniqueness: A→B and B→A are the same connection. The
-- existing (from_id, to_id) unique constraint only covers one direction.
CREATE UNIQUE INDEX "project_relations_pair_idx"
  ON "project_relations" (LEAST("from_id", "to_id"), GREATEST("from_id", "to_id"));
