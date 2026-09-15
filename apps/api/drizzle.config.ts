import { defineConfig } from "drizzle-kit";
import { MIGRATION_SCHEMA_SENTINEL } from "./src/db/schemaName.js";

// Set before drizzle-kit loads ./src/db/schemas — which reaches
// src/db/schemaFactory.ts, and that reads DB_SCHEMA at module load — so a
// generated migration always carries the sentinel and never whichever schema
// the environment running `db:generate` happened to name. Imported from
// schemaName.ts rather than schemaFactory.ts precisely because that module
// has no side effects: importing the factory here would bind its schema
// before this line ran.
process.env.DB_SCHEMA = MIGRATION_SCHEMA_SENTINEL;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing required environment variable DATABASE_URL.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schemas/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
});
