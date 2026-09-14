CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"source" text NOT NULL,
	"mcp_client_id" text,
	"mcp_token_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"args" jsonb,
	"outcome" text NOT NULL,
	"error" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_created_at_idx" ON "admin_audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_target_idx" ON "admin_audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_actor_created_at_idx" ON "admin_audit_log" USING btree ("actor_user_id","created_at" DESC NULLS LAST);
