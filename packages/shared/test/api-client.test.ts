import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { ApiError, apiErrorFrom, parseApiResponse } from "../src/api-client.js";

/** A refused response carrying whatever body a test wants to put in front of the decoder. */
function refusal(status: number, body: unknown, contentType = "application/json"): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  });
}

describe("apiErrorFrom", () => {
  it("carries the API's own code, message, field, and status", async () => {
    const error = await apiErrorFrom(
      refusal(409, { error: { code: "email_taken", message: "A User with that email already exists.", field: "email" } }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("email_taken");
    expect(error.message).toBe("A User with that email already exists.");
    expect(error.field).toBe("email");
  });

  it("leaves field undefined when the API named none", async () => {
    const error = await apiErrorFrom(refusal(404, { error: { code: "not_found", message: "No Skill by that id." } }));

    expect(error.code).toBe("not_found");
    expect(error.field).toBeUndefined();
  });

  // A proxy's HTML error page, or an empty 502, still has to produce an
  // ApiError — every caller's failure path is written against that one type.
  it("falls back to the status when the body is not the API's error shape", async () => {
    const error = await apiErrorFrom(refusal(502, "<html>Bad Gateway</html>", "text/html"));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe("unknown_error");
    expect(error.message).toBe("Request failed with status 502.");
  });

  it("falls back for a JSON body that is not an error envelope", async () => {
    const error = await apiErrorFrom(refusal(500, { oops: true }));

    expect(error.code).toBe("unknown_error");
    expect(error.status).toBe(500);
  });

  it("falls back for a body with no content at all", async () => {
    const error = await apiErrorFrom(new Response(null, { status: 503 }));

    expect(error.code).toBe("unknown_error");
    expect(error.status).toBe(503);
  });
});

describe("parseApiResponse", () => {
  const Skill = z.object({ name: z.string(), installs: z.number() });

  it("parses a success body against the schema", async () => {
    const body = new Response(JSON.stringify({ name: "code-review", installs: 4 }));

    expect(await parseApiResponse(body, Skill)).toEqual({ name: "code-review", installs: 4 });
  });

  // A 2xx of the wrong shape is a server fault worth surfacing, not one to
  // paper over with a partial object.
  it("throws when a 2xx body does not match the schema", async () => {
    const body = new Response(JSON.stringify({ name: "code-review" }));

    await expect(parseApiResponse(body, Skill)).rejects.toThrow();
  });

  it("returns undefined for a body-less response", async () => {
    expect(await parseApiResponse(new Response(null, { status: 204 }), null)).toBeUndefined();
  });

  // The 204 path must not touch the body: a `null` schema is the caller
  // saying there is nothing there to read.
  it("does not read the body when the schema is null", async () => {
    const response = new Response(null, { status: 204 });
    await parseApiResponse(response, null);

    expect(response.bodyUsed).toBe(false);
  });
});
