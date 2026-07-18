CREATE TYPE "public"."journal_stat_direction" AS ENUM('good', 'bad', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."journal_stat_type" AS ENUM('scale', 'number', 'boolean', 'text');--> statement-breakpoint
CREATE TABLE "journal_stat_values" (
	"journal_entry_id" uuid NOT NULL,
	"stat_id" uuid NOT NULL,
	"num_value" real,
	"text_value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_stat_values_journal_entry_id_stat_id_pk" PRIMARY KEY("journal_entry_id","stat_id")
);
--> statement-breakpoint
CREATE TABLE "journal_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "journal_stat_type" NOT NULL,
	"direction" "journal_stat_direction" DEFAULT 'neutral' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"show_on_dashboard" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_stat_values" ADD CONSTRAINT "journal_stat_values_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_stat_values" ADD CONSTRAINT "journal_stat_values_stat_id_journal_stats_id_fk" FOREIGN KEY ("stat_id") REFERENCES "public"."journal_stats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_stats" ADD CONSTRAINT "journal_stats_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_stat_values_stat_id_idx" ON "journal_stat_values" USING btree ("stat_id");--> statement-breakpoint
CREATE INDEX "journal_stats_workspace_id_idx" ON "journal_stats" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_stats_workspace_name_active" ON "journal_stats" USING btree ("workspace_id",lower("name")) WHERE "journal_stats"."archived_at" IS NULL;