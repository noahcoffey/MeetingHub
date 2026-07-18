CREATE TYPE "public"."recurrence_unit" AS ENUM('day', 'weekday', 'week', 'month', 'year');--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN "recurrence_unit" "recurrence_unit";--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN "recurrence_interval" integer;