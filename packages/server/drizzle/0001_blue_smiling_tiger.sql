CREATE TABLE "placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"post_id" integer,
	"path" text,
	"page_url" text,
	"page_title" text,
	"selector" text NOT NULL,
	"mode" text DEFAULT 'replace' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "rest_base" text DEFAULT 'pretty' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "connector_version" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "platform_version" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "capabilities_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_publications" ADD CONSTRAINT "site_publications_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_publications" ADD CONSTRAINT "site_publications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "placements_project_idx" ON "placements" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "site_publications_project_idx" ON "site_publications" USING btree ("project_id","created_at");