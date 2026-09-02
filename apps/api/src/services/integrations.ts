import {
  gitProviderConfig,
  isGitProvider,
  type IntegrationCreate,
  type IntegrationUpdate,
} from "@skill-registry/shared";
import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { isUniqueViolation } from "../db/pg-errors.js";
import { connections, integrations, type IntegrationRow } from "../db/schemas/index.js";
import { IntegrationNotFoundError, IntegrationProviderTakenError, ValidationError } from "../http/errors.js";
import type { Logger } from "../logger.js";

/**
 * Refuses an Integration for a provider whose installation URL needs an app
 * slug, when none is given.
 *
 * @remarks
 * Without this, a GitHub Integration can be saved with no slug and
 * `/connections/github/start` would redirect a writer to
 * `https://github.com/apps//installations/new` — a provider 404 they cannot
 * diagnose. Refusing at configuration time makes that state unreachable rather
 * than merely defended against, and puts the message in front of the Admin who
 * can act on it.
 *
 * A provider with no credentialed flow, or whose install URL carries no
 * `{app_slug}` placeholder, needs none and is left alone. So is one this
 * Registry does not know: `update` passes a raw path parameter, and refusing
 * here would turn an unknown provider into a 500 instead of the 404 the update
 * itself produces.
 *
 * @param provider - The Git Provider being configured.
 * @param appSlug - The slug given, or null.
 * @throws ValidationError if that provider's installation URL needs a slug and
 * none was supplied.
 * @example
 * ```ts
 * assertAppSlugPresent("github", null); // throws
 * assertAppSlugPresent("gitlab", null); // passes: no credentialed flow
 * ```
 */
function assertAppSlugPresent(provider: string, appSlug: string | null): void {
  if (!isGitProvider(provider)) return;

  const template = gitProviderConfig(provider).oauth?.install_url_template;
  if (!template?.includes("{app_slug}") || appSlug) return;

  throw new ValidationError(
    `${gitProviderConfig(provider).display_name} needs an app slug: it is what its installation URL is built from.`,
    "app_slug",
  );
}

/**
 * Configured Integrations: the Registry's registrations with Git Providers
 * (ADR-0024).
 *
 * @remarks
 * There is no `listEnabled` counterpart and no public shape. An Identity
 * Provider needs one because it draws a button on an unauthenticated login
 * page; an Integration draws nothing, and its mere existence is what makes
 * Importing available — so the only reader is an Admin, and the import service
 * asking whether a row exists.
 */
