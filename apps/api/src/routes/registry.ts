import { RegistryInitSchema, RegistryStateSchema, UserSchema } from "@skill-registry/shared";
import { count, sql } from "drizzle-orm";
import type { Hono } from "hono";
import type { AuthVariables } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { setSessionCookie, signSession } from "../auth/session.js";
import { advisoryLockKey } from "../db/advisory-lock.js";
import type { Database } from "../db/client.js";
import { users, type UserRow } from "../db/schema.js";
import { errorResponse } from "../http/errors.js";

export interface RegistryRouteDependencies {
  db: Database;
  jwtSecret: string;
}

// Serialises against concurrent initialisation attempts — see registry.test.ts.
// Transaction-scoped (pg_advisory_xact_lock) rather than session-scoped:
// postgres.js pools connections per statement, so a session-level
// lock/unlock pair isn't guaranteed to run on the same backend session.
const INIT_LOCK_KEY = advisoryLockKey("skill-registry:registry-init");

export function registerRegistryRoutes(app: Hono<{ Variables: AuthVariables }>, deps: RegistryRouteDependencies): void {
  app.get("/registry", async (c) => {
    const [row] = await deps.db.select({ count: count() }).from(users);
    return c.json(RegistryStateSchema.parse({ initialized: (row?.count ?? 0) > 0 }));
  });

  app.post("/registry", async (c) => {
    const parsed = RegistryInitSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return errorResponse(c, 400, "validation_failed", issue?.message ?? "Invalid request body.", String(issue?.path[0]));
    }

    const passwordHash = await hashPassword(parsed.data.password);

    const admin: UserRow | null = await deps.db.transaction(async (tx) => {
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
          role: "admin",
        })
        .returning();
      if (!created) throw new Error("Insert did not return the created User.");
      return created;
    });

    if (!admin) {
      return errorResponse(c, 409, "already_initialized", "The Registry already has a User.");
    }

    const token = await signSession(admin.id, deps.jwtSecret);
    setSessionCookie(c, token);
    return c.json(UserSchema.parse(admin), 201);
  });
}
