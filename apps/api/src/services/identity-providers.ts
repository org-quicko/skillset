import type {
  IdentityProviderCreate,
  IdentityProviderUpdate,
  PublicIdentityProvider,
} from "@skill-registry/shared";
import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { identityProviders, type IdentityProviderRow } from "../db/schema.js";
import {
  IdentityProviderNotFoundError,
  IdentityProviderSlugTakenError,
  IdentityProviderUngatedError,
} from "../http/errors.js";
import type { Logger } from "../logger.js";

export interface IdentityProvidersServiceDependencies {
  db: Database;
  logger: Logger;
}

/** Postgres's unique_violation — raised here only by `identity_providers.slug`. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/**
 * Postgres's invalid_text_representation, for a malformed `uuid` literal. A
 * malformed id can never match a row, so it is caught at the query rather than
 * pre-validated — there is no separate format check to drift from what the
 * database actually accepts.
 */
function isInvalidIdSyntax(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "22P02";
}

/**
 * Every configured Provider, enabled or not, oldest first.
 *
 * @remarks
 * The Admin's view. Rows carry `client_secret`, so callers must shape the
 * response through `IdentityProviderSchema`, which has no such field.
 *
 * @param deps - The database this reads from.
 * @returns The Provider rows.
 * @example
 * ```ts
 * const providers = await listIdentityProviders(deps);
 * ```
 */
export function listIdentityProviders(
  deps: Pick<IdentityProvidersServiceDependencies, "db">,
): Promise<IdentityProviderRow[]> {
  return deps.db.select().from(identityProviders).orderBy(asc(identityProviders.created_at));
}

/**
 * The Providers a login page should offer: enabled only, and only the fields
 * needed to draw a button.
 *
 * @remarks
 * Reads need no identity (ADR-0013), so this is served unauthenticated. It
 * projects in the query rather than filtering a full row afterwards, so a
 * secret cannot reach the response even by mistake.
 *
 * @param deps - The database this reads from.
 * @returns The enabled Providers, oldest first.
 * @example
 * ```ts
 * const items = await listEnabledIdentityProviders(deps);
 * ```
 */
export function listEnabledIdentityProviders(
  deps: Pick<IdentityProvidersServiceDependencies, "db">,
): Promise<PublicIdentityProvider[]> {
  return deps.db
    .select({
      slug: identityProviders.slug,
      kind: identityProviders.kind,
      display_name: identityProviders.display_name,
    })
    .from(identityProviders)
    .where(eq(identityProviders.enabled, true))
    .orderBy(asc(identityProviders.created_at));
}

/**
 * Finds an enabled Provider by its slug.
 *
 * @remarks
 * Disabled Providers are invisible here on purpose: disabling one must refuse
 * logins through it, not merely hide its button (ADR-0015).
 *
 * @param deps - The database this reads from.
 * @param slug - The Provider's slug, as carried in a login's `state`.
 * @returns The Provider row, or `null` if there is no enabled Provider by that
 * slug.
 */
export async function findEnabledProviderBySlug(
  deps: Pick<IdentityProvidersServiceDependencies, "db">,
  slug: string,
): Promise<IdentityProviderRow | null> {
  const [row] = await deps.db
    .select()
    .from(identityProviders)
    .where(eq(identityProviders.slug, slug))
    .limit(1);
  if (!row || !row.enabled) return null;
  return row;
}

/**
 * Configures a new Identity Provider.
 *
 * @remarks
 * A Provider may be created enabled, but only with a permitted domain or
 * tenant set — that gate is the only thing deciding who gets an account
 * (ADR-0015), so it is refused here and by a check constraint on the table.
 *
 * @param deps - The database and logger this needs.
 * @param input - The Provider's slug, kind, display name, issuer URL,
 * credentials, permitted domain, and whether to enable it immediately.
 * @returns The created row, including its `client_secret`.
 * @throws IdentityProviderUngatedError if `enabled` is set without a
 * `permitted_domain`.
 * @throws IdentityProviderSlugTakenError if another Provider already holds
 * that slug.
 * @example
 * ```ts
 * const provider = await createIdentityProvider(deps, {
 *   slug: "google",
 *   kind: "google",
 *   display_name: "Google Workspace",
 *   issuer_url: "https://accounts.google.com",
 *   client_id: "…",
 *   client_secret: "…",
 *   permitted_domain: "example.com",
 *   enabled: true,
 * });
 * ```
 */
