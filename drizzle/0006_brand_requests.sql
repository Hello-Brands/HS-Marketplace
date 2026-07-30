CREATE TABLE "brand_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_name" text NOT NULL,
	"website_url" text NOT NULL,
	"normalized_domain" text NOT NULL,
	"note" text,
	"known_city_state" text,
	"submitted_by" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"recon" jsonb,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"reject_reason" text,
	"brand_id" text,
	"pr_url" text,
	"issue_url" text,
	"locations_found" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitored_brands" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"locations_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "brand_requests" ADD CONSTRAINT "brand_requests_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "brand_requests" ADD CONSTRAINT "brand_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX "brand_requests_status_created_at_idx" ON "brand_requests" USING btree ("status","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "brand_requests_submitted_by_idx" ON "brand_requests" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "brand_requests_decided_by_idx" ON "brand_requests" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "brand_requests_normalized_domain_idx" ON "brand_requests" USING btree ("normalized_domain");
