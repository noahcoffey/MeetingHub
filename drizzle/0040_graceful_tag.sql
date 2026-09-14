CREATE TABLE "day_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"day" date NOT NULL,
	"markdown" text NOT NULL,
	"markdown_edited" text,
	"model" text,
	"generated_at" timestamp with time zone NOT NULL,
	"input_fingerprint" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "day_summaries_workspace_id_day_unique" UNIQUE("workspace_id","day")
);
--> statement-breakpoint
ALTER TABLE "day_summaries" ADD CONSTRAINT "day_summaries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;