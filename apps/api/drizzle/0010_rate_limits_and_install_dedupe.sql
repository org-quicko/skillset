CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "resource_install_events" ADD COLUMN "client_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_install_events_dedupe_idx" ON "resource_install_events" USING btree ("resource_id","client_fingerprint",(("created_at" AT TIME ZONE 'UTC')::date));