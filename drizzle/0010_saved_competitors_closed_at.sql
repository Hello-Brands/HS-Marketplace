ALTER TABLE "saved_competitors" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "saved_competitors" sc
  SET "closed_at" = co."closed_at"
  FROM "competitor_opportunities" co
  WHERE co."google_place_id" = sc."place_id";
