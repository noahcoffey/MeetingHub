CREATE TABLE IF NOT EXISTS "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_date" date NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"notes_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"productivity" integer,
	"anxiety" integer,
	"wins" text,
	"learnings" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_entry_date_unique" UNIQUE("entry_date")
);
--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN "journal_entry_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "action_items" ADD CONSTRAINT "action_items_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
