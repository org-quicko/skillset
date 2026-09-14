import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { tokens, users, type TokenRow, type UserRow } from "../../db/schemas/index.js";
import type { AuthRegistry } from "./instance.js";
import { digestsMatch, hashTokenSecret } from "./token.js";

const BEARER_PREFIX = "Bearer ";

/**
 * What authenticated a request, alongside the User it was made as.
 *
 * @remarks
 * Authentication itself does not care which credential produced the request
 * (spec, "Access control"), so most routes read `user` and ignore this. It
 * exists for the one decision that does depend on it: replacing a password
 * revokes the User's *other* sessions and leaves the one making the request
 * alone (ISSUE-10), which means knowing which session that is.
 */
export type Credential =
  | { kind: "session"; user: UserRow; sessionId: string }
  | { kind: "token"; user: UserRow; token: TokenRow };

/**
 * Resolves a request's credential — a session cookie or a Bearer Token — to the
 * User it belongs to.
 *
 * @remarks
 * The User row is always re-read from Postgres rather than trusted from the
 * session or Token, so the role on it is current (ADR-0005): a Token grants
 * no more than its owner's role today, and a demotion or removal lands on the
 * next request.
 */
export class Authenticator {
  constructor(
    private readonly db: Database,
    private readonly auth: AuthRegistry,
  ) {}

  /**
   * Finds the credential a request was made with, trying the session cookie
   * first and then a Bearer Token.
   *
   * @param headers - The request's headers.
   * @returns The credential and the User's current row, or `null` if neither
   * resolves.
   * @example
   * ```ts
   * const credential = await authenticator.resolve(c.req.raw.headers);
   * ```
   */
  async resolve(headers: Headers): Promise<Credential | null> {
    return (await this.fromSession(headers)) ?? (await this.fromToken(headers));
  }

  private async fromSession(headers: Headers): Promise<Credential | null> {
    // `current`, not `fresh`: validating a session does not depend on which
    // Providers are configured (ADR-0019).
    const auth = await this.auth.current();
    const session = await auth.api.getSession({ headers });
    if (!session) return null;
    const user = await this.findUser(session.user.id);
    return user ? { kind: "session", user, sessionId: session.session.id } : null;
  }

  private async fromToken(headers: Headers): Promise<Credential | null> {
    const header = headers.get("authorization");
    if (!header?.startsWith(BEARER_PREFIX)) return null;

    const secret = header.slice(BEARER_PREFIX.length).trim();
    if (!secret) return null;

    const digest = hashTokenSecret(secret);
    const [token] = await this.db.select().from(tokens).where(eq(tokens.token_hash, digest)).limit(1);
    if (!token || !digestsMatch(token.token_hash, digest)) return null;

    const user = await this.findUser(token.user_id);
    if (!user) return null;

    await this.db.update(tokens).set({ last_used_at: new Date(), updated_at: new Date() }).where(eq(tokens.id, token.id));
    return { kind: "token", user, token };
  }

  private async findUser(id: string): Promise<UserRow | null> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }
}
