import { createDatabase } from "../../db/client.js";
import { createLogger } from "../../lib/logger.js";
import { createAuth } from "./instance.js";

// Exists only so `@better-auth/cli generate` has an `auth` export to read the
// models off — see src/db/schemas/README.md. Nothing in the running app imports
// this. The CLI never issues a query and never verifies a token, so the
// connection string and secret below only have to satisfy validation.

const { db } = createDatabase("postgres://postgres:postgres@localhost:5432/skill_registry");

export const auth = createAuth(
  {
    db,
    secret: "codegen-only-secret-codegen-only-secret",
    publicUrl: "http://localhost:3000",
    logger: createLogger("silent"),
  },
  [],
);
