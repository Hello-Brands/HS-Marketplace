CREATE TABLE "saved_competitors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"place_id" text NOT NULL,
	"brand_name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" varchar(2) NOT NULL,
	"lat" numeric(10, 7) NOT NULL,
	"lng" numeric(10, 7) NOT NULL,
	"business_status" text NOT NULL,
	"maps_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_competitors" ADD CONSTRAINT "saved_competitors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_competitors_user_place_idx" ON "saved_competitors" USING btree ("user_id","place_id");
