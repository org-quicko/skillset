import { eq } from "drizzle-orm";
import { verifyPassword } from "../auth/password.js";
import { signSession } from "../auth/session.js";
import type { Database } from "../db/client.js";
import { users, type UserRow } from "../db/schema.js";
import { InvalidCredentialsError } from "../http/errors.js";
import { padTo } from "../http/timing.js";
import type { Logger } from "../logger.js";

export interface AuthServiceDependencies {
  db: Database;
  jwtSecret: string;
  logger: Logger;
}

// Floor a failed login to, so that an unknown email (no hash to verify) and a
// wrong password (a real argon2id verify) take indistinguishably long.
const LOGIN_TIMING_FLOOR_MS = 200;

export async function login(
  deps: AuthServiceDependencies,
  credentials: { email: string; password: string },
): Promise<{ user: UserRow; token: string }> {
  const startedAt = Date.now();

  const [user] = await deps.db.select().from(users).where(eq(users.email, credentials.email)).limit(1);
  const passwordMatches = await verifyPassword(credentials.password, user?.password_hash ?? null);

  if (!user || !passwordMatches) {
    await padTo(startedAt, LOGIN_TIMING_FLOOR_MS);
    throw new InvalidCredentialsError();
  }

  const token = await signSession(user.id, deps.jwtSecret);
  await padTo(startedAt, LOGIN_TIMING_FLOOR_MS);
  deps.logger.info({ user_id: user.id }, "user logged in");
  return { user, token };
}
