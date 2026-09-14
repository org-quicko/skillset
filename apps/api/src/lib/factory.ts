import { Hono } from "hono";
import type { Services } from "../services.js";

/**
 * What every route in the API can read off its context: the services built
 * once in `createApp`, the public URL the Registry is reached at, and the
 * client's address.
 *
 * `clientIp` is set by middleware on the outer app rather than by anything in
 * this router, and is declared here so a handler can read it — `undefined`
 * when the request came through an untrusted proxy, or from
 * `app.request(...)` in a test, which has no socket behind it.
 */
export type AppEnv = {
  Variables: {
    services: Services;
    publicUrl: string;
    clientIp: string | undefined;
  };
};

/** A feature's router, typed with the API's shared context. */
export function createRouter(): Hono<AppEnv> {
  return new Hono<AppEnv>();
}
