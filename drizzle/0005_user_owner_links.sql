CREATE TABLE "user_owner_links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"owner_identifier" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"actor_user_id" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_owner_links" ADD CONSTRAINT "user_owner_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_owner_links" ADD CONSTRAINT "user_owner_links_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_owner_links_user_owner_idx" ON "user_owner_links" USING btree ("user_id","owner_identifier");--> statement-breakpoint
CREATE INDEX "user_owner_links_user_idx" ON "user_owner_links" USING btree ("user_id");
