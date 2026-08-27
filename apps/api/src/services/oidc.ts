import { ORGANISATION_CLAIM } from "@skill-registry/shared";
import { eq } from "drizzle-orm";
import * as client from "openid-client";
import { encodeFlow, safeDestination, type OidcFlow } from "../auth/oidc-state.js";
import { signSession } from "../auth/session.js";
import type { Database } from "../db/client.js";
import { users, type IdentityProviderRow, type UserRow } from "../db/schema.js";
import { ExternalLoginFailedError, PublicUrlNotConfiguredError } from "../http/errors.js";
import type { Logger } from "../logger.js";
import { findEnabledProviderBySlug } from "./identity-providers.js";

export interface OidcServiceDependencies {
  db: Database;
  jwtSecret: string;
  /** Absent on an instance with no Provider configured, which needs none. */
  publicUrl?: string;
  logger: Logger;
}

/** The path a provider returns a login to. One path for every Provider (ADR-0015). */
export const OIDC_CALLBACK_PATH = "/api/auth/callback";

/** `openid` for an ID token at all, `email` for the claim a User is matched by, `profile` for a name to display. */
const OIDC_SCOPE = "openid email profile";

/**
 * Discovery documents, keyed by Provider id and the moment it was last
 * changed, so editing a Provider drops its cached configuration without any
 * explicit invalidation. Bounded by the number of configured Providers, which
 * is a handful.
 */
const configCache = new Map<string, Promise<client.Configuration>>();

function configFor(provider: IdentityProviderRow): Promise<client.Configuration> {
  const key = `${provider.id}:${provider.updated_at.getTime()}`;
  const cached = configCache.get(key);
  if (cached) return cached;

  const discovered = client
    .discovery(new URL(provider.issuer_url), provider.client_id, provider.client_secret)
    .catch((error: unknown) => {
      // A failed discovery must not be remembered: the next attempt should
      // retry rather than replay the failure until someone edits the row.
      configCache.delete(key);
      throw error;
    });

  configCache.set(key, discovered);
  return discovered;
}

/** The absolute `redirect_uri`, which must match what is registered in the provider's console. */
function callbackUrl(deps: Pick<OidcServiceDependencies, "publicUrl">): URL {
  if (!deps.publicUrl) throw new PublicUrlNotConfiguredError();
  return new URL(`${deps.publicUrl}${OIDC_CALLBACK_PATH}`);
}

/**
 * Begins a login through an Identity Provider.
 *
 * @remarks
 * Returns the flow as well as the URL because the caller must put it in a
 * cookie before redirecting — the cookie, not the `state` that travels through
 * the provider, is what the callback trusts (ADR-0015).
 *
 * @param deps - The database, public URL, and logger this needs.
 * @param slug - The Provider to sign in through.
 * @param destination - Where to land afterwards; narrowed to a path within
 * this Registry, defaulting to `/`.
 * @returns `{ authorizationUrl, flow }`
 * @throws ExternalLoginFailedError if no enabled Provider has that slug.
 * @throws PublicUrlNotConfiguredError if `PUBLIC_URL` is unset, since the
 * `redirect_uri` cannot be built without it.
 * @example
 * ```ts
 * const { authorizationUrl, flow } = await startExternalLogin(deps, "google", "/skills");
 * ```
 */
export async function startExternalLogin(
  deps: OidcServiceDependencies,
  slug: string,
  destination: string | undefined,
): Promise<{ authorizationUrl: URL; flow: OidcFlow }> {
  const provider = await findEnabledProviderBySlug(deps, slug);
  if (!provider) throw new ExternalLoginFailedError(`No enabled Identity Provider with slug "${slug}".`);

  const redirectUri = callbackUrl(deps);
  const config = await configFor(provider);

  const flow: OidcFlow = {
    nonce: client.randomNonce(),
    provider: provider.slug,
    destination: safeDestination(destination),
  };

  const authorizationUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri.href,
    scope: OIDC_SCOPE,
    state: encodeFlow(flow),
    nonce: flow.nonce,
  });

  return { authorizationUrl, flow };
}

