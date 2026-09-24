import { describe, expect, it } from "bun:test";
import { readDbSchema } from "./schemaName.js";

describe("readDbSchema", () => {
  it("falls back to public when DB_SCHEMA is unset, blank, or whitespace", () => {
    expect(readDbSchema(undefined)).toBe("public");
    expect(readDbSchema("")).toBe("public");
    expect(readDbSchema("   ")).toBe("public");
  });

  it("trims the name it is given", () => {
    expect(readDbSchema(" acme ")).toBe("acme");
  });

  it("refuses anything that is not a plain lower-case identifier", () => {
    expect(() => readDbSchema("Registry")).toThrow(/not a plain lower-case Postgres identifier/);
    expect(() => readDbSchema('acme"; drop schema public cascade; --')).toThrow(/not a plain lower-case/);
    expect(() => readDbSchema("a".repeat(64))).toThrow(/at most 63 characters/);
  });

  it("refuses the pg_ prefix Postgres reserves", () => {
    expect(() => readDbSchema("pg_temp")).toThrow(/reserved "pg_" prefix/);
  });
});
