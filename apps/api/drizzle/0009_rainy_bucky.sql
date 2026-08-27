CREATE TYPE "public"."identity_provider_kind" AS ENUM('google', 'microsoft');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "identity_providers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"kind" "identity_provider_kind" NOT NULL,
	"display_name" text NOT NULL,
	"issuer_url" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"permitted_domain" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_providers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "identity_providers_enabled_requires_domain" CHECK (NOT "identity_providers"."enabled" OR "identity_providers"."permitted_domain" IS NOT NULL)
);