/** Reads a claim that must be a non-empty string, or `null` if it is anything else. */
function stringClaim(claims: Record<string, unknown>, name: string): string | null {
  const value = claims[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Completes a login a provider has returned, and resolves it to a session.
 *
 * @remarks
 * The order matters and is the security of the whole feature. The flow comes
 * from the cookie, and the `state` expected at the token endpoint is rebuilt
 * from that cookie rather than read off the incoming URL — so a response
 * returned against a different Provider than the one the browser started with
 * fails before any claim is looked at. Only then are the claims checked: the
 * email must be verified, and the organisation claim (`hd` for Google, `tid`
 * for Microsoft) must equal the Provider's permitted one. That gate is the
 * only control on who gets an account (ADR-0015), and it is matched on the
 * claim, never on the email address's suffix.
 *
 * @param deps - The database, JWT secret, public URL, and logger this needs.
 * @param flow - The flow read from this browser's cookie.
 * @param query - The query string the provider returned to the callback.
 * @returns `{ user, token, destination }`
 * @throws ExternalLoginFailedError for every failure — a mismatched nonce, an
 * unverified email, the wrong hosted domain, a Provider disabled mid-flow. The
 * cause is carried for the logs and never for the response.
 * @throws PublicUrlNotConfiguredError if `PUBLIC_URL` is unset.
 * @example
 * ```ts
 * const { user, token, destination } = await completeExternalLogin(deps, flow, c.req.query());
 * ```
 */
export async function completeExternalLogin(
  deps: OidcServiceDependencies,
  flow: OidcFlow,
  query: Record<string, string>,
): Promise<{ user: UserRow; token: string; destination: string }> {
  const provider = await findEnabledProviderBySlug(deps, flow.provider);
  if (!provider) {
    throw new ExternalLoginFailedError(`No enabled Identity Provider with slug "${flow.provider}".`);
  }

  const config = await configFor(provider);

  // Built from PUBLIC_URL rather than the incoming request: openid-client
  // derives the token request's `redirect_uri` by stripping this URL's query,
  // and it has to come out byte-identical to the one the authorization request
  // carried — which the raw request URL would not be behind a proxy.
  const currentUrl = callbackUrl(deps);
  for (const [key, value] of Object.entries(query)) currentUrl.searchParams.set(key, value);

  let claims: Record<string, unknown>;
  try {
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      expectedState: encodeFlow(flow),
      expectedNonce: flow.nonce,
    });
    const idTokenClaims = tokens.claims();
    if (!idTokenClaims) throw new Error("The provider returned no ID token.");
    claims = idTokenClaims as unknown as Record<string, unknown>;
  } catch (error) {
    throw new ExternalLoginFailedError(`Authorization code grant failed: ${String(error)}`);
  }

  const email = stringClaim(claims, "email")?.toLowerCase();
  if (!email) throw new ExternalLoginFailedError("The provider returned no email claim.");
  if (claims.email_verified !== true) {
    throw new ExternalLoginFailedError(`The email claim for ${email} is not verified.`);
  }

  const organisationClaim = ORGANISATION_CLAIM[provider.kind];
  const organisation = stringClaim(claims, organisationClaim);
  if (organisation !== provider.permitted_domain) {
    throw new ExternalLoginFailedError(
      `Claim "${organisationClaim}" was ${organisation ?? "absent"}, not the permitted ${provider.permitted_domain ?? "(none)"}.`,
    );
  }

  const user = await resolveUserFromClaims(deps, provider, { email, claims });
  const token = await signSession(user.id, deps.jwtSecret);
  return { user, token, destination: safeDestination(flow.destination) };
}

/** Postgres's unique_violation — here, two first logins for one email racing. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/**
 * Finds the User a set of verified claims belongs to, creating them if this is
 * their first login.
 *
 * @remarks
 * Matched by email, not by the provider's `sub` claim, and with no identity
 * table — the `users` row *is* the identity (ADR-0015). Two consequences follow
 * and are deliberate: someone who first arrived through one Provider signs into
 * the same User through a second Provider asserting the same verified email,
 * and someone renamed in the provider gets a *second* User rather than
 * following their first.
 *
 * A created User is always a `reader`, never a role the Provider chose. Logging
 * in never alters the role of a User who already exists, so this can neither
 * grant nor remove anything above `reader`.
 *
 * Separated from the handshake so it can be tested against fabricated claims
 * without a provider in front of it.
 *
 * @param deps - The database and logger this needs.
 * @param provider - The Provider whose gate these claims already passed.
 * @param identity - The verified, lowercased email and the ID token's claims.
 * @returns The existing or newly created User row.
 * @example
 * ```ts
 * const user = await resolveUserFromClaims(deps, provider, {
 *   email: "dev@example.com",
 *   claims: { given_name: "Dev", family_name: "Parikh" },
 * });
 * ```
 */
export async function resolveUserFromClaims(
  deps: Pick<OidcServiceDependencies, "db" | "logger">,
  provider: IdentityProviderRow,
  identity: { email: string; claims: Record<string, unknown> },
): Promise<UserRow> {
  const existing = await findUserByEmail(deps, identity.email);
  if (existing) {
    deps.logger.info(
      { user_id: existing.id, identity_provider: provider.slug },
      "user logged in through an identity provider",
    );
    return existing;
  }

  const [firstName, lastName] = namesFrom(identity.claims, identity.email);

  try {
    const [created] = await deps.db
      .insert(users)
      .values({
        email: identity.email,
        first_name: firstName,
        last_name: lastName,
        // No password at all, rather than an unusable one (ADR-0007), and
        // nothing to change — `must_change_password` is meaningful only for a
        // User who was handed a generated password.
        password_hash: null,
        role: "reader",
        must_change_password: false,
      })
      .returning();
    if (!created) throw new Error("Insert did not return the created User.");

    deps.logger.info(
      { user_id: created.id, identity_provider: provider.slug },
      "user provisioned from an identity provider",
    );
    return created;
  } catch (error) {
    // Two first logins for the same person at once: whichever lost the race
    // reads the row the other just wrote instead of failing the login.
    if (isUniqueViolation(error)) {
      const raced = await findUserByEmail(deps, identity.email);
      if (raced) return raced;
    }
    throw error;
  }
}

async function findUserByEmail(
  deps: Pick<OidcServiceDependencies, "db">,
  email: string,
): Promise<UserRow | null> {
  const [row] = await deps.db.select().from(users).where(eq(users.email, email)).limit(1);
  return row ?? null;
}

/**
 * Both name columns are `NOT NULL`, and a provider is under no obligation to
 * send either claim — so this always yields something printable rather than
 * refusing a login over a missing display name.
 */
function namesFrom(claims: Record<string, unknown>, email: string): [string, string] {
  const given = stringClaim(claims, "given_name");
  const family = stringClaim(claims, "family_name");
  if (given && family) return [given, family];

  const full = stringClaim(claims, "name");
  if (full) {
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length > 1) return [parts.slice(0, -1).join(" "), parts.at(-1) as string];
    if (parts.length === 1) return [parts[0] as string, ""];
  }

  return [given ?? (email.split("@")[0] as string), family ?? ""];
}
