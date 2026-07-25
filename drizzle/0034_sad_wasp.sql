ALTER TABLE "projects" ADD COLUMN "drive_folder_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "drive_folder_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "drive_files_folder_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "drive_projects_folder_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "drive_archived_folder_id" text;