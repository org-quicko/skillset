import { describe, expect, it } from "bun:test";
import { toEnvironmentVariables } from "../src/lib/mcp-env";

describe("toEnvironmentVariables", () => {
  it("keeps each row's required or optional choice, in order", () => {
    expect(
      toEnvironmentVariables(
        [
          { name: "API_KEY", required: true },
          { name: "REGION", required: false },
        ],
        [],
      ),
    ).toEqual([
      { name: "API_KEY", required: true },
      { name: "REGION", required: false },
    ]);
  });

  it("trims names and drops blank and repeated ones", () => {
    expect(
      toEnvironmentVariables(
        [
          { name: " API_KEY ", required: true },
          { name: "  ", required: true },
          { name: "API_KEY", required: false },
        ],
        [],
      ),
    ).toEqual([{ name: "API_KEY", required: true }]);
  });

  it("keeps an existing variable's description and default, but takes required from the row", () => {
    expect(
      toEnvironmentVariables(
        [{ name: "REGION", required: false }],
        [{ name: "REGION", required: true, description: "Where to look.", default: "eu" }],
      ),
    ).toEqual([{ name: "REGION", required: false, description: "Where to look.", default: "eu" }]);
  });

  it("is undefined when no row has a name", () => {
    expect(toEnvironmentVariables([{ name: "", required: true }], [])).toBeUndefined();
  });
});
