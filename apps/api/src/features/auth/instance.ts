import { ORGANISATION_CLAIM, isUngated, type IdentityProviderKind } from "@in-org-quicko/skillset-shared";
import { betterAuth } from "better-auth";
import type { Database } from "../../db/client.js";
import type { IdentityProviderRow } from "../../db/tables.js";
import type { Logger } from "../../lib/logger.js";
import { trustedOrigins } from "../../lib/origins.js";
import { openClientSecret, type DerivedKeys } from "../../lib/secrets.js";
import { GITHUB_SCOPES, fetchGitHubIdentity } from "./github.js";
import { hashPassword, verifyPassword } from "./password.js";

export interface BetterAuthDependencies {
  /** Better Auth reads and writes its own tables through this, already scoped to `DB_SCHEMA`. */
  db: Database;
  /** Signing secret. The app refuses to boot without one (ADR-0005, ADR-0016). */
  secret: string;
  /** Absolute base URL this Registry is reached at. Required (ADR-0016). */
  publicUrl: string;
  /** Where a refused login's reason goes — the only place it is ever told. */
  logger: Logger;
  /**
   * Whether to limit request rates. Defaults to on; only the test suite turns
   * it off, because every test signs in from the same address and that is
   * exactly what a credential limiter refuses.
   */
  rateLimiting?: boolean;
  /** The per-purpose keys a Provider's stored `client_secret` is decrypted with (ISSUE-9). */
  keys: DerivedKeys;
}

/** Better Auth's routes are mounted under this path, inside the `/api` app. */
export const AUTH_BASE_PATH = "/api/auth";

// Sessions are rows and revoke on logout, so the short expiry ADR-0005 needed
// to bound an unrevokable JWT no longer applies.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SESSION_REFRESH_SECONDS = 60 * 60 * 24;

/**
 * The refusal codes the login page knows how to explain.
 *
 * @remarks
 * Once a single opaque code for every refusal, on the reasoning that naming the
 * failed check tells an attacker which one they tripped. That held while every
 * refusal had the same remedy — it does not. `oauth_app_not_approved` in
 * particular is indistinguishable from plain non-membership to the person
 * hitting it, and is fixed by an org owner in five minutes once named
 * (ADR-0018, ADR-0021).
 *
 * None of these names the expected organisation. Which check failed is public;
 * what would have passed it stays in the logs.
 */
const REFUSED = {
  generic: "external_login_failed",
  providerNotConfigured: "provider_not_configured",
  providerDisabled: "provider_disabled",
  notPermitted: "organisation_not_permitted",
  oauthAppNotApproved: "oauth_app_not_approved",
  noEmail: "no_email_from_provider",
  emailNotVerified: "email_not_verified",
} as const;

/**
 * Splits a provider's claims into the two halves this Registry stores.
 *
 * @remarks
 * Preserved from the implementation Better Auth replaced, so an existing
 * User's name does not change shape on their next login.
 *
 * @param claims - The provider's claims.
 * @param email - Fallback source for a given name when no claim supplies one.
 * @returns `[first_name, last_name]`.
 * @example
 * ```ts
 * const [first, last] = namesFrom({ name: "Ada Lovelace" }, "ada@example.com");
 * ```
 */
function namesFrom(claims: Record<string, unknown>, email: string): [string, string] {
  const given = typeof claims.given_name === "string" ? claims.given_name : undefined;
  const family = typeof claims.family_name === "string" ? claims.family_name : undefined;
  if (given && family) return [given, family];

  const full = typeof claims.name === "string" ? claims.name : undefined;
  if (full) {
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length > 1) return [parts.slice(0, -1).join(" "), parts.at(-1) as string];
    if (parts.length === 1) return [parts[0] as string, ""];
  }

  return [given ?? (email.split("@")[0] as string), family ?? ""];
}

/**
 * Turns the configured Providers into Better Auth's `socialProviders`.
 *
 * @remarks
 * Credentials only. The organisation gate is read from the row on every login
 * instead, because this object is captured at construction and would go stale
 * (ADR-0019). Microsoft is the exception only because its tenant forms part of
 * the endpoint URL; its `tid` claim is still checked per login like the others.
 *
 * @param providers - The enabled Providers to configure.
 * @returns Better Auth's `socialProviders` config.
 * @example
 * ```ts
 * const config = socialProvidersFor(enabledProviders);
 * ```
 */
