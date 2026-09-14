import { describe, expect, it } from "bun:test";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { createLogger } from "./logger.js";

/**
 * Seam 0 — what a log line contains, captured from the stream Pino writes to.
 *
 * Redaction is the kind of thing that is either asserted or quietly wrong: a
 * misspelled path silently logs the field it was meant to hide.
 */
function captureLine(log: (logger: ReturnType<typeof createLogger>) => void): Record<string, unknown> {
  const lines: string[] = [];
  const logger = createLogger("info", { write: (line) => lines.push(line) });
  log(logger);
  return JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
}

describe("credential redaction (ISSUE-19)", () => {
  it("redacts an authorization header nested under a request object", () => {
    // `*.authorization` does not reach this depth, which is why the path is
    // spelled out — one `logger.info({ req })` used to print a Bearer Token.
    const line = captureLine((logger) =>
      logger.info({ req: { headers: { authorization: "Bearer a-real-token" } } }, "request"),
    );

    expect(JSON.stringify(line)).not.toContain("a-real-token");
  });

  it("redacts a cookie header, which carries a live session", () => {
    const line = captureLine((logger) =>
      logger.info({ req: { headers: { cookie: "better-auth.session_token=a-real-session" } } }, "request"),
    );

    expect(JSON.stringify(line)).not.toContain("a-real-session");
  });

  it("redacts a client secret however deeply a row was passed in", () => {
    const line = captureLine((logger) =>
      logger.info({ result: { row: { client_secret: "a-real-client-secret" } } }, "provider"),
    );

    expect(JSON.stringify(line)).not.toContain("a-real-client-secret");
  });
});

describe("a failed query's parameters (ISSUE-19)", () => {
  it("keeps the SQL but not the values it was run with", () => {
    // Drizzle puts both in the error's *message*, where field redaction
    // cannot reach: a failed `accounts` insert would otherwise log a password
    // hash, and a failed Provider update a live OAuth secret.
    const error = new DrizzleQueryError(
      'insert into "accounts" ("password") values ($1)',
      ["$argon2id$v=19$m=65536,t=3,p=4$a-real-hash"],
      new Error("duplicate key value violates unique constraint"),
    );

    const line = captureLine((logger) => logger.error({ err: error }, "Unhandled error"));
    const serialized = JSON.stringify(line);

    expect(serialized).not.toContain("a-real-hash");
    expect(serialized).toContain("[REDACTED]");
    // The statement itself is this repo's own code, and it is what makes the
    // line worth logging at all.
    expect(serialized).toContain("insert into");
  });
});
