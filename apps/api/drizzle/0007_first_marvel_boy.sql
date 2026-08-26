CREATE TYPE "public"."skill_install_source" AS ENUM('web', 'cli');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "skill_install_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"skill_id" uuid NOT NULL,
	"source" "skill_install_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "skill_install_events" ADD CONSTRAINT "skill_install_events_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_install_events_skill_id_idx" ON "skill_install_events" USING btree ("skill_id");--> statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS "skill_analytics" AS
  SELECT "skill_id", count(*)::integer AS "install_count"
  FROM "skill_install_events"
  GROUP BY "skill_id";