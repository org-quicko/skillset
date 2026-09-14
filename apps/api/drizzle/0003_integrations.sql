-- The Registry's registration with a Git Provider (ADR-0024). Holds the
-- credential pair a Connection is granted against, one row per provider.
--
-- Deliberately not a column on `identity_providers`: signing in with GitHub
-- and Importing from GitHub are two separate registrations that share nothing
-- but a vendor. A row's existence is the only switch Importing has.
CREATE TABLE IF NOT EXISTS "integrations" (
	"provider" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"app_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
