import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import {
  gitProviderConfig,
  isGitProvider,
  type ConnectableProvider,
  type GitProviderOAuth,
} from "@skillset/shared";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { firstRow } from "../../db/rows.js";
import { connections, type ConnectionRow, type IntegrationRow, type UserRow } from "../../db/schemas/index.js";
import { ConnectionDeclinedError, ConnectionExchangeFailedError, ConnectionExpiredError, ConnectionNotFoundError, ConnectionStateInvalidError, IntegrationChoiceRequiredError, NotConnectedError, ProviderNotConnectableError } from "./connections.errors.js";
import { IntegrationNotConfiguredError } from "../integrations/integrations.errors.js";
import type { Logger } from "../../lib/logger.js";
import type { IntegrationsService } from "../integrations/integrations.service.js";

/** How long a writer has to complete an authorization once they have started it. */
const STATE_TTL_MS = 5 * 60_000;

/**
 * How close to expiry an access token is refreshed at.
 *
 * @remarks
 * Refreshed *before* it expires, not after. A token that dies part-way through
 * a folder walk is a failure that refreshing thirty seconds earlier would have
 * avoided, and the walk is not resumable.
 */
const REFRESH_MARGIN_MS = 60_000;

/** Providers ask that a caller identify itself. */
const USER_AGENT = "skillset";

/**
 * One Connection as the list route reports it.
 *
 * @remarks
 * Timestamps are `Date`s here, not strings: the row is normalised on the way
 * out by `ConnectionListSchema`, the same way every other resource shapes its
 * response. There is no token field, and no variant of this shape has one.
 */
export interface ConnectionListing {
  provider: string;
  /** Which Integration (app) this grant was issued through (ADR-0025). */
  integration_id: string;
  external_account_login: string;
  created_at: Date;
  updated_at: Date;
}

/** What `/start` needs to send a writer on their way, and to remember the trip. */
export interface StartedAuthorization {
  /** Where to send the writer: the provider's installation page. */
  redirect_to: string;
  /** The signed state, also embedded in `redirect_to`. Returned for tests and logging. */
  state: string;
  /** The nonce to put in the writer's browser and require back on the callback. */
  nonce: string;
}

/** What the callback carries back, once the route has pulled it apart. */
export interface CompletionAttempt {
  code: string | undefined;
  state: string | undefined;
  /** From the browser's own cookie, which is what makes the state single-use. */
  nonce: string | undefined;
  /**
   * The provider's own `error` parameter, when it declined rather than issuing
   * a code — `access_denied` being the writer pressing Cancel.
   *
   * Carried so that case gets its own message. Reporting a decision the writer
   * made as an unverifiable attempt reads as a security failure and sends them
   * to retry the thing they just refused.
   */
  error: string | undefined;
}

/** The state's payload, kept short because it travels in a URL. */
interface StatePayload {
  /** Provider. */
  p: string;
  /** The Integration (app) chosen to connect through (ADR-0025). */
  i: string;
  /** The User it was minted for. */
  u: string;
  /** Nonce, matched against the browser's cookie. */
  n: string;
  /** Expiry, epoch milliseconds. */
  e: number;
}

/** A token response, as both the code exchange and the refresh return one. */
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
}

/**
 * Connections: a writer's own grant of repository access, and the OAuth dance
 * that produces one (ADR-0024).
 *
 * @remarks
 * Better Auth is deliberately not involved. It models accounts and identities,
 * and a Connection is neither — nobody signs in by connecting, the connected
 * account need not be the one the writer signs in with, and the Permitted
 * Organisation gate does not run on it. Reaching for `genericOAuth` is what
 * pushed the previous design into storing a repository credential in the
 * authentication table.
 *
 * What is left, then, is a signed state, a form POST, and a row.
 */
