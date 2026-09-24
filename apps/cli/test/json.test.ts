import { afterEach, describe, expect, it } from "bun:test";
import { ApiError } from "../src/http.js";
import { emitJson, jsonMode, setJsonMode, toJsonError } from "../src/json.js";

/** Captures one stream's writes for the length of `run`, restoring it afterwards. */
async function capture(stream: "stdout" | "stderr", run: () => Promise<void>): Promise<string> {
  const original = process[stream].write.bind(process[stream]);
  let written = "";
  process[stream].write = ((chunk: string) => {
    written += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    await run();
  } finally {
    process[stream].write = original;
  }
  return written;
}

afterEach(() => {
  setJsonMode(false);
  process.exitCode = 0;
});

describe("jsonMode", () => {
  it("is off until --json sets it", () => {
    expect(jsonMode()).toBe(false);
    setJsonMode(true);
    expect(jsonMode()).toBe(true);
  });
});

describe("emitJson", () => {
  it("writes the result to stdout as JSON and leaves the exit code alone", async () => {
    const out = await capture("stdout", () => emitJson(async () => ({ name: "code-review", installs: 3 })));

    expect(JSON.parse(out)).toEqual({ name: "code-review", installs: 3 });
    expect(process.exitCode).toBe(0);
  });

  // Errors go to stderr so that `skillset search --json | jq` is only ever fed
  // well-formed payloads — a failure must not become a parse error downstream.
  it("writes a failure to stderr, not stdout, and exits non-zero", async () => {
    let out = "";
    const err = await capture("stderr", async () => {
      out = await capture("stdout", () =>
        emitJson(() => Promise.reject(new ApiError(404, "not_found", "No Skill named \"nope\"."))),
      );
    });

    expect(out).toBe("");
    expect(JSON.parse(err)).toEqual({
      error: { code: "not_found", message: 'No Skill named "nope".', status: 404 },
    });
    expect(process.exitCode).toBe(1);
  });

  it("never rejects, so a caller parsing stdout is not handed a stack trace", async () => {
    await capture("stderr", async () => {
      await expect(emitJson(() => Promise.reject(new Error("boom")))).resolves.toBeUndefined();
    });
  });
});

describe("toJsonError", () => {
  // A caller branches on `code`, not on prose, so the Registry's own code has
  // to survive rather than being flattened into the message.
  it("keeps the Registry's code, status, and field", () => {
    expect(toJsonError(new ApiError(422, "name_invalid", "Bad name.", "name"))).toEqual({
      error: { code: "name_invalid", message: "Bad name.", status: 422, field: "name" },
    });
  });

  it("omits field when the Registry named none", () => {
    expect(toJsonError(new ApiError(403, "forbidden", "Not allowed."))).toEqual({
      error: { code: "forbidden", message: "Not allowed.", status: 403 },
    });
  });

  it("reports a local failure as cli_error with no status", () => {
    expect(toJsonError(new Error("No terminal to prompt at."))).toEqual({
      error: { code: "cli_error", message: "No terminal to prompt at." },
    });
  });
});
