import { describe, expect, it } from "bun:test";
import { ApiError } from "../src/http.js";
import { describeError } from "../src/ui.js";

describe("describeError", () => {
  it("calls out a 5xx as a Registry-side fault rather than showing the generic message", () => {
    const result = describeError(new ApiError(500, "internal_error", "Something went wrong."));
    expect(result.title).toBe("The Registry hit an internal error (HTTP 500, internal_error).");
    expect(result.detail).toMatch(/fault on the Registry/);
  });

  it("shows a 4xx's message with its status and code", () => {
    const result = describeError(new ApiError(404, "not_found", "No Skill by that id."));
    expect(result).toEqual({ title: "No Skill by that id.", detail: "HTTP 404 · not_found" });
  });

  it("names the field a 4xx blamed", () => {
    expect(describeError(new ApiError(400, "name_invalid", "Bad name.", "name")).title).toBe("Bad name. (name)");
  });

  it("passes a plain Error's message through untouched", () => {
    expect(describeError(new Error("Not logged in."))).toEqual({ title: "Not logged in." });
  });

  it("stringifies a non-Error throw", () => {
    expect(describeError("boom")).toEqual({ title: "boom" });
  });
});
