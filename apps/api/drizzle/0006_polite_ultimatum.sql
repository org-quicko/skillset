-- Lets more than one Integration exist per Git Provider (ADR-0025), reversing
-- ADR-0024's "one row per provider" primary key. `integrations.id` is the
-- row's identity now; `connections.integration_id` records which app a grant
-- was issued through, replacing the old `connections.provider` foreign key.
--
-- The app is still under development, so existing Connections are cleared
-- rather than backfilled — writers reconnect and pick which app to use. This
-- also sidesteps giving `integration_id` a value for rows that predate it.
DELETE FROM "connections";
--> statement-breakpoint
ALTER TABLE "connections" DROP CONSTRAINT "connections_provider_integrations_provider_fk";
--> statement-breakpoint
ALTER TABLE "integrations" DROP CONSTRAINT "integrations_pkey";
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "integration_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connections" ADD CONSTRAINT "connections_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
