import { Hono } from "hono";
import type { Services } from "../services.js";

/**
 * What every route in the API can read off its context: the services built
 * once in `createApp`, and the public URL the Registry is reached at.
 */
export type AppEnv = {
  Variables: {
    services: Services;
    publicUrl: string;
  };
};

/** A feature's router, typed with the API's shared context. */
export function createRouter(): Hono<AppEnv> {
  return new Hono<AppEnv>();
}
