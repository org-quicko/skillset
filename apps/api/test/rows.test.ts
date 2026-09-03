import { describe, expect, it } from "bun:test";
import { firstRow } from "../src/db/rows.js";

describe("firstRow", () => {
  it("returns the row a write produced", () => {
    expect(firstRow([{ id: "1" }], "Token insert")).toEqual({ id: "1" });
  });

  it("returns the first row when a write produced several", () => {
    expect(firstRow([{ id: "1" }, { id: "2" }], "Token insert")).toEqual({ id: "1" });
  });

  // Reaching this means a statement that must have written a row did not,
  // which is a bug: a plain Error, so the central handler answers 500 rather
  // than reporting it to a caller as a refusal they could act on.
  it("throws, naming the statement, when a write produced nothing", () => {
    expect(() => firstRow([], "Token insert")).toThrow("Token insert did not return a row.");
  });
});
