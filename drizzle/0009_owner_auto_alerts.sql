ALTER TABLE "alerts" ADD COLUMN "origin" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "owner_identifier" text;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "owner_location_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "owner_alerts_choice" text;
