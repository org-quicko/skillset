ALTER TABLE "tokens" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "skills" DROP CONSTRAINT "skills_pkey";--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_name_unique" UNIQUE("name");
