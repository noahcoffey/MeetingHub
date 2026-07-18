CREATE TABLE IF NOT EXISTS "pending_ingests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"title" text NOT NULL,
	"start_time" timestamp with time zone,
	"notes_generated" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_ingests_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "notes_generated" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "notes_generated_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "external_ref" text;