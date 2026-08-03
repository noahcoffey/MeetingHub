CREATE TABLE "weekly_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"markdown" text NOT NULL,
	"model" text,
	"generated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_summaries_workspace_id_week_start_unique" UNIQUE("workspace_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "weekly_summaries" ADD CONSTRAINT "weekly_summaries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;