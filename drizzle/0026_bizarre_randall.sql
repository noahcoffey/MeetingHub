ALTER TABLE "pending_ingests" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "pending_ingests" ADD COLUMN "workspace_hint" text;--> statement-breakpoint
ALTER TABLE "pending_ingests" ADD CONSTRAINT "pending_ingests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;