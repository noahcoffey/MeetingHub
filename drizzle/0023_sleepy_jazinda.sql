ALTER TABLE "hidden_meeting_titles" DROP CONSTRAINT "hidden_meeting_titles_title_unique";--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_entry_date_unique";--> statement-breakpoint
ALTER TABLE "meetings" DROP CONSTRAINT "meetings_calendar_event_id_unique";--> statement-breakpoint
ALTER TABLE "people" DROP CONSTRAINT "people_email_unique";--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "hidden_meeting_titles" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hidden_meeting_titles" ADD CONSTRAINT "hidden_meeting_titles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_items_workspace_id_idx" ON "action_items" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "meetings_workspace_id_idx" ON "meetings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "notes_workspace_id_idx" ON "notes" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "people_workspace_id_idx" ON "people" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "projects_workspace_id_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "hidden_meeting_titles" ADD CONSTRAINT "hidden_meeting_titles_workspace_id_title_unique" UNIQUE("workspace_id","title");--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_workspace_id_entry_date_unique" UNIQUE("workspace_id","entry_date");--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspace_id_calendar_event_id_unique" UNIQUE("workspace_id","calendar_event_id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_workspace_id_email_unique" UNIQUE("workspace_id","email");