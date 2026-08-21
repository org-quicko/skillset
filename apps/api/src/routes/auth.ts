import { LoginSchema, UserSchema } from "@skill-registry/shared";
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { requireAuth, type AuthVariables } from "../auth/middleware.js";
import { verifyPassword } from "../auth/password.js";
import { clearSessionCookie, setSessionCookie, signSession } from "../auth/session.js";
import type { Database } from "../db/client.js";
import { users } from "../db/schema.js";
import { errorResponse } from "../http/errors.js";
import { padTo } from "../http/timing.js";

export interface AuthRouteDependencies {
  db: Database;
  jwtSecret: string;
}

// Floor a failed login to, so that an unknown email (no hash to verify) and a
// wrong password (a real argon2id verify) take indistinguishably long.
const LOGIN_TIMING_FLOOR_MS = 200;

function invalidCredentials(c: Context) {
  return errorResponse(c, 401, "invalid_credentials", "Unknown email or wrong password.");
}

export function registerAuthRoutes(app: Hono<{ Variables: AuthVariables }>, deps: AuthRouteDependencies): void {
  app.post("/auth/login", async (c) => {
    const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(c, 400, "validation_failed", "email and password are required.");
    }

    const startedAt = Date.now();
    const { email, password } = parsed.data;

    const [user] = await deps.db.select().from(users).where(eq(users.email, email)).limit(1);
    const passwordMatches = await verifyPassword(password, user?.password_hash ?? null);

    if (!user || !passwordMatches) {
      await padTo(startedAt, LOGIN_TIMING_FLOOR_MS);
      return invalidCredentials(c);
    }

    const token = await signSession(user.id, deps.jwtSecret);
    setSessionCookie(c, token);
    await padTo(startedAt, LOGIN_TIMING_FLOOR_MS);
    return c.json(UserSchema.parse(user), 200);
  });

  app.post("/auth/logout", requireAuth(deps), async (c) => {
    clearSessionCookie(c);
    return c.body(null, 204);
  });
}