function socialProvidersFor(providers: IdentityProviderRow[]): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  for (const provider of providers) {
    const credentials = { clientId: provider.client_id, clientSecret: provider.client_secret };

    if (provider.kind === "google") {
      config.google = credentials;
    } else if (provider.kind === "microsoft") {
      // Microsoft is the one kind whose organisation is part of the endpoint
      // URL rather than only a claim, so a list cannot be expressed here.
      // Exactly one permitted tenant still pins the endpoint to it; several,
      // or none, fall back to a multi-tenant endpoint and lean on the `tid`
      // check, which runs per login either way. `organizations` rather than
      // `common` for several, so personal accounts are turned away by
      // Microsoft instead of travelling all the way here to be refused.
      const tenants = provider.permitted_organisations;
      config.microsoft = {
        ...credentials,
        tenantId: tenants.length === 1 ? tenants[0] : tenants.length > 1 ? "organizations" : "common",
      };
    } else if (provider.kind === "github") {
      config.github = {
        ...credentials,
        scope: GITHUB_SCOPES,
        // GitHub's `/user` reports only the publicly-visible address — null for
        // a private one — and no organisations at all. This substitutes the
        // primary address and the membership list so the gate has something to
        // check.
        getUserInfo: async (tokens: { accessToken?: string | undefined }) => {
          if (!tokens.accessToken) return null;
          const identity = await fetchGitHubIdentity(tokens.accessToken);
          if (!identity.email) return null;
          return {
            user: {
              id: String(identity.id),
              name: identity.name ?? identity.login,
              email: identity.email,
              // GitHub's own flag, not an unconditional `true`. Membership of a
              // permitted organisation is what earns an account (ADR-0018), and
              // that is unchanged — but `github` is deliberately absent from
              // `trustedProviders` below, so this flag is what decides whether
              // the login may attach to a User that already exists. Asserting
              // `true` here meant anyone who could set an unverified primary
              // address to an existing User's could sign in as them, and with
              // an ungated Provider (ADR-0021) nothing else stood in the way.
              emailVerified: identity.email_verified,
              image: identity.avatar_url ?? undefined,
            },
            data: identity,
          };
        },
      };
    }
  }

  return config;
}

/**
 * The Providers whose login may attach to a User that already exists.
 *
 * @remarks
 * Better Auth links an external login to an existing User by email when the
 * Provider is trusted here, so this list is the answer to "whose word about
 * an email address is good enough to sign in as whoever owns it".
 *
 * Google's is: it asserts `email_verified: true` only for addresses it has
 * itself verified.
 *
 * Microsoft's is not, unconditionally. Entra takes `email` from a
 * **mutable, admin-set** attribute that Microsoft does not verify (the
 * published "nOAuth" class of bug), so anyone who can administer *any* tenant
 * can set a user's `mail` to a Superadmin's address here. The one
 * configuration where that does not follow is a Provider pinned to exactly
 * one tenant: the endpoint is that tenant's, the `tid` claim is checked
 * against it per login (`organisationGate`), and the address is then
 * provisioned by an administrator this Registry has deliberately trusted.
 * Any other Microsoft configuration — several tenants, or none at all
 * (ADR-0021) — is untrusted, and a login through it that matches an existing
 * User is refused as unlinked rather than signed in as them (ISSUE-2).
 *
 * GitHub is absent for a third reason: its primary address may be one GitHub
 * has never challenged, so linking is left to its own `emailVerified` flag
 * (ADR-0018).
 *
 * @param providers - The enabled Providers this instance is being built for.
 * @returns The provider ids Better Auth may auto-link.
 * @example
 * ```ts
 * trustedProvidersFor([{ kind: "microsoft", permitted_organisations: ["tenant-id"] }]); // ["microsoft"]
 * ```
 */
function trustedProvidersFor(providers: IdentityProviderRow[]): string[] {
  return providers
    .filter((provider) => {
      if (provider.kind === "google") return true;
      if (provider.kind === "microsoft") return provider.permitted_organisations.length === 1;
      return false;
    })
    .map((provider) => provider.kind);
}

