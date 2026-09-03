import {
  isUngated,
  type IdentityProviderCreate,
  type IdentityProviderUpdate,
  type PublicIdentityProvider,
} from "@skill-registry/shared";
import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { firstRow } from "../db/rows.js";
import { isInvalidIdSyntax, isUniqueViolation } from "../db/pg-errors.js";
import { identityProviders, type IdentityProviderRow } from "../db/schemas/index.js";
import { IdentityProviderKindTakenError, IdentityProviderNotFoundError } from "../http/errors.js";
import type { Logger } from "../logger.js";

/**
 * Tidies a submitted organisation list into what gets stored.
 *
 * @remarks
 * Trims, drops blanks, and removes case-insensitive duplicates while keeping
 * the first spelling an Admin typed — the gate compares lowercased, so
 * `Acme` and `acme` are one entry, but the list is shown back as it was
 * written rather than flattened to lower case.
 *
 * @param organisations - The submitted list, if any.
 * @returns The list to store; empty means no organisation check (ADR-0021).
 * @example
 * ```ts
 * normaliseOrganisations([" Acme ", "acme", ""]); // ["Acme"]
 * ```
 */
function normaliseOrganisations(organisations: string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of organisations ?? []) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

/** Configured Identity Providers: the Admin's view, and the public login-page list (ADR-0015, ADR-0017). */
export class IdentityProvidersService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /**
   * Every configured Provider, enabled or not, oldest first — the Admin's
   * view. Rows carry `client_secret`, so callers must shape the response
   * through `IdentityProviderSchema`, which has no such field.
   */
  async list(): Promise<IdentityProviderRow[]> {
    return this.db.select().from(identityProviders).orderBy(asc(identityProviders.created_at));
  }

  /**
   * The Providers a login page should offer: enabled only, oldest first, and
   * only the fields needed to draw a button. Served unauthenticated
   * (ADR-0013), and projected in the query rather than filtered afterwards, so
   * a secret cannot reach the response even by mistake.
   */
  async listEnabled(): Promise<PublicIdentityProvider[]> {
    return this.db
      .select({
        kind: identityProviders.kind,
        display_name: identityProviders.display_name,
      })
      .from(identityProviders)
      .where(eq(identityProviders.enabled, true))
      .orderBy(asc(identityProviders.created_at));
  }

  /**
   * Configures a new Identity Provider.
   *
   * @remarks
   * A Provider may be created enabled with no permitted organisations at all.
   * That used to be refused, here and by a check constraint, on the grounds
   * that the gate is the only thing deciding who gets an account (ADR-0015);
   * ADR-0021 reverses it, so an ungated Provider is now a supported
   * configuration and is logged as the notable event it is rather than
   * rejected.
   *
   * @param input - The Provider's kind, display name, credentials, permitted
   * organisations, and whether to enable it immediately.
   * @returns The created row, including its `client_secret`.
   * @throws IdentityProviderKindTakenError if a Provider of that kind already
   * exists (ADR-0017).
   * @example
   * ```ts
   * const provider = await identityProviders.create({
   *   kind: "google",
   *   display_name: "Google Workspace",
   *   client_id: "…",
   *   client_secret: "…",
   *   permitted_organisations: ["example.com", "example.org"],
   *   enabled: true,
   * });
   * ```
   */
  async create(input: IdentityProviderCreate): Promise<IdentityProviderRow> {
    const permittedOrganisations = normaliseOrganisations(input.permitted_organisations);
    const enabled = input.enabled ?? false;

    try {
      const inserted = await this.db
        .insert(identityProviders)
        .values({
          kind: input.kind,
          display_name: input.display_name,
          client_id: input.client_id,
          client_secret: input.client_secret,
          permitted_organisations: permittedOrganisations,
          enabled,
        })
        .returning();
      const created = firstRow(inserted, "Identity Provider insert");

      this.logger.info({ identity_provider_id: created.id, kind: created.kind }, "identity provider created");
      this.warnIfUngated(created);
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdentityProviderKindTakenError();
      throw error;
    }
  }

  /**
   * Changes a Provider's configuration.
   *
   * @remarks
   * `kind` cannot be changed: it is the Provider's identity (ADR-0017), so
   * altering it would repoint an existing configuration rather than create a
   * new one. Omitting `client_secret` leaves the stored one untouched, which
   * is what lets an Admin edit a Provider without being shown its secret.
   *
   * A change reaches logins two ways (ADR-0019): `enabled` and
   * `permitted_organisations` are read per login and take effect immediately,
   * while new credentials wait for the Better Auth instance to rebuild on the
   * next request to its routes.
   *
   * Passing an empty `permitted_organisations` clears the gate rather than
   * being rejected (ADR-0021); omitting the field leaves whatever is stored.
   *
   * @param id - The Provider's id.
   * @param input - The fields to change; anything absent is left as it is.
   * @returns The updated row.
   * @throws IdentityProviderNotFoundError if no Provider has that id.
   * @example
   * ```ts
   * await identityProviders.update(id, { enabled: false });
   * ```
   */
  async update(id: string, input: IdentityProviderUpdate): Promise<IdentityProviderRow> {
    let existing: IdentityProviderRow | undefined;
    try {
      [existing] = await this.db.select().from(identityProviders).where(eq(identityProviders.id, id)).limit(1);
    } catch (error) {
      if (isInvalidIdSyntax(error)) throw new IdentityProviderNotFoundError();
      throw error;
    }
    if (!existing) throw new IdentityProviderNotFoundError();

    const permittedOrganisations =
      input.permitted_organisations === undefined
        ? existing.permitted_organisations
        : normaliseOrganisations(input.permitted_organisations);
    const enabled = input.enabled ?? existing.enabled;

    const [updated] = await this.db
      .update(identityProviders)
      .set({
        ...(input.display_name !== undefined ? { display_name: input.display_name } : {}),
        ...(input.client_id !== undefined ? { client_id: input.client_id } : {}),
        ...(input.client_secret !== undefined ? { client_secret: input.client_secret } : {}),
        permitted_organisations: permittedOrganisations,
        enabled,
        updated_at: new Date(),
      })
      .where(eq(identityProviders.id, id))
      .returning();
    if (!updated) throw new IdentityProviderNotFoundError();

    this.logger.info(
      { identity_provider_id: updated.id, kind: updated.kind, enabled: updated.enabled },
      "identity provider updated",
    );
    this.warnIfUngated(updated);
    return updated;
  }

  /**
   * Records that a Provider was saved with no organisation check.
   *
   * @remarks
   * Only when it is also enabled — a disabled ungated Provider admits nobody,
   * so warning about it would be noise an operator learns to skip past, and
   * the warning has to still mean something on the day it matters.
   */
  private warnIfUngated(provider: IdentityProviderRow): void {
    if (!provider.enabled || !isUngated(provider.permitted_organisations)) return;
    this.logger.warn(
      { identity_provider_id: provider.id, kind: provider.kind },
      "identity provider is enabled with no permitted organisations — anyone who can authenticate with this " +
        "provider can now obtain a reader account on this Registry",
    );
  }
}
