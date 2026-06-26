CREATE TABLE "competitor_opportunities" (
	"google_place_id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"brand_name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" varchar(2) NOT NULL,
	"lat" numeric(10, 7) NOT NULL,
	"lng" numeric(10, 7) NOT NULL,
	"business_status" text NOT NULL,
	"closed_at" timestamp with time zone,
	"nearest_hs_name" text,
	"nearest_hs_miles" numeric(6, 2),
	"is_opportunity" boolean DEFAULT false NOT NULL,
	"maps_url" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "competitor_opportunities_geo_idx" ON "competitor_opportunities" USING btree ("lat","lng");
