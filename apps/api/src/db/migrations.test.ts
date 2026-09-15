import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { MIGRATION_SCHEMA_SENTINEL } from "./schemaName.js";

const MIGRATIONS_FOLDER = join(import.meta.dir, "../../drizzle");

// Everything that names an object the migration creates or alters. An index
// names itself unqualified and its table after `ON`, which is why it is
// matched separately — a bare `ON` also introduces a join condition.
const DECLARATIONS =
  /(CREATE (?:OR REPLACE )?(?:MATERIALIZED )?(?:TABLE|TYPE|VIEW)(?: IF NOT EXISTS)?|ALTER TABLE(?: ONLY)?|REFERENCES)\s+"([^"]+)"(\.")?/g;
const INDEX_TARGETS = /CREATE (?:UNIQUE )?INDEX\s+"[^"]+"\s+ON\s+"([^"]+)"(\.")?/g;

async function migrationFiles(): Promise<Array<{ name: string; sql: string }>> {
  const names = (await readdir(MIGRATIONS_FOLDER)).filter((name) => name.endsWith(".sql"));
  return Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(join(MIGRATIONS_FOLDER, name), "utf8") })),
  );
}

// The shipped SQL is a template, not a migration for one schema. A file that
// names a real schema places its objects somewhere the application never
// looks, and the failure is silent until a query misses — so it is caught
// here instead. `bun run db:generate` gets this right on its own (see
// drizzle.config.ts); SQL written by hand is where it is lost.
describe("the generated migrations", () => {
  it("are schema templates, carrying the sentinel rather than a real name", async () => {
    const files = await migrationFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const { name, sql } of files) {
      expect(sql, `${name} names no schema at all`).toContain(MIGRATION_SCHEMA_SENTINEL);
    }
  });

  it("never name `public`, the schema drizzle-kit writes when DB_SCHEMA is unset", async () => {
    for (const { name, sql } of await migrationFiles()) {
      expect(sql, `${name} was generated against a real schema`).not.toContain(`"public".`);
    }
  });

  it("qualify every object they touch, so none can land outside the schema", async () => {
    for (const { name, sql } of await migrationFiles()) {
      const targets = [
        ...[...sql.matchAll(DECLARATIONS)].map(([statement, , identifier, qualified]) => ({
          statement,
          identifier,
          qualified,
        })),
        ...[...sql.matchAll(INDEX_TARGETS)].map(([statement, identifier, qualified]) => ({
          statement,
          identifier,
          qualified,
        })),
      ];
      expect(targets.length, `${name} declares nothing`).toBeGreaterThan(0);

      for (const { statement, identifier, qualified } of targets) {
        expect(qualified, `${name}: unqualified object in ${statement.trim()}`).toBeDefined();
        expect(identifier, `${name}: ${statement.trim()} names a real schema`).toBe(
          MIGRATION_SCHEMA_SENTINEL,
        );
      }
    }
  });
});
