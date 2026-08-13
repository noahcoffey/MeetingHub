CREATE TYPE "public"."project_relation_kind" AS ENUM('related', 'blocks', 'depends_on', 'spun_from');--> statement-breakpoint
ALTER TYPE "public"."project_status" ADD VALUE 'parked';--> statement-breakpoint
CREATE TABLE "project_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"kind" "project_relation_kind" DEFAULT 'related' NOT NULL,
	"note" text,
	"created_in_meeting_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_relations_from_id_to_id_unique" UNIQUE("from_id","to_id")
);
--> statement-breakpoint
ALTER TABLE "project_relations" ADD CONSTRAINT "project_relations_from_id_projects_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_relations" ADD CONSTRAINT "project_relations_to_id_projects_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_relations" ADD CONSTRAINT "project_relations_created_in_meeting_id_meetings_id_fk" FOREIGN KEY ("created_in_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_relations_from_id_idx" ON "project_relations" USING btree ("from_id");--> statement-breakpoint
CREATE INDEX "project_relations_to_id_idx" ON "project_relations" USING btree ("to_id");