ALTER TABLE "notes" ADD COLUMN "share_slug" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_share_slug_unique" UNIQUE("share_slug");