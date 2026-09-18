CREATE TYPE "public"."ingest_outcome" AS ENUM('matched_written', 'matched_not_written', 'pending');--> statement-breakpoint
CREATE TABLE "ingest_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"title" text,
	"start_time" timestamp with time zone,
	"workspace_hint" text,
	"workspace_id" uuid,
	"notes_generated" text NOT NULL,
	"outcome" "ingest_outcome" NOT NULL,
	"matched_meeting_id" uuid,
	"meeting_id" uuid,
	"reassigned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingest_events" ADD CONSTRAINT "ingest_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_events" ADD CONSTRAINT "ingest_events_matched_meeting_id_meetings_id_fk" FOREIGN KEY ("matched_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_events" ADD CONSTRAINT "ingest_events_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_events_created_at_idx" ON "ingest_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ingest_events_source_id_idx" ON "ingest_events" USING btree ("source_id");