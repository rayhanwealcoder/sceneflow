CREATE TABLE "shop_orders" (
	"site_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"line_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" text,
	"product_id" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"revenue" double precision DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_orders_site_id_line_id_pk" PRIMARY KEY("site_id","line_id")
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "orders_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "orders_cursor" bigint;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_orders_project_paid_idx" ON "shop_orders" USING btree ("project_id","paid_at");