export class ConnectionsService {
  constructor(
    private readonly db: Database,
    /** Better Auth's signing secret: what the state is signed with and the tokens encrypted under. */
    private readonly secret: string,
    private readonly logger: Logger,
    private readonly integrations: IntegrationsService,
    /** Injected so a test can move it; the state's expiry is otherwise unreachable. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Begins a Connection: where to send the writer, and what to remember.
   *
   * @remarks
   * The writer goes to the provider's plain **authorize** endpoint, which
   * mints a code whether or not the app is already installed. The installation
   * page it replaced could not: GitHub issues a code there only on a *first*
   * install, and every later visit lands on its update-permissions screen and
   * returns none — so a writer who had already installed the app could never
   * reconnect, and got an unverifiable-attempt refusal instead (ADR-0024).
   *
   * Choosing repositories is therefore a separate trip, offered as
   * `manage_access_url` on `connectableProviders`. That is the real cost of
   * this design, and it buys a connect flow that works in every install state.
   *
   * The returned `nonce` is not part of the state's secrecy; it is what makes
   * the state single-use. The caller puts it in an httpOnly cookie and hands it
   * back on the callback, so a state lifted from a log or a referrer is useless
   * in another browser.
   *
   * @param user - The writer connecting. The state is bound to them, so a state
   * minted for one User cannot complete in another's session.
   * @param provider - The Git Provider to connect.
   * @param integrationId - Which Integration (app) to connect through, when the
   * provider has more than one (ADR-0025). Omit when it has exactly one — there
   * is nothing to choose, so none is required.
   * @returns Where to redirect, the state, and the nonce to store.
   * @throws ProviderNotConnectableError if that provider has no credentialed
   * flow at all — GitLab is public-read only, and no configuration changes it.
   * @throws IntegrationNotConfiguredError if no Integration is configured for it.
   * @throws IntegrationChoiceRequiredError if more than one Integration is
   * configured for it and `integrationId` was not given.
   * @example
   * ```ts
   * const { redirect_to, nonce } = await connections.start(user, "github");
   * setCookie(c, STATE_COOKIE, nonce, { httpOnly: true, sameSite: "Lax" });
   * return c.redirect(redirect_to, 302);
   * ```
   */
  async start(user: UserRow, provider: string, integrationId?: string): Promise<StartedAuthorization> {
    const { oauth, integration } = await this.connectable(provider, integrationId);

    const nonce = randomBytes(24).toString("base64url");
    const state = this.signState({
      p: provider,
      i: integration.id,
      u: user.id,
      n: nonce,
      e: this.now().getTime() + STATE_TTL_MS,
    });

    // No app slug is needed here — that is the installation page's business,
    // not the authorize endpoint's, so a missing slug no longer blocks
    // connecting. It still blocks choosing repositories, which is where the
    // writer is told about it.
    const url = new URL(oauth.authorize_url);
    url.searchParams.set("client_id", integration.client_id);
    url.searchParams.set("state", state);

    this.logger.info({ user_id: user.id, provider }, "connection authorization started");
    return { redirect_to: url.href, state, nonce };
  }

  /**
   * Completes a Connection from the provider's callback.
   *
   * @remarks
   * The state is verified and the nonce matched **before anything else** — no
   * database read, no outbound request. This is the CSRF surface of the flow:
   * without it, an attacker could walk a victim's browser through their own
   * authorization and attach their GitHub account to the victim's Registry
   * account.
   *
   * The exchange spends the Integration's own credential pair. Nothing a caller
   * supplied reaches a URL: the token endpoint is a pinned constant per
   * provider, and redirects are not followed (ADR-0020).
   *
   * Upserts on `(user_id, provider)`, so reconnecting replaces rather than
   * accumulating and "which account does this Import use?" never needs asking.
   * Reconnecting through a *different* Integration for the same provider
   * repoints `integration_id` too — there is still only one active Connection
   * per provider at a time (ADR-0025).
   *
   * @param user - The writer whose session the callback arrived in.
   * @param provider - The Git Provider named in the path.
   * @param attempt - The `code`, `state` and `error` from the query, and the
   * `nonce` from the browser's cookie.
   * @param fetchImpl - The `fetch` to reach the provider with. Defaults to the
   * global one; tests pass a fake so no request leaves the process.
   * @returns The stored Connection.
   * @throws ConnectionStateInvalidError if the state is missing, tampered with,
   * expired, for another provider, minted for another User, or its nonce does
   * not match the browser's — all one refusal, because saying which check
   * failed tells an attacker what to fix. Also when the provider returned
   * neither a code nor an error, which is a malformed callback.
   * @throws ConnectionDeclinedError if the provider reported that the writer
   * refused the authorization.
   * @throws ProviderNotConnectableError if the provider has no credentialed flow.
   * @throws IntegrationNotConfiguredError if its Integration has gone away
   * between starting and finishing.
   * @throws ConnectionExchangeFailedError if the provider refuses the exchange,
   * returns an error in place of a token, or will not identify the account.
   * @example
   * ```ts
   * const connection = await connections.complete(user, "github", { code, state, nonce });
   * ```
   */
  async complete(
    user: UserRow,
    provider: string,
    attempt: CompletionAttempt,
    fetchImpl?: typeof fetch,
  ): Promise<ConnectionRow> {
    const payload = this.verifyState(user, provider, attempt);

    if (attempt.error) {
      this.logger.info({ user_id: user.id, provider, error: attempt.error }, "connection declined at the provider");
      throw new ConnectionDeclinedError(provider);
    }
    if (!attempt.code) {
      // Logged because it is otherwise invisible: this used to throw silently,
      // and diagnosing it meant inferring from the *absence* of a log line.
      this.logger.warn({ user_id: user.id, provider }, "connection callback carried neither a code nor an error");
      throw new ConnectionStateInvalidError();
    }

    // The Integration is the one chosen and signed into the state at `start`
    // time — not re-resolved from `provider` alone, which could now be
    // ambiguous between several apps (ADR-0025).
    const { oauth, integration } = await this.connectable(provider, payload.i);
    const tokens = await this.exchange(
      oauth,
      integration,
      { code: attempt.code },
      provider,
      fetchImpl ?? globalThis.fetch,
    );
    const account = await this.readAccount(provider, tokens.access_token, fetchImpl ?? globalThis.fetch);

    // Encrypted once and spread into both branches: computing it twice would
    // write two different ciphertexts for the same secret, which is confusing
    // to anyone reading a stored row against this query.
    const grant = await this.grantColumns(tokens);
    const rows = await this.db
      .insert(connections)
      .values({
        user_id: user.id,
        provider,
        integration_id: integration.id,
        external_account_id: account.id,
        external_account_login: account.login,
        ...grant,
      })
      .onConflictDoUpdate({
        target: [connections.user_id, connections.provider],
        set: {
          integration_id: integration.id,
          external_account_id: account.id,
          external_account_login: account.login,
          ...grant,
          updated_at: this.now(),
        },
      })
      .returning();
    const row = firstRow(rows, "Connection upsert");

    this.logger.info(
      { user_id: user.id, provider, external_account_login: account.login },
      "connection granted",
    );
    return row;
  }

  /**
   * The caller's own Connections, oldest first.
   *
   * @remarks
   * Projected in the query rather than filtered afterwards, so no token can
   * reach a response even by mistake. There is no Admin variant of this that
   * returns one either — the tokens exist only for the Registry to spend.
   *
   * @param userId - The User whose Connections to list.
   * @returns One entry per Connection: provider, which Integration it was
   * granted through, connected account, timestamps.
   * @example
   * ```ts
   * const items = await connections.listForUser(user.id);
   * ```
   */
  async listForUser(userId: string): Promise<ConnectionListing[]> {
    return this.db
      .select({
        provider: connections.provider,
        integration_id: connections.integration_id,
        external_account_login: connections.external_account_login,
        created_at: connections.created_at,
        updated_at: connections.updated_at,
      })
      .from(connections)
      .where(eq(connections.user_id, userId))
      .orderBy(asc(connections.created_at));
  }

  /**
   * The Integrations a writer could connect through on this Registry.
   *
   * @remarks
   * One entry per Integration, not per Git Provider (ADR-0025): a provider
   * with two configured apps offers two entries, and the interface lets the
   * writer pick between them. An Integration whose provider has no
   * credentialed flow is left out, so a GitLab Integration — which is legal,
   * and useful for nothing here — never produces a Connect button that could
   * only fail (ADR-0024).
   *
   * Carries no credential. `display_name` comes from the Integration an Admin
   * named, so the button says what they called it.
   *
   * `manage_access_url` is built here because it needs the Integration's app
   * slug and `GET /integrations` is Admin-only, leaving a writer no other way
   * to reach the page where repositories are chosen. It is null when no slug is
   * configured, which the interface must render as "ask an Admin" rather than
   * as a dead link.
   *
   * @returns One entry per connectable Integration, oldest first.
   * @example
   * ```ts
   * const connectable = await connections.connectableProviders();
   * ```
   */
  async connectableProviders(): Promise<ConnectableProvider[]> {
    const configured = await this.integrations.list();
    return configured
      .filter((integration) => gitProviderConfig(integration.provider).oauth !== null)
      .map((integration) => ({
        id: integration.id,
        provider: integration.provider,
        display_name: integration.display_name,
        app_slug: integration.app_slug,
        manage_access_url: this.manageAccessUrl(integration),
      }));
  }

  /**
   * Where a writer chooses which repositories the Registry may read.
   *
   * @remarks
   * Null rather than a guess when the Integration carries no app slug:
   * substituting an empty one yields `https://github.com/apps//installations/new`
   * and a provider 404 nobody can diagnose.
   */
  private manageAccessUrl(integration: IntegrationRow): string | null {
    const template = gitProviderConfig(integration.provider).oauth?.install_url_template;
    if (!template) return null;
    if (template.includes("{app_slug}") && !integration.app_slug) return null;
    return template.replace("{app_slug}", integration.app_slug ?? "");
  }

  /**
   * Withdraws the Registry's use of a Connection.
   *
   * @remarks
   * Registry-local, and the copy shown to the writer must say so: this stops
   * *this Registry* using the grant, and does not withdraw it at the provider.
   * Claiming otherwise would be untrue, and the honesty constraint is the one
   * thing about this route easy to lose in review.
   *
   * Deletes the Connection and nothing else — in particular it does not touch
   * the writer's sign-in account, so revoking repository access can never lock
   * anyone out.
   *
   * @param userId - The User disconnecting.
   * @param provider - The Git Provider to disconnect.
   * @throws ConnectionNotFoundError if they hold no Connection to it.
   * @example
   * ```ts
   * await connections.disconnect(user.id, "github");
   * ```
   */
  async disconnect(userId: string, provider: string): Promise<void> {
    const deleted = await this.db
      .delete(connections)
      .where(and(eq(connections.user_id, userId), eq(connections.provider, provider)))
      .returning({ id: connections.id });

    if (deleted.length === 0) throw new ConnectionNotFoundError();
    this.logger.info({ user_id: userId, provider }, "connection disconnected");
  }

  /**
   * A usable access token for a writer's Connection, refreshed if it is about
   * to expire.
   *
   * @remarks
   * Read from the database on every call rather than cached, so disconnecting
   * or reconnecting takes effect on the very next Import.
   *
   * A refresh token past its own expiry is not sent to the provider at all —
   * it would be refused, and asking spends a request to learn what the column
   * already said.
   *
   * @param userId - The User whose Connection to spend.
   * @param provider - The Git Provider to get a token for.
   * @param fetchImpl - The `fetch` to refresh with. Defaults to the global one.
   * @returns A decrypted access token, good for at least the refresh margin.
   * @throws NotConnectedError if they hold no Connection — the remedy is to
   * connect, which is theirs to take.
   * @throws ConnectionExpiredError if the grant can no longer be refreshed. Its
   * message says *reconnect*, never "sign in again": the token stopped coming
   * from the login, so signing in refreshes nothing.
   * @throws IntegrationNotConfiguredError if the Integration has been removed.
   * @example
   * ```ts
   * const token = await connections.accessTokenFor(user.id, "github");
   * const files = await readSkillFolder(location, { token });
   * ```
   */
  async accessTokenFor(userId: string, provider: string, fetchImpl?: typeof fetch): Promise<string> {
    const [row] = await this.db
      .select()
      .from(connections)
      .where(and(eq(connections.user_id, userId), eq(connections.provider, provider)))
      .limit(1);
    if (!row) throw new NotConnectedError(provider);

    const stillGood =
      row.expires_at === null || row.expires_at.getTime() - this.now().getTime() > REFRESH_MARGIN_MS;
    if (stillGood) return this.decrypt(row.access_token);

    return this.refresh(row, provider, fetchImpl ?? globalThis.fetch);
  }

  /**
   * Exchanges a refresh token for a new grant and stores it.
   *
   * @throws ConnectionExpiredError if there is no refresh token, it has expired,
   * or the provider refuses it. The Connection is left in place either way — a
   * writer's record of what they granted is not ours to delete on their behalf.
   */
  private async refresh(row: ConnectionRow, provider: string, fetchImpl: typeof fetch): Promise<string> {
    const expired =
      row.refresh_token_expires_at !== null && row.refresh_token_expires_at.getTime() <= this.now().getTime();
    if (!row.refresh_token || expired) {
      this.logger.info(
        { user_id: row.user_id, provider, reason: row.refresh_token ? "refresh_token_expired" : "no_refresh_token" },
        "connection cannot be refreshed",
      );
      throw new ConnectionExpiredError(provider);
    }

    // Refreshed against the app the grant was actually issued through
    // (ADR-0025) — a sibling Integration for the same provider would hold a
    // different client secret and could not refresh this token.
    const integration = await this.integrations.findById(row.integration_id);
    if (!integration) throw new IntegrationNotConfiguredError(provider);
    const oauth = gitProviderConfig(provider).oauth;
    if (!oauth) throw new ProviderNotConnectableError(provider);

    let tokens: { access_token: string } & TokenResponse;
    try {
      tokens = await this.exchange(
        oauth,
        integration,
        { grant_type: "refresh_token", refresh_token: await this.decrypt(row.refresh_token) },
        provider,
        fetchImpl,
      );
    } catch (cause) {
      // Only a *refusal* means the grant is spent. A network failure, a DNS
      // problem, or a timeout would otherwise tell the writer to reconnect —
      // advice that cannot help, and that fails again for the same reason.
      if (!(cause instanceof ConnectionExchangeFailedError)) throw cause;
      this.logger.info({ user_id: row.user_id, provider }, "connection refresh refused by the provider");
      throw new ConnectionExpiredError(provider);
    }

    // Carried over rather than nulled: a provider that does not rotate its
    // refresh token omits the field, and overwriting the stored one with null
    // would destroy a working credential and leave the Connection unable to
    // refresh ever again.
    await this.db
      .update(connections)
      .set({
        ...(await this.grantColumns(tokens, row)),
        updated_at: this.now(),
      })
      .where(eq(connections.id, row.id));

    return tokens.access_token;
  }

  /**
   * Posts to the provider's token endpoint.
   *
   * @throws ConnectionExchangeFailedError if the response is not 2xx, or is 2xx
   * but carries an error in place of a token — which is how GitHub answers a
   * bad code, so checking the status alone would let it through.
   */
  private async exchange(
    oauth: GitProviderOAuth,
    integration: IntegrationRow,
    grant: Record<string, string>,
    provider: string,
    fetchImpl: typeof fetch,
  ): Promise<{ access_token: string } & TokenResponse> {
    const res = await fetchImpl(oauth.token_url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": USER_AGENT,
      },
      body: new URLSearchParams({
        client_id: integration.client_id,
        client_secret: integration.client_secret,
        ...grant,
      }).toString(),
      // A pinned host that follows a redirect is not a pinned host.
      redirect: "manual",
    });
    if (!res.ok) throw new ConnectionExchangeFailedError(provider);