export class IntegrationsService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /**
   * Every configured Integration, oldest first — the Admin's view.
   *
   * @remarks
   * Rows carry `client_secret`, so callers must shape the response through
   * `IntegrationSchema`, which has no such field.
   */
  async list(): Promise<IntegrationRow[]> {
    return this.db.select().from(integrations).orderBy(asc(integrations.created_at));
  }

  /**
   * The Integration for a Git Provider, or `undefined` when none is
   * configured.
   *
   * @remarks
   * Read per use rather than cached, so creating or editing an Integration
   * takes effect on the next request with no restart (ADR-0019). A missing row
   * is the answer "Importing is not available for this provider", which is a
   * configuration and not an error — hence `undefined` rather than a throw.
   *
   * @param provider - The Git Provider name.
   * @returns The row, including its `client_secret`, or `undefined`.
   * @example
   * ```ts
   * const integration = await integrations.find("github");
   * if (!integration) throw new IntegrationNotConfiguredError("github");
   * ```
   */
  async find(provider: string): Promise<IntegrationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(integrations)
      .where(eq(integrations.provider, provider))
      .limit(1);
    return row;
  }

  /**
   * Registers a Git Provider with this Registry.
   *
   * @remarks
   * Creating the row is what makes Importing available for that provider —
   * there is no separate switch, deliberately (ADR-0024). An operator who
   * wants this Registry to hold no repository credentials for anybody does not
   * create the row, and that is the off switch.
   *
   * @param input - The provider, display name, credential pair, and app slug.
   * @returns The created row, including its `client_secret`.
   * @throws IntegrationProviderTakenError if that Git Provider already has an
   * Integration.
   * @throws ValidationError if the provider's installation URL is built from an
   * app slug and none was supplied.
   * @example
   * ```ts
   * const integration = await integrations.create({
   *   provider: "github",
   *   display_name: "GitHub",
   *   client_id: "Iv1.…",
   *   client_secret: "…",
   *   app_slug: "acme-skill-registry",
   * });
   * ```
   */
  async create(input: IntegrationCreate): Promise<IntegrationRow> {
    assertAppSlugPresent(input.provider, input.app_slug ?? null);

    try {
      const [created] = await this.db
        .insert(integrations)
        .values({
          provider: input.provider,
          display_name: input.display_name,
          client_id: input.client_id,
          client_secret: input.client_secret,
          app_slug: input.app_slug ?? null,
        })
        .returning();
      if (!created) throw new Error("Insert did not return the created Integration.");

      this.logger.info(
        { provider: created.provider },
        "integration created — importing is now available for this git provider",
      );
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) throw new IntegrationProviderTakenError();
      throw error;
    }
  }

  /**
   * Changes an Integration's configuration.
   *
   * @remarks
   * `provider` cannot be changed: it is the Integration's identity, so
   * altering it would repoint an existing registration rather than create a
   * new one. Omitting `client_secret` leaves the stored one untouched, which
   * is what lets an Admin edit an Integration without being shown its secret.
   *
   * `app_slug` distinguishes absent from `null` — absent leaves whatever is
   * stored, `null` clears it — because clearing it is a real intent and not
   * the same as declining to say.
   *
   * Changing `client_id` repoints the Integration at a **different app**, which
   * silently invalidates every Connection held against it: those tokens were
   * issued to the old app's client and the new one cannot refresh them. So they
   * are deleted in the same transaction. Leaving them would show writers
   * "connected as …" while every Import failed, with a reconnect prompt they
   * had no reason to trust.
   *
   * Rotating `client_secret` alone does **not** clear them — a secret belongs
   * to the app, not to the grant, so existing tokens stay valid and dropping
   * them would cost every writer a reconnection for nothing.
   *
   * @param provider - The Git Provider whose Integration to change.
   * @param input - The fields to change; anything absent is left as it is.
   * @returns The updated row.
   * @throws IntegrationNotFoundError if that Git Provider has no Integration.
   * @throws ValidationError if clearing `app_slug` would leave a provider whose
   * installation URL is built from one without it.
   * @example
   * ```ts
   * // Rotating a secret keeps every Connection.
   * await integrations.update("github", { client_secret: "…" });
   * // Pointing at another app drops them all; writers must reconnect.
   * await integrations.update("github", { client_id: "Iv23li…", client_secret: "…" });
   * ```
   */
  async update(provider: string, input: IntegrationUpdate): Promise<IntegrationRow> {
    // Checked here rather than in the request schema: `provider` is a path
    // parameter, so Zod cannot see which provider the body is being applied to.
    if (input.app_slug === null) assertAppSlugPresent(provider, null);

    return this.db.transaction(async (tx) => {
      // Read before writing, and inside the transaction: `RETURNING` reports
      // the row as it now is, and telling a repoint from a no-op re-save of
      // the same value needs the `client_id` as it was.
      const [existing] = await tx
        .select({ client_id: integrations.client_id })
        .from(integrations)
        .where(eq(integrations.provider, provider))
        .limit(1);
      if (!existing) throw new IntegrationNotFoundError();

      const [updated] = await tx
        .update(integrations)
        .set({
          ...(input.display_name !== undefined ? { display_name: input.display_name } : {}),
          ...(input.client_id !== undefined ? { client_id: input.client_id } : {}),
          ...(input.client_secret !== undefined ? { client_secret: input.client_secret } : {}),
          ...(input.app_slug !== undefined ? { app_slug: input.app_slug } : {}),
          updated_at: new Date(),
        })
        .where(eq(integrations.provider, provider))
        .returning();
      if (!updated) throw new IntegrationNotFoundError();

      this.logger.info({ provider: updated.provider }, "integration updated");

      if (input.client_id !== undefined && input.client_id !== existing.client_id) {
        const cleared = await tx
          .delete(connections)
          .where(eq(connections.provider, provider))
          .returning({ id: connections.id });

        if (cleared.length > 0) {
          this.logger.warn(
            { provider, cleared: cleared.length },
            "integration repointed at another app, so its connections were cleared and writers must reconnect",
          );
        }
      }

      return updated;
    });
  }
}
