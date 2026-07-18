-- Custom SQL migration file, put your code below! --
-- Trigram extension for fuzzy (typo/partial) matching in unified search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;