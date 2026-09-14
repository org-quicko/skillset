-- A writer's own grant of repository access (ADR-0024). Its existence is the
-- consent; nothing else records it.
--
-- `provider` references `integrations` under RESTRICT rather than carrying a
-- free string: a Connection cannot name a provider this Registry has not
-- registered, and removing an Integration that writers still hold Connections
-- against fails loudly instead of dropping their credentials.
--
-- `access_token` and `refresh_token` hold ciphertext, not tokens.
-- `expires_at` null means the access token does not expire, which is what a
-- GitHub App with expiry switched off issues.
CREATE TABLE IF NOT EXISTS "connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"external_account_login" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_user_id_provider_key" UNIQUE("user_id","provider")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connections" ADD CONSTRAINT "connections_provider_integrations_provider_fk" FOREIGN KEY ("provider") REFERENCES "public"."integrations"("provider") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
