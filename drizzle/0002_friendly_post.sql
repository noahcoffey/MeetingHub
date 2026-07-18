CREATE TABLE IF NOT EXISTS "hidden_meeting_titles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hidden_meeting_titles_title_unique" UNIQUE("title")
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "skipped" boolean DEFAULT false NOT NULL;