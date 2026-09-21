CREATE TYPE "__db_schema__"."user_role" AS ENUM('reader', 'writer', 'admin', 'superadmin');--> statement-breakpoint
CREATE TYPE "__db_schema__"."identity_provider_kind" AS ENUM('google', 'microsoft', 'github');--> statement-breakpoint
CREATE TYPE "__db_schema__"."skill_install_source" AS ENUM('web', 'cli', 'mcp');--> statement-breakpoint
CREATE TABLE "__db_schema__"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "__db_schema__"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "__db_schema__"."users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"name" text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "__db_schema__"."user_role" NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "__db_schema__"."verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "__db_schema__"."connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"integration_id" uuid NOT NULL,
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
CREATE TABLE "__db_schema__"."identity_providers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" "__db_schema__"."identity_provider_kind" NOT NULL,
	"display_name" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"permitted_organisations" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_providers_kind_unique" UNIQUE("kind")
);
--> statement-breakpoint
CREATE TABLE "__db_schema__"."integrations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"app_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "__db_schema__"."rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "__db_schema__"."resources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"body" text,
	"payload" jsonb NOT NULL,
	"published_by" uuid,
	"published_by_email" text NOT NULL,
	"published_by_name" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || coalesce(description, '') || ' ' || published_by_name)) STORED,
	CONSTRAINT "resources_kind_name_unique" UNIQUE("kind","name")
);
--> statement-breakpoint
CREATE TABLE "__db_schema__"."resource_install_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"resource_id" uuid NOT NULL,
	"source" "__db_schema__"."skill_install_source" NOT NULL,
	"client_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "__db_schema__"."resource_tags" (
	"resource_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_tags_resource_id_tag_id_pk" PRIMARY KEY("resource_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "__db_schema__"."tags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name"),
	CONSTRAINT "tags_name_format" CHECK ("__db_schema__"."tags"."name" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("__db_schema__"."tags"."name") <= 32)
);
--> statement-breakpoint
CREATE TABLE "__db_schema__"."tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "__db_schema__"."accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "__db_schema__"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "__db_schema__"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "__db_schema__"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "__db_schema__"."connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "__db_schema__"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "__db_schema__"."connections" ADD CONSTRAINT "connections_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "__db_schema__"."integrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "__db_schema__"."resources" ADD CONSTRAINT "resources_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "__db_schema__"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "__db_schema__"."resource_install_events" ADD CONSTRAINT "resource_install_events_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "__db_schema__"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "__db_schema__"."resource_tags" ADD CONSTRAINT "resource_tags_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "__db_schema__"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "__db_schema__"."resource_tags" ADD CONSTRAINT "resource_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "__db_schema__"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "__db_schema__"."tokens" ADD CONSTRAINT "tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "__db_schema__"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "__db_schema__"."accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "__db_schema__"."accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "__db_schema__"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_role_superadmin_index" ON "__db_schema__"."users" USING btree ("role") WHERE "__db_schema__"."users"."role" = 'superadmin';--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "__db_schema__"."verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "resources_search_idx" ON "__db_schema__"."resources" USING gin ("search");--> statement-breakpoint
CREATE INDEX "resources_updated_at_idx" ON "__db_schema__"."resources" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "resource_install_events_resource_id_idx" ON "__db_schema__"."resource_install_events" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_install_events_dedupe_idx" ON "__db_schema__"."resource_install_events" USING btree ("resource_id","client_fingerprint",(("created_at" AT TIME ZONE 'UTC')::date));--> statement-breakpoint
CREATE INDEX "resource_tags_tag_id_idx" ON "__db_schema__"."resource_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_token_hash_idx" ON "__db_schema__"."tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "tokens_user_id_idx" ON "__db_schema__"."tokens" USING btree ("user_id");