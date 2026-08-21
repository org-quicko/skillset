import { SetupInitSchema, SetupStateSchema, UserSchema } from "@skill-registry/shared";
import { count, sql } from "drizzle-orm";
import type { Hono } from "hono";
import type { AuthVariables } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { setSessionCookie, signSession } from "../auth/session.js";
import { advisoryLockKey } from "../db/advisory-lock.js";
import type { Database } from "../db/client.js";
import { users, type UserRow } from "../db/schema.js";
import { errorResponse } from "../http/errors.js";

export interface SetupRouteDependencies {
  db: Database;
  jwtSecret: string;
}

// Serialises against concurrent initialisation attempts — see setup.test.ts.
// Transaction-scoped (pg_advisory_xact_lock) rather than session-scoped:
// postgres.js pools connections per statement, so a session-level
// lock/unlock pair isn't guaranteed to run on the same backend session.
const INIT_LOCK_KEY = advisoryLockKey("skill-registry:setup-init");

export function registerSetupRoutes(app: Hono<{ Variables: AuthVariables }>, deps: SetupRouteDependencies): void {
  app.get("/setup", async (c) => {
    const [row] = await deps.db.select({ count: count() }).from(users);
    return c.json(SetupStateSchema.parse({ initialized: (row?.count ?? 0) > 0 }));
  });

  app.post("/setup", async (c) => {
    const parsed = SetupInitSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return errorResponse(c, 400, "validation_failed", issue?.message ?? "Invalid request body.", String(issue?.path[0]));
    }

    const passwordHash = await hashPassword(parsed.data.password);

    const superadmin: UserRow | null = await deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${INIT_LOCK_KEY})`);

      const [row] = await tx.select({ count: count() }).from(users);
      if ((row?.count ?? 0) > 0) {
        return null;
      }

      const [created] = await tx
        .insert(users)
        .values({
          first_name: parsed.data.first_name,
          last_name: parsed.data.last_name,
          email: parsed.data.email,
          password_hash: passwordHash,
          role: "superadmin",
        })
        .returning();
      if (!created) throw new Error("Insert did not return the created User.");
      return created;
    });

    if (!superadmin) {
      return errorResponse(c, 409, "already_initialized", "A User already exists.");
    }

    const token = await signSession(superadmin.id, deps.jwtSecret);
    setSessionCookie(c, token);
    return c.json(UserSchema.parse(superadmin), 201);
  });
}