export async function createIdentityProvider(
  deps: IdentityProvidersServiceDependencies,
  input: IdentityProviderCreate,
): Promise<IdentityProviderRow> {
  const permittedDomain = input.permitted_domain ?? null;
  const enabled = input.enabled ?? false;
  if (enabled && permittedDomain === null) throw new IdentityProviderUngatedError();

  try {
    const [created] = await deps.db
      .insert(identityProviders)
      .values({
        slug: input.slug,
        kind: input.kind,
        display_name: input.display_name,
        issuer_url: input.issuer_url,
        client_id: input.client_id,
        client_secret: input.client_secret,
        permitted_domain: permittedDomain,
        enabled,
      })
      .returning();
    if (!created) throw new Error("Insert did not return the created Identity Provider.");

    deps.logger.info({ identity_provider_id: created.id, slug: created.slug }, "identity provider created");
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) throw new IdentityProviderSlugTakenError();
    throw error;
  }
}

/**
 * Changes a Provider's configuration.
 *
 * @remarks
 * `slug` and `kind` cannot be changed — the slug is what a login carries back
 * in `state` and the kind decides which claim gates the domain, so altering
 * either on a live Provider would silently repoint an existing configuration.
 * Omitting `client_secret` leaves the stored one untouched, which is what lets
 * an Admin edit a Provider without being shown its secret.
 *
 * Clearing the permitted domain while the Provider stays enabled is refused
 * for the same reason enabling an ungated one is.
 *
 * @param deps - The database and logger this needs.
 * @param id - The Provider's id.
 * @param input - The fields to change; anything absent is left as it is.
 * @returns The updated row.
 * @throws IdentityProviderNotFoundError if no Provider has that id.
 * @throws IdentityProviderUngatedError if the result would be an enabled
 * Provider with no permitted domain or tenant.
 * @example
 * ```ts
 * await updateIdentityProvider(deps, id, { enabled: false });
 * ```
 */
export async function updateIdentityProvider(
  deps: IdentityProvidersServiceDependencies,
  id: string,
  input: IdentityProviderUpdate,
): Promise<IdentityProviderRow> {
  let existing: IdentityProviderRow | undefined;
  try {
    [existing] = await deps.db.select().from(identityProviders).where(eq(identityProviders.id, id)).limit(1);
  } catch (error) {
    if (isInvalidIdSyntax(error)) throw new IdentityProviderNotFoundError();
    throw error;
  }
  if (!existing) throw new IdentityProviderNotFoundError();

  const permittedDomain =
    input.permitted_domain === undefined ? existing.permitted_domain : (input.permitted_domain ?? null);
  const enabled = input.enabled ?? existing.enabled;
  if (enabled && permittedDomain === null) throw new IdentityProviderUngatedError();

  const [updated] = await deps.db
    .update(identityProviders)
    .set({
      ...(input.display_name !== undefined ? { display_name: input.display_name } : {}),
      ...(input.issuer_url !== undefined ? { issuer_url: input.issuer_url } : {}),
      ...(input.client_id !== undefined ? { client_id: input.client_id } : {}),
      ...(input.client_secret !== undefined ? { client_secret: input.client_secret } : {}),
      permitted_domain: permittedDomain,
      enabled,
      updated_at: new Date(),
    })
    .where(eq(identityProviders.id, id))
    .returning();
  if (!updated) throw new IdentityProviderNotFoundError();

  deps.logger.info(
    { identity_provider_id: updated.id, slug: updated.slug, enabled: updated.enabled },
    "identity provider updated",
  );
  return updated;
}