/** The shape `validateUserInfo` reports a sign-in's origin in. */
export interface GateSource {
  method: string;
  oauth?: { providerId: string; profile?: Record<string, unknown> | undefined } | undefined;
}

/**
 * The organisation gate: the only control on who gets an account (ADR-0015),
 * and skippable, which is the whole of ADR-0021.
 *
 * @remarks
 * A Provider admits a login if the organisation it asserts is any one of the
 * Provider's `permitted_organisations`. If that list is empty the check does
 * not run at all and every account the provider authenticates is admitted —
 * deliberate, configurable, and logged loudly every time it happens.
 *
 * Runs on `create-user`, `link-account`, and `sign-in` alike, so someone
 * removed from the organisation is refused on their next login rather than
 * keeping an account they passed the check for once (ADR-0018).
 *
 * The Provider is re-read per call rather than closed over, so disabling one or
 * changing the organisations it admits takes effect immediately (ADR-0019).
 *
 * Exported so the rules can be tested as decisions about claims, without
 * standing up an authorization server to reach them.
 *
 * The caller is told which check failed, but never what would have passed it:
 * the codes distinguish an unapproved OAuth app from plain non-membership,
 * because those have different remedies, while the permitted organisations
 * themselves appear only in the log line.
 *
 * @param db - The database to read the Provider's current gate from.
 * @param logger - Where a refusal's reason, and every ungated admission, is recorded.
 * @returns A `validateUserInfo` handler: nothing to admit, `{ error }` to refuse.
 * @example
 * ```ts
 * const gate = organisationGate(db, logger);
 * await gate({ source: { method: "oauth", oauth: { providerId: "google", profile } } });
 * ```
 */
export function organisationGate(db: Database, logger: Logger) {
  return async ({ source }: { source: GateSource }): Promise<void | { error: string }> => {
    // A password sign-in has no organisation to check, and is only reachable by
    // a User an Admin already created.
    if (source.method !== "oauth" || !source.oauth) return;

    const kind = source.oauth.providerId as IdentityProviderKind;

    /** Records why, then returns the code the login page will explain. */
    const refuse = (code: string, reason: string, details: Record<string, unknown> = {}) => {
      logger.warn({ kind, code, reason, ...details }, "external login refused");
      return { error: code };
    };

    const provider = await db
      .selectFrom("identity_providers")
      .selectAll()
      .where("kind", "=", kind)
      .executeTakeFirst();

    if (!provider) {
      return refuse(REFUSED.providerNotConfigured, "no provider configured for this kind");
    }
    if (!provider.enabled) {
      return refuse(REFUSED.providerDisabled, "provider is disabled");
    }

    const permitted = provider.permitted_organisations.map((organisation) =>
      organisation.trim().toLowerCase(),
    );
    const profile = source.oauth.profile ?? {};
    const claim = ORGANISATION_CLAIM[kind];

    // An address the provider itself says it has not verified is refused, whatever
    // organisation it belongs to and whether or not this Provider checks one — an
    // organisation gate answers who may have an account here, not whether this person
    // owns the address the account will be keyed on (ADR-0015).
    //
    // Only an explicit `false` refuses. An *absent* claim is admitted, because Entra
    // never emits one and requiring it refused every Microsoft login; the tenant check
    // below is what carries that case, since inside a tenant the address is provisioned
    // by its administrator. GitHub carries no such claim either, and is handled by being
    // left out of `trustedProviders` instead (ADR-0018).
    if (profile.email_verified === false) {
      return refuse(REFUSED.emailNotVerified, "provider reports the email address is not verified");
    }

    // An empty list is a deliberate configuration meaning "admit anyone this
    // provider authenticates" (ADR-0021). It is the one branch here that lets
    // someone in without checking anything, so it says so every single time
    // rather than passing quietly.
    if (isUngated(permitted)) {
      logger.warn(
        { kind, email: profile.email },
        "external login admitted without an organisation check — this Provider has no permitted organisations, " +
          "so anyone the provider authenticates can obtain a reader account here",
      );
      return;
    }

    if (claim) {
      // Google and Microsoft: matched on the claim, never on the email
      // address's suffix, which anybody can make look like anything.
      const asserted = profile[claim];
      if (typeof asserted !== "string") {
        return refuse(REFUSED.notPermitted, `profile carries no ${claim} claim`, { permitted });
      }
      if (!permitted.includes(asserted.toLowerCase())) {
        return refuse(REFUSED.notPermitted, `${claim} claim is not a permitted organisation`, {
          permitted,
          asserted,
        });
      }
      return;
    }

    // GitHub: no claim to read, so live membership is the whole gate. An
    // address is required but not otherwise judged (ADR-0018).
    const organisations = profile.organisations;
    if (typeof profile.email !== "string") {
      return refuse(REFUSED.noEmail, "github reported no email address");
    }
    if (!Array.isArray(organisations) || organisations.length === 0) {
      // Told apart from plain non-membership on purpose: an empty list is what
      // an organisation that restricts third-party application access looks
      // like until an owner approves the OAuth app, and it refuses every
      // member with no other symptom (ADR-0018).
      return refuse(
        REFUSED.oauthAppNotApproved,
        "github returned no organisations at all — the OAuth app is likely not approved by the organisation",
        { permitted },
      );
    }
    if (!organisations.some((organisation) => permitted.includes(String(organisation).toLowerCase()))) {
      return refuse(
        REFUSED.notPermitted,
        "github account is not a member of any permitted organisation",
        { permitted, organisations },
      );
    }
  };
}