    // A 2xx carrying something other than JSON is a proxy or an incident page,
    // not a token — and it must map to the same refusal as an error body rather
    // than escaping as an unhandled parse failure.
    let body: TokenResponse;
    try {
      body = (await res.json()) as TokenResponse;
    } catch {
      throw new ConnectionExchangeFailedError(provider);
    }
    if (!body.access_token) throw new ConnectionExchangeFailedError(provider);
    return { ...body, access_token: body.access_token };
  }

  /**
   * Reads which account the new token belongs to.
   *
   * @throws ConnectionExchangeFailedError if the provider will not identify it.
   * A grant we cannot name is one a writer could never make sense of in
   * settings.
   */
  private async readAccount(
    provider: string,
    token: string,
    fetchImpl: typeof fetch,
  ): Promise<{ id: string; login: string }> {
    const res = await fetchImpl(`${gitProviderConfig(provider).api_base}/user`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}`, "user-agent": USER_AGENT },
      redirect: "manual",
    });
    if (!res.ok) throw new ConnectionExchangeFailedError(provider);

    const body = (await res.json()) as { id?: number | string; login?: string };
    if (body.id === undefined || !body.login) throw new ConnectionExchangeFailedError(provider);
    return { id: String(body.id), login: body.login };
  }

  /**
   * The grant's columns, encrypted, from a token response.
   *
   * @remarks
   * A provider that reports no `expires_in` on a *first* grant has issued a
   * token that does not expire — a GitHub App with expiry switched off does
   * exactly that — so the expiry columns go null rather than being invented.
   * Null means "never", and is why they are nullable at all.
   *
   * On a *refresh*, an omitted field means "unchanged" rather than "none":
   * pass `existing` so a provider that does not rotate its refresh token
   * keeps the one it issued, instead of having a working credential nulled and
   * the Connection left unable to refresh again.
   *
   * @param tokens - The provider's token response.
   * @param existing - The row being refreshed, whose values fill anything the
   * response omitted. Absent on a first grant, where there is nothing to keep.
   */
  private async grantColumns(tokens: TokenResponse & { access_token: string }, existing?: ConnectionRow) {
    const now = this.now().getTime();
    return {
      access_token: await symmetricEncrypt({ key: this.secret, data: tokens.access_token }),
      refresh_token: tokens.refresh_token
        ? await symmetricEncrypt({ key: this.secret, data: tokens.refresh_token })
        : (existing?.refresh_token ?? null),
      expires_at: tokens.expires_in
        ? new Date(now + tokens.expires_in * 1_000)
        : (existing?.expires_at ?? null),
      refresh_token_expires_at: tokens.refresh_token_expires_in
        ? new Date(now + tokens.refresh_token_expires_in * 1_000)
        : (existing?.refresh_token_expires_at ?? null),
    };
  }

  /**
   * The provider's credentialed flow and the Integration to use, or a refusal.
   *
   * @remarks
   * More than one Integration may exist for the provider (ADR-0025). When
   * `integrationId` is given, it is resolved directly and checked against the
   * provider — this is how `complete` re-resolves the exact app chosen at
   * `start`, from the signed state, with no ambiguity possible. When it is
   * omitted, every Integration for the provider is considered: none is an
   * unconfigured provider, exactly one is used with nothing to choose, and more
   * than one cannot be resolved without asking.
   *
   * @param integrationId - The Integration to use, when known already.
   * @throws ProviderNotConnectableError if the provider has no credentialed
   * flow — told apart from an unconfigured Integration because no Admin can
   * fix it, so sending the writer to ask one would be an errand that cannot
   * succeed.
   * @throws IntegrationNotConfiguredError if no Integration is configured for
   * the provider, or `integrationId` names one that does not exist or belongs
   * to a different provider.
   * @throws IntegrationChoiceRequiredError if more than one Integration is
   * configured for the provider and `integrationId` was not given.
   */
  private async connectable(
    provider: string,
    integrationId?: string,
  ): Promise<{ oauth: GitProviderOAuth; integration: IntegrationRow }> {
    // Guarded before `gitProviderConfig`, which throws a plain `Error` for an
    // unknown name and would surface as a 500. The provider here is a path
    // parameter, so an unknown one is a client error.
    if (!isGitProvider(provider)) throw new ProviderNotConnectableError(provider);

    const oauth = gitProviderConfig(provider).oauth;
    if (!oauth) throw new ProviderNotConnectableError(provider);

    if (integrationId !== undefined) {
      const integration = await this.integrations.findById(integrationId);
      if (!integration || integration.provider !== provider) {
        throw new IntegrationNotConfiguredError(provider);
      }
      return { oauth, integration };
    }

    const configured = await this.integrations.listByProvider(provider);
    if (configured.length === 0) throw new IntegrationNotConfiguredError(provider);
    if (configured.length > 1) throw new IntegrationChoiceRequiredError(provider);

    return { oauth, integration: configured[0] as IntegrationRow };
  }

  /**
   * The Integration a writer's Connection to a provider was granted through,
   * or `undefined` if they hold none.
   *
   * @remarks
   * Exists for diagnosis, not for the connect flow itself — an Import that
   * fails because the app is not installed on a project's owner needs *that
   * specific app's* slug to build an install link (ADR-0025), not an arbitrary
   * Integration configured for the provider, which might be a different app
   * with a different slug.
   *
   * @param userId - The User whose Connection to inspect.
   * @param provider - The Git Provider to look under.
   * @returns The Integration, or `undefined` if there is no Connection or its
   * Integration has since been removed.
   * @example
   * ```ts
   * const integration = await connections.integrationFor(user.id, "github");
   * ```
   */
  async integrationFor(userId: string, provider: string): Promise<IntegrationRow | undefined> {
    const [row] = await this.db
      .select({ integration_id: connections.integration_id })
      .from(connections)
      .where(and(eq(connections.user_id, userId), eq(connections.provider, provider)))
      .limit(1);
    if (!row) return undefined;

    return this.integrations.findById(row.integration_id);
  }

  /** Signs a state payload, url-safe and compact enough to travel in a query. */
  private signState(payload: StatePayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${this.sign(body)}`;
  }

  /**
   * Verifies a callback's state against the caller and their browser.
   *
   * @returns The state's payload, once every check has passed — in particular
   * `i`, the Integration chosen at `start` time, which is how `complete`
   * resolves the same app without asking the caller to name it again.
   * @throws ConnectionStateInvalidError on any failure. One error for all of
   * them on purpose: naming the failed check tells an attacker which part of
   * their forgery to fix, so the specific cause goes to the log instead.
   */
  private verifyState(user: UserRow, provider: string, attempt: CompletionAttempt): StatePayload {
    const refuse = (reason: string) => {
      this.logger.info({ user_id: user.id, provider, reason }, "refused a connection callback");
      return new ConnectionStateInvalidError();
    };

    if (!attempt.state) throw refuse("no_state");
    const [body, signature] = attempt.state.split(".");
    if (!body || !signature) throw refuse("malformed_state");

    const expected = this.sign(body);
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected))) {
      throw refuse("bad_signature");
    }

    let payload: StatePayload;
    try {
      payload = JSON.parse(Buffer.from(body, "base64url").toString()) as StatePayload;
    } catch {
      throw refuse("unparseable_state");
    }

    if (payload.p !== provider) throw refuse("provider_mismatch");
    if (payload.u !== user.id) throw refuse("user_mismatch");
    if (payload.e <= this.now().getTime()) throw refuse("expired");
    // The nonce is what makes the state single-use: it lives in an httpOnly
    // cookie the route clears on every callback, so a replayed state — or one
    // lifted from a log and opened in another browser — has nothing to match.
    if (!attempt.nonce || attempt.nonce !== payload.n) throw refuse("nonce_mismatch");

    return payload;
  }

  /** HMAC-SHA256 over the state's body, hex, under the signing secret. */
  private sign(body: string): string {
    return createHmac("sha256", this.secret).update(body).digest("hex");
  }

  /** Decrypts a stored token. Every row this table holds was written encrypted. */
  private decrypt(stored: string): Promise<string> {
    return symmetricDecrypt({ key: this.secret, data: stored });
  }
}
