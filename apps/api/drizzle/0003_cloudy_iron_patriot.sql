ALTER TABLE "skills" ADD COLUMN "license" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "compatibility" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "allowed_tools" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "tags" text[];