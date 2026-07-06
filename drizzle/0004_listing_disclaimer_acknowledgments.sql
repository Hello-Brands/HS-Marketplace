CREATE TABLE "listing_disclaimer_acknowledgments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"fdd_version" text NOT NULL,
	"acknowledged_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_disclaimer_acknowledgments" ADD CONSTRAINT "listing_disclaimer_acknowledgments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX "listing_disclaimer_ack_user_id_idx" ON "listing_disclaimer_acknowledgments" USING btree ("user_id");
