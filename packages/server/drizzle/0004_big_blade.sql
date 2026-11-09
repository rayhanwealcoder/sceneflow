CREATE TABLE "analytics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer,
	"session_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"t" double precision,
	"scene_id" text,
	"layer_id" text,
	"product_id" text,
	"host" text,
	"path" text,
	"device" text,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_project_time_idx" ON "analytics_events" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_project_type_idx" ON "analytics_events" USING btree ("project_id","type","occurred_at");