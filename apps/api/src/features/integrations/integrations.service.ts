import {
  gitProviderConfig,
  isGitProvider,
  type IntegrationCreate,
  type IntegrationUpdate,
} from "@in-org-quicko/skillset-shared";
import { asc, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { firstRow } from "../../db/rows.js";
import { isInvalidIdSyntax, isRestrictViolation } from "../../db/pg-errors.js";
import { connections, integrations, type IntegrationRow } from "../../db/schemas/index.js";
import { ValidationError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import { sealSecret, type DerivedKeys } from "../../lib/secrets.js";
import { IntegrationInUseError, IntegrationNotFoundError } from "./integrations.errors.js";

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
 * (ADR-0024, ADR-0025).
 *
 * @remarks
 * There is no `listEnabled` counterpart and no public shape. An Identity
 * Provider needs one because it draws a button on an unauthenticated login
 * page; an Integration draws nothing, and its mere existence is what makes
 * Importing available — so the only reader is an Admin, and the import service
 * asking whether a row exists.
 *
 * More than one Integration may exist per Git Provider (ADR-0025): `id`, not
 * `provider`, is a row's identity.
 */
export class IntegrationsService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    /** Where `client_secret` is encrypted before it is stored (ISSUE-9). */
    private readonly keys: DerivedKeys,
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
   * The Integration by its id, or `undefined` when there is none.
   *
   * @remarks
   * Read per use rather than cached, so creating or editing an Integration
   * takes effect on the next request with no restart (ADR-0019). A malformed
   * id can never match a row, so it is treated the same as a missing one
   * rather than surfacing Postgres's syntax error.
   *
   * @param id - The Integration's id.
   * @returns The row, including its `client_secret`, or `undefined`.
   * @example
   * ```ts
   * const integration = await integrations.findById(id);
   * if (!integration) throw new IntegrationNotConfiguredError(provider);
   * ```
   */
  async findById(id: string): Promise<IntegrationRow | undefined> {
    try {
      const [row] = await this.db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
      return row;
    } catch (error) {
      if (isInvalidIdSyntax(error)) return undefined;
      throw error;
    }
  }

  /**
   * Every Integration configured for a Git Provider, oldest first.
   *
   * @remarks
   * More than one may exist (ADR-0025) — two different GitHub Apps, say — so
   * this returns a list rather than at most one row. Empty means "Importing is
   * not available for this provider", which is a configuration and not an
   * error.
   *
   * @param provider - The Git Provider name.
   * @returns Every Integration configured for it, oldest first.
   * @example
   * ```ts
   * const configured = await integrations.listByProvider("github");
   * if (configured.length === 0) throw new IntegrationNotConfiguredError("github");
   * ```
   */
  async listByProvider(provider: string): Promise<IntegrationRow[]> {
    return this.db
      .select()
      .from(integrations)
      .where(eq(integrations.provider, provider))
      .orderBy(asc(integrations.created_at));
  }

  /**
   * Registers an app with a Git Provider on this Registry.
   *
   * @remarks
   * Creating the first row for a provider is what makes Importing available
   * for it — there is no separate switch, deliberately (ADR-0024). An operator
   * who wants this Registry to hold no repository credentials for anybody does
   * not create one, and that is the off switch.
   *
   * More than one Integration may be created for the same provider (ADR-0025)
   * — a second GitHub App, say — and a writer chooses which one to connect
   * through.
   *
   * @param input - The provider, display name, description, credential pair, and app slug.
   * @returns The created row, including its `client_secret`.
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

    const inserted = await this.db
      .insert(integrations)
      .values({
        provider: input.provider,
        display_name: input.display_name,
        description: input.description ?? null,
        client_id: input.client_id,
        client_secret: await sealSecret(this.keys.clientSecrets, input.client_secret),
        app_slug: input.app_slug ?? null,
      })
      .returning();
    const created = firstRow(inserted, "Integration insert");

    this.logger.info(
      { integration_id: created.id, provider: created.provider },
      "integration created — importing is now available for this git provider",
    );
    return created;
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
   * @param id - The Integration's id.
   * @param input - The fields to change; anything absent is left as it is.
   * @returns The updated row.
   * @throws IntegrationNotFoundError if no Integration exists by that id.
   * @throws ValidationError if clearing `app_slug` would leave a provider whose
   * installation URL is built from one without it.
   * @example
   * ```ts
   * // Rotating a secret keeps every Connection.
   * await integrations.update(id, { client_secret: "…" });
   * // Pointing at another app drops the Connections made through it; writers
   * // holding one through a *different* Integration for the same provider are
   * // untouched.
   * await integrations.update(id, { client_id: "Iv23li…", client_secret: "…" });
   * ```
   */
  async update(id: string, input: IntegrationUpdate): Promise<IntegrationRow> {
    return this.db.transaction(async (tx) => {
      // Read before writing, and inside the transaction: `RETURNING` reports
      // the row as it now is, and telling a repoint from a no-op re-save of
      // the same value needs the `client_id` as it was. `provider` is read too
      // — the row's identity is `id`, but `assertAppSlugPresent` still needs to
      // know which provider's rules apply.
      const [existing] = await tx
        .select({ provider: integrations.provider, client_id: integrations.client_id })
        .from(integrations)
        .where(eq(integrations.id, id))
        .limit(1);
      if (!existing) throw new IntegrationNotFoundError();

      if (input.app_slug === null) assertAppSlugPresent(existing.provider, null);

      const [updated] = await tx
        .update(integrations)
        .set({
          ...(input.display_name !== undefined ? { display_name: input.display_name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.client_id !== undefined ? { client_id: input.client_id } : {}),
          ...(input.client_secret !== undefined
            ? { client_secret: await sealSecret(this.keys.clientSecrets, input.client_secret) }
            : {}),
          ...(input.app_slug !== undefined ? { app_slug: input.app_slug } : {}),
          updated_at: new Date(),
        })
        .where(eq(integrations.id, id))
        .returning();
      if (!updated) throw new IntegrationNotFoundError();

      this.logger.info({ integration_id: id, provider: updated.provider }, "integration updated");

      if (input.client_id !== undefined && input.client_id !== existing.client_id) {
        const cleared = await tx
          .delete(connections)
          .where(eq(connections.integration_id, id))
          .returning({ id: connections.id });

        if (cleared.length > 0) {
          this.logger.warn(
            { integration_id: id, cleared: cleared.length },
            "integration repointed at another app, so its connections were cleared and writers must reconnect",
          );
        }
      }

      return updated;
    });
  }

  /**
   * Removes an Integration's registration with a Git Provider.
   *
   * @remarks
   * Refused while any writer still holds a Connection through it —
   * `connections.integration_id` references this row `ON DELETE RESTRICT`
   * (ADR-0024), so Postgres refuses the statement and that refusal is
   * translated rather than pre-checked, matching how the rest of this file
   * lets Postgres enforce a constraint instead of keeping a second copy of it.
   * An Admin who wants that outcome disconnects those writers first, or uses
   * `update` to repoint the Integration at a different app, which clears
   * Connections deliberately and tells writers why.
   *
   * @param id - The Integration's id.
   * @throws IntegrationNotFoundError if no Integration exists by that id.
   * @throws IntegrationInUseError if a Connection still references it.
   * @example
   * ```ts
   * await integrations.delete(id);
   * ```
   */
  async delete(id: string): Promise<void> {
    let deleted: { id: string }[];
    try {
      deleted = await this.db.delete(integrations).where(eq(integrations.id, id)).returning({ id: integrations.id });
    } catch (error) {
      if (isRestrictViolation(error)) throw new IntegrationInUseError();
      throw error;
    }
    if (deleted.length === 0) throw new IntegrationNotFoundError();

    this.logger.info({ integration_id: id }, "integration deleted");
  }
}
