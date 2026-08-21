CREATE TABLE IF NOT EXISTS "skills" (
	"name" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"published_by" uuid,
	"published_by_email" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || coalesce(description, ''))) STORED,
	CONSTRAINT "skills_name_format" CHECK ("skills"."name" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("skills"."name") <= 64)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "skills" ADD CONSTRAINT "skills_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skills_search_idx" ON "skills" USING gin ("search");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skills_published_at_idx" ON "skills" USING btree ("published_at" DESC NULLS LAST);