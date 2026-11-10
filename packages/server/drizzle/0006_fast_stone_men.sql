CREATE TABLE "video_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"requested_by" uuid,
	"requested_by_name" text NOT NULL,
	"source" text DEFAULT 'draft' NOT NULL,
	"version" integer NOT NULL,
	"checksum" text NOT NULL,
	"config_json" jsonb NOT NULL,
	"options_json" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress_json" jsonb,
	"storage_key" text,
	"file_name" text,
	"size_bytes" bigint,
	"duration_sec" double precision,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_exports" ADD CONSTRAINT "video_exports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_exports" ADD CONSTRAINT "video_exports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_exports" ADD CONSTRAINT "video_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_exports_project_idx" ON "video_exports" USING btree ("project_id","created_at");