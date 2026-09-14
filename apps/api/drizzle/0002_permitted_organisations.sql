-- `permitted_organisation` (one, required to enable) becomes
-- `permitted_organisations` (many, and allowed to be empty) — ADR-0021.
--
-- The existing value is carried across rather than dropped: an operator who
-- had a gate configured must not silently end up with none, which is exactly
-- what a plain drop-and-add would have done.
ALTER TABLE "identity_providers" DROP CONSTRAINT IF EXISTS "identity_providers_enabled_requires_organisation";--> statement-breakpoint
ALTER TABLE "identity_providers" ADD COLUMN "permitted_organisations" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
UPDATE "identity_providers" SET "permitted_organisations" = ARRAY["permitted_organisation"] WHERE "permitted_organisation" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_providers" DROP COLUMN "permitted_organisation";
