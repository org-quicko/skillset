import { describe, expect, it } from "bun:test";
import { getMaterializedViewConfig, getTableConfig, getViewConfig, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createSchemaBuilders } from "./schemaFactory.js";
import { readDbSchema } from "./schemaName.js";

const columns = {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
};

describe("readDbSchema", () => {
  it("falls back to public when DB_SCHEMA is unset, blank, or whitespace", () => {
    expect(readDbSchema(undefined)).toBe("public");
    expect(readDbSchema("")).toBe("public");
    expect(readDbSchema("   ")).toBe("public");
  });

  it("trims the name it is given", () => {
    expect(readDbSchema(" acme ")).toBe("acme");
  });

  it("refuses anything that is not a plain lower-case identifier, since it is spliced into SQL", () => {
    expect(() => readDbSchema("Registry")).toThrow(/not a plain lower-case Postgres identifier/);
    expect(() => readDbSchema('acme"; drop schema public cascade; --')).toThrow(/not a plain lower-case/);
    expect(() => readDbSchema("a".repeat(64))).toThrow(/at most 63 characters/);
  });

  it("refuses the pg_ prefix Postgres reserves", () => {
    expect(() => readDbSchema("pg_temp")).toThrow(/reserved "pg_" prefix/);
  });
});

describe("createSchemaBuilders", () => {
  it("leaves a table unqualified on public, so no schema is written into the SQL", () => {
    const table = createSchemaBuilders("public").table("users", columns);

    expect(getTableConfig(table).schema).toBeUndefined();
  });

  it("qualifies a table with any other schema", () => {
    const table = createSchemaBuilders("acme").table("users", columns);

    expect(getTableConfig(table).schema).toBe("acme");
  });

  it("keeps the table name and its columns identical across schemas", () => {
    const onPublic = getTableConfig(createSchemaBuilders("public").table("users", columns));
    const onAcme = getTableConfig(createSchemaBuilders("acme").table("users", columns));

    expect(onAcme.name).toBe(onPublic.name);
    expect(onAcme.columns.map((column) => column.name)).toEqual(onPublic.columns.map((column) => column.name));
  });

  it("passes the third argument through to Drizzle", () => {
    const table = createSchemaBuilders("acme").table("users", columns, (self) => [
      uniqueIndex("users_email_index").on(self.email),
    ]);

    expect(getTableConfig(table).indexes.map((index) => index.config.name)).toEqual(["users_email_index"]);
  });

  it("moves enums and views with the tables, so nothing is left behind in public", () => {
    const builders = createSchemaBuilders("acme");

    const role = builders.enum("user_role", ["reader", "writer"]);
    const view = builders.view("resource_directory", { id: uuid("id") }).as(sql`select id from users`);
    const materialized = builders
      .materializedView("resource_analytics", { id: uuid("id") })
      .as(sql`select id from users`);

    expect(role.schema).toBe("acme");
    expect(getViewConfig(view).schema).toBe("acme");
    expect(getMaterializedViewConfig(materialized).schema).toBe("acme");
  });

  it("leaves enums and views unqualified on public", () => {
    const builders = createSchemaBuilders("public");

    const view = builders.view("resource_directory", { id: uuid("id") }).as(sql`select id from users`);

    expect(builders.enum("user_role", ["reader", "writer"]).schema).toBeUndefined();
    expect(getViewConfig(view).schema).toBeUndefined();
  });
});
