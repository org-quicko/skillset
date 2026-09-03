import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../src/auth/middleware.js";
import { parseBody, parseValue, readJsonObject } from "../src/http/body.js";
import { registerErrorHandler } from "../src/http/errors.js";
import { createLogger } from "../src/logger.js";

const Input = z.object({ name: z.string(), age: z.number().int() });

interface Refusal {
  error: { code: string; message: string; field?: string };
}

/**
 * The three helpers behind a real request, with the API's own error handler
 * mounted — so a refusal is asserted as the 400 a caller receives.
 *
 * No database, no container: the body is the whole input.
 */
const app = new Hono<{ Variables: AuthVariables }>();
registerErrorHandler(app, createLogger("silent"));
app.post("/strict", async (c) => c.json(await parseBody(c, Input)));
app.post("/sentence", async (c) => c.json(await parseBody(c, Input, "name and age are required.")));
app.post("/loose", async (c) => c.json(await readJsonObject(c)));

/** Posts a body exactly as given, including bodies no JSON encoder would produce. */
async function post(path: string, body: string | null): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("parseValue", () => {
  it("returns the parsed value", () => {
    expect(parseValue({ name: "ada", age: 36 }, Input)).toEqual({ name: "ada", age: 36 });
  });

  it("names the failing member as the field", () => {
    expect(() => parseValue({ name: "ada", age: "thirty-six" }, Input)).toThrow(
      expect.objectContaining({ field: "age" }),
    );
  });

  it("prefers a supplied sentence over the schema's own", () => {
    expect(() => parseValue({}, Input, "name and age are required.")).toThrow("name and age are required.");
  });

  // A refinement over the whole object has no path to report, and must not
  // report the empty string as if it were a field name.
  it("reports no field when the failing issue has no path", () => {
    const AtLeastOne = z.object({ a: z.string().optional() }).refine((value) => value.a !== undefined, "Give me an a.");

    expect(() => parseValue({}, AtLeastOne)).toThrow(expect.objectContaining({ field: undefined }));
  });
});

describe("parseBody", () => {
  it("parses a well-formed body", async () => {
    const res = await post("/strict", JSON.stringify({ name: "ada", age: 36 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "ada", age: 36 });
  });

  it("refuses a body of the wrong shape, naming the field", async () => {
    const res = await post("/strict", JSON.stringify({ name: "ada" }));
    const body = (await res.json()) as Refusal;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.field).toBe("age");
  });

  // A malformed request and a well-formed one of the wrong shape are the same
  // 400: the distinction is not one a caller can act on differently.
  it.each([
    ["unparseable", "{not json at all"],
    ["absent", null],
    ["an array", "[]"],
    ["a bare string", '"ada"'],
  ])("refuses a %s body", async (_case, body) => {
    const res = await post("/strict", body);

    expect(res.status).toBe(400);
    expect(((await res.json()) as Refusal).error.code).toBe("validation_failed");
  });

  it("reports the route's own sentence when it passed one", async () => {
    const res = await post("/sentence", "{}");

    expect(((await res.json()) as Refusal).error.message).toBe("name and age are required.");
  });
});

describe("readJsonObject", () => {
  it("passes an object's members through unvalidated", async () => {
    const res = await post("/loose", JSON.stringify({ tags: ["a", "b"], extra: 1 }));

    expect(await res.json()).toEqual({ tags: ["a", "b"], extra: 1 });
  });

  // Anything that is not a JSON object reads as empty, so a member lookup
  // yields undefined and the service refuses it as missing — the same outcome
  // as a body that parsed but omitted the field.
  it.each([
    ["unparseable", "{not json at all"],
    ["absent", null],
    ["an array", "[]"],
    ["a bare string", '"ada"'],
    ["null", "null"],
  ])("reads a %s body as empty", async (_case, body) => {
    const res = await post("/loose", body);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });
});
