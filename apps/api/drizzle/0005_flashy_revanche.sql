CREATE TABLE IF NOT EXISTS "skill_tags" (
	"skill_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "skill_tags_skill_id_tag_id_pk" PRIMARY KEY("skill_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name"),
	CONSTRAINT "tags_name_format" CHECK ("tags"."name" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("tags"."name") <= 32)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "skill_tags" ADD CONSTRAINT "skill_tags_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "skill_tags" ADD CONSTRAINT "skill_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_tags_tag_id_idx" ON "skill_tags" USING btree ("tag_id");--> statement-breakpoint
ALTER TABLE "skills" DROP COLUMN IF EXISTS "tags";