/**
 * Builds the Better Auth instance that owns sessions, password
 * authentication, and external login (ADR-0016).
 *
 * @remarks
 * Every `fields` map below maps Better Auth's camelCase to this repo's
 * snake_case convention, where a column, its TS key, and the wire all agree
 * (docs/data-model.md).
 *
 * @param deps - The database, signing secret, and public URL.
 * @param providers - The enabled Providers whose credentials to configure.
 * Each one's `client_secret` must already be decrypted — `createAuthRegistry`
 * below is what does that, since this function is synchronous and decryption
 * is not (ISSUE-9).
 * @returns The configured Better Auth instance.
 * @example
 * ```ts
 * const auth = createAuth({ db, secret, publicUrl, logger, keys }, enabledProviders);
 * ```
 */
export function createAuth(deps: BetterAuthDependencies, providers: IdentityProviderRow[]) {
  return betterAuth({
    appName: "Skillset",
    secret: deps.secret,
    baseURL: deps.publicUrl,
    basePath: AUTH_BASE_PATH,
    database: { db: deps.db, type: "postgres" },
    // On in every environment, not just production as Better Auth defaults
    // to, and counted in Postgres rather than in process memory (ISSUE-7).
    // The memory store gave one bucket per replica and forgot everything on
    // restart, which is no limit at all on a deployment that has either.
    //
    // The client address it keys on comes from `x-forwarded-for`, which is
    // the only source Better Auth has — and the `clientIp` middleware has
    // already overwritten that header with an address resolved from the
    // socket or a trusted proxy, so what reaches here is not something the
    // caller could choose.
    rateLimit: {
      enabled: deps.rateLimiting !== false,
      storage: "database",
      modelName: "rate_limits",
      fields: { lastRequest: "last_request" },
    },
    socialProviders: socialProvidersFor(providers),
    emailAndPassword: {
      enabled: true,
      // Users come from /setup or from an Admin, and both fix the role. Better
      // Auth's own sign-up would bypass each of them.
      disableSignUp: true,
      // Matches the floor PasswordReplaceSchema enforces on replacement.
      minPasswordLength: 12,
      // argon2id via the runtime's own implementation rather than Better
      // Auth's scrypt, so hashes written before this migration stay verifiable
      // (ADR-0016). Getting it wrong locks out the Superadmin, the only User
      // able to configure a Provider.
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(password, hash),
      },
    },
    session: {
      modelName: "sessions",
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
      fields: {
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    user: {
      modelName: "users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      validateUserInfo: organisationGate(deps.db, deps.logger),
      // Declared so Better Auth carries them on the session's user.
      // `input: false` refuses them structurally from anything a client sends
      // — for `role` that is the ADR-0015 invariant that no login can produce
      // or alter one.
      additionalFields: {
        first_name: { type: "string", required: false, input: false },
        last_name: { type: "string", required: false, input: false },
        role: { type: "string", required: false, input: false },
        must_change_password: { type: "boolean", required: false, input: false },
      },
    },
    account: {
      modelName: "accounts",
      // Still on, and still earning its place: Google and Microsoft tokens land
      // here, and an OAuth token is the only credential the Registry stores that
      // is not one-way. Encrypted at rest with AES-256-GCM under
      // `BETTER_AUTH_SECRET`.
      //
      // A GitHub token no longer lands here at all — the account hook below drops
      // it, because nothing reads it after ADR-0024 and GitHub keeps issuing
      // repo-capable tokens to anyone who once granted that scope.
      //
      // Turning this on does not strand tokens written before it: Better Auth
      // checks whether a stored value even looks encrypted and returns it
      // untouched when it does not, so plaintext rows keep working and are
      // re-encrypted the next time they are written.
      encryptOAuthTokens: true,
      // Without this whole block, "a login whose verified email matches an
      // existing User signs in as that User" (ADR-0015) did not hold for anyone.
      // Better Auth refuses to attach a provider login to an existing row when
      // `requireLocalEmailVerified` — which defaults to *true* — finds the local
      // `email_verified` false, and this Registry never verifies an address
      // itself: the column defaults to false on every User /setup or an Admin
      // creates. So every external login matching an existing User was refused
      // with "account not linked", including the Superadmin's own.
      //
      // Turning it off does not weaken the match. The address being matched is
      // the *Provider's*, asserted in this login and gated above; the local
      // column records something this Registry has no mechanism to establish and
      // no other code reads.
      accountLinking: {
        enabled: true,
        // Derived from the Providers actually configured rather than a fixed
        // list, because whether Entra's word on an address can be trusted
        // depends on how its Provider is gated — see `trustedProvidersFor`.
        // This is why it matters that the instance is rebuilt whenever a
        // Provider changes (ADR-0019): narrowing a Microsoft Provider's
        // tenants has to narrow this too.
        trustedProviders: trustedProvidersFor(providers),
        requireLocalEmailVerified: false,
      },
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "verifications",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    databaseHooks: {
      account: {
        // A GitHub login's tokens are dropped on the way to the database. After
        // ADR-0024 nothing reads them: repository access comes from a Connection
        // granted against a separate GitHub App, and the login is identity only.
        //
        // Dropped rather than merely unrequested, because unrequesting is not
        // enough. Scopes accumulate on a GitHub OAuth App, so everyone who ever
        // granted the repo scope keeps being issued a repo-capable token here
        // however narrow the requested list becomes. An encrypted copy of a
        // credential nobody can use is pure liability in a leaked backup.
        //
        // On both create *and* update: a returning user re-authorizing takes the
        // update path, and leaving that one open would quietly refill the column
        // on the next sign-in.
        create: { before: async (account) => ({ data: withoutGitHubTokens(account) }) },
        update: { before: async (account) => ({ data: withoutGitHubTokens(account) }) },
      },
      user: {
        create: {
          // The only path that creates a User outside this Registry's own
          // services. `role` is pinned to `reader` rather than taken from
          // anything the Provider said (ADR-0015).
          before: async (user) => {
            const claims = user as unknown as Record<string, unknown>;
            const [first, last] = namesFrom(claims, String(user.email ?? ""));
            // `name` is generated from these two halves, so Postgres refuses an
            // insert into it. Set to `undefined` rather than omitted: Better Auth
            // merges this result over its own data (see `withoutGitHubTokens`),
            // so an omitted key is restored, while the adapter skips undefined.
            return {
              data: {
                ...user,
                name: undefined,
                first_name: first,
                last_name: last,
                role: "reader",
                must_change_password: false,
              },
            };
          },
        },
      },
    },
    advanced: {
      database: {
        // Postgres generates every id in this schema with uuidv7(). `false`,
        // not "uuid" — that would be gen_random_uuid(), the v4 function this
        // schema moved away from.
        generateId: false,
      },
    },
    // The same list `hono/csrf` guards every other mutating route with, so
    // "which origins does this Registry trust" has one answer — see
    // lib/origins.ts for why Vite's dev server is on it.
    trustedOrigins: trustedOrigins(deps.publicUrl),
  });
}

/**
 * Nulls a GitHub login's OAuth tokens, leaving every other provider's alone.
 *
 * @remarks
 * Only `github`. Google and Microsoft tokens stay: neither is `repo`-shaped, and
 * no decision has been taken to stop keeping them. `credential` keeps its
 * password, which lives in this same table.
 *
 * The fields are set to `null` rather than deleted, and that is not a style
 * choice — deleting them does nothing at all. Better Auth *merges* what a
 * `before` hook returns over the data it already had:
 * `actualData = { ...actualData, ...result.data }` in `db/with-hooks`. A key
 * this function omitted would simply be restored by that spread, so the hook
 * would read as correct and silently store the token anyway. An explicit null
 * is the only thing that survives the merge.
 *
 * On the update path the hook receives the *payload*, not the row — so the only
 * reason it can tell a GitHub refresh from a Google one is that Better Auth
 * includes `providerId` in that payload: `link-account.mjs` builds it as
 * `{ providerId, idToken, accessToken, refreshToken, ... }`. If that ever stops
 * being true, this hook silently stops firing on re-authorization, which is what
 * `github-login-tokens.test.ts` exists to catch.
 *
 * @param account - The account row Better Auth is about to write, in its own
 * field names, before the map in `createAuth` renames them to columns.
 * @returns The row to write, with a GitHub login's tokens nulled.
 * @example
 * ```ts
 * create: { before: async (account) => ({ data: withoutGitHubTokens(account) }) }
 * ```
 */
function withoutGitHubTokens<T extends { providerId?: string }>(account: T): T {
  if (account.providerId !== "github") return account;

  return {
    ...account,
    accessToken: null,
    refreshToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
  };
}

/** The Better Auth instance's type, for the dependencies that carry one. */
export type Auth = ReturnType<typeof createAuth>;

/**
 * Holds the Better Auth instance and rebuilds it when a Provider's
 * credentials change (ADR-0019).
 *
 * @remarks
 * `current` and `fresh` differ only in whether they check the version key.
 * Validating a session does not depend on which Providers are configured, so
 * ordinary requests serve from the cache and pay nothing for the table; only
 * Better Auth's own routes need the round-trip.
 *
 * A cached instance can be stale in its credentials and nothing else — the
 * organisation gate and the enabled flag are read per login — so the worst it
 * can do is fail a login through a just-added Provider. It can never admit
 * someone a disabled Provider should have refused.
 */
export interface AuthRegistry {
  /** The cached instance, built on first use. No freshness check. */
  current(): Promise<Auth>;
  /** The instance for the current Provider configuration, rebuilt if stale. */
  fresh(): Promise<Auth>;
}

/**
 * Creates the registry that owns the Better Auth instance's lifecycle.
 *
 * @param deps - The database, signing secret, and public URL.
 * @returns An `AuthRegistry`.
 * @example
 * ```ts
 * const registry = createAuthRegistry({ db, secret, publicUrl });
 * const auth = await registry.fresh();
 * ```
 */
export function createAuthRegistry(deps: BetterAuthDependencies): AuthRegistry {
  let cached: { key: string; auth: Auth } | null = null;

  // Row count and latest edit together cover every way the table can change:
  // adding a Provider moves the count, editing or disabling one moves the
  // timestamp. There is no delete route (ADR-0015).
  async function version(): Promise<string> {
    const row = await deps.db
      .selectFrom("identity_providers")
      .select((eb) => [eb.fn.countAll<number>().as("total"), eb.fn.max("updated_at").as("latest")])
      .executeTakeFirstOrThrow();
    return `${row.total}:${row.latest?.getTime() ?? 0}`;
  }

  async function build(key: string): Promise<Auth> {
    const rows = await deps.db.selectFrom("identity_providers").selectAll().where("enabled", "=", true).execute();
    // The column holds ciphertext (ISSUE-9), and what Better Auth needs is
    // the credential itself. Decrypted here rather than in `createAuth`
    // because that one is synchronous — and here is also where the rebuild
    // already happens, so a rotated secret is picked up with the rest of the
    // Provider's configuration (ADR-0019).
    const providers = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        client_secret: await openClientSecret(deps.keys.clientSecrets, row.client_secret),
      })),
    );
    const auth = createAuth(deps, providers);
    cached = { key, auth };
    return auth;
  }

  return {
    async current() {
      return cached?.auth ?? (await build(await version()));
    },
    async fresh() {
      const key = await version();
      if (cached?.key === key) return cached.auth;
      return build(key);
    },
  };
}
