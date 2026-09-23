-- Resources installed from a repository and put forward for the Registry,
-- waiting on an Admin (ADR-0044). Shaped like "resources" so approving one is
-- a column-for-column copy; unique on the same (kind, namespace, name) so a
-- resubmission replaces what was waiting rather than queueing a second copy.

CREATE TABLE "__db_schema__"."resource_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"namespace" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"body" text,
	"payload" jsonb NOT NULL,
	"source" text NOT NULL,
	"submitted_by" uuid,
	"submitted_by_email" text NOT NULL,
	"submitted_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_submissions_kind_namespace_name_unique" UNIQUE("kind","namespace","name")
);
--> statement-breakpoint
ALTER TABLE "__db_schema__"."resource_submissions" ADD CONSTRAINT "resource_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "__db_schema__"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "resource_submissions_created_at_idx" ON "__db_schema__"."resource_submissions" USING btree ("created_at" DESC NULLS LAST);
