import { describe, expect, it } from "bun:test";
import { validateSkillName } from "@in-org-quicko/sqillset-shared";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, onError } from "./errors.js";
import { createLogger } from "./logger.js";
import { parseValue, ruleSchema, uuidParam, validate } from "./validator.js";

const Input = z.object({ name: z.string(), age: z.number().int() });

interface Refusal {
  error: { code: string; message: string; field?: string };
}

class ThingNotFoundError extends AppError {
  constructor() {
    super(404, "not_found", "No such thing.");
  }
}

/**
 * The helpers behind a real request, with the API's own error handler mounted —
 * so a refusal is asserted as the response a caller receives.
 *
 * No database, no container: the request is the whole input.
 */
const app = new Hono()
  .post("/strict", validate("json", Input), (c) => c.json(c.req.valid("json")))
  .post("/sentence", validate("json", Input, "name and age are required."), (c) => c.json(c.req.valid("json")))
  .post("/rule", validate("json", z.object({ name: ruleSchema(validateSkillName) })), (c) => c.json(c.req.valid("json")))
  .get("/things/:id", uuidParam("id", () => new ThingNotFoundError()), (c) => c.json(c.req.valid("param")))
  .onError(onError(createLogger("silent")));

/** Posts a body exactly as given, including bodies no JSON encoder would produce. */
async function post(path: string, body: string | null, contentType = "application/json"): Promise<Response> {
  return app.request(path, { method: "POST", headers: { "content-type": contentType }, body });
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

describe("validate", () => {
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

  // A malformed request and a well-formed one of the wrong shape are both a
  // 400 `validation_failed`: the distinction is not one a caller can act on.
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

  // A body is only read as JSON when the request says it is, so a form post
  // carrying JSON-looking text is validated as an empty object.
  it("does not read a body that is not declared as JSON", async () => {
    const res = await post("/strict", JSON.stringify({ name: "ada", age: 36 }), "text/plain");

    expect(res.status).toBe(400);
    expect(((await res.json()) as Refusal).error.code).toBe("validation_failed");
  });

  it("reports the route's own sentence when it passed one", async () => {
    const res = await post("/sentence", "{}");

    expect(((await res.json()) as Refusal).error.message).toBe("name and age are required.");
  });
});

describe("ruleSchema", () => {
  it("passes the rule's normalised value through", async () => {
    const res = await post("/rule", JSON.stringify({ name: "code-review" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "code-review" });
  });

  // The shared rule is the error code, exactly as if the rule had been called
  // directly — a caller cannot tell the rule ran inside a schema.
  it("answers a broken rule with the rule as the code", async () => {
    const res = await post("/rule", JSON.stringify({ name: "Not Valid" }));
    const body = (await res.json()) as Refusal;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("name_invalid");
    expect(body.error.field).toBe("name");
  });

  it("runs the rule on a missing member, so a required one is refused by its own rule", async () => {
    const res = await post("/rule", "{}");

    expect(((await res.json()) as Refusal).error.code).toBe("name_required");
  });
});

describe("uuidParam", () => {
  it("passes a UUID through", async () => {
    const id = crypto.randomUUID();
    const res = await app.request(`/things/${id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id });
  });

  it("answers a malformed id as the feature's own not found", async () => {
    const res = await app.request("/things/not-a-uuid");
    const body = (await res.json()) as Refusal;

    expect(res.status).toBe(404);
    expect(body.error.message).toBe("No such thing.");
  });
});
