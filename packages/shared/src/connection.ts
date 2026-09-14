import { z } from "zod";
import { timestamp } from "./timestamp.js";

/**
 * A writer's own view of one Connection they hold.
 *
 * @remarks
 * There is no token field, and there is no Admin variant of this shape that
 * has one. A Connection's tokens never leave the server in any response, on
 * any route — the only reason they are stored is for the Registry to spend
 * them on that writer's behalf.
 *
 * `external_account_login` is here because a writer needs it: the connected
 * account need not be the account they sign in with, so "why can this Import
 * not see my repository?" is often answered by which account is connected.
 *
 * `integration_id` names which app the grant was issued through — a provider
 * may have more than one Integration configured (ADR-0025), and this is how
 * the interface tells which of them is the one currently connected.
 */
export const ConnectionSchema = z.object({
  provider: z.string(),
  integration_id: z.string(),
  external_account_login: z.string(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type Connection = z.infer<typeof ConnectionSchema>;

/**
 * An Integration a writer could connect through, if they have not already.
 *
 * @remarks
 * Carries no credential and no secret — only enough to draw a button. It
 * exists because `GET /integrations` is Admin-only, so a writer has no other
 * way to learn whether there is anything to connect to, and a Connect button
 * for a provider with no Integration would fail as soon as it was pressed.
 *
 * A provider with no credentialed flow at all is absent: GitLab is public-read
 * only, so offering to connect it would be offering something that cannot
 * exist (ADR-0024).
 *
 * One entry per Integration, not per Git Provider (ADR-0025): a provider with
 * two configured apps offers two entries sharing the same `provider`, and the
 * interface lets a writer pick between them by `id`.
 *
 * Present whether or not the caller is already connected, because connecting
 * and choosing repositories are two separate trips and the second is needed
 * most *after* the first has succeeded.
 */
export const ConnectableProviderSchema = z.object({
  id: z.string(),
  provider: z.string(),
  display_name: z.string(),
  /**
   * The app's slug at the provider. Null for a provider with no installation
   * step, or a half-configured Integration that has not set one yet.
   *
   * Surfaced so the interface can tell two Integrations for the same provider
   * apart by *which app* they are, not just by an Admin-chosen display name
   * that need not be unique (ADR-0025).
   */
  app_slug: z.string().nullable(),
  /**
   * Where the writer chooses which repositories the Registry may read, or
   * `null` when the Integration carries no app slug to build it from.
   *
   * Built server-side because it needs the Integration's app slug, and
   * `GET /integrations` is Admin-only. The slug is not a secret — the app's
   * page at the provider is public — but a writer has no other way to reach it.
   */
  manage_access_url: z.string().nullable(),
});
export type ConnectableProvider = z.infer<typeof ConnectableProviderSchema>;

/**
 * `GET /connections` response — the caller's own Connections, and what else
 * they could connect.
 *
 * @remarks
 * Both in one response because the interface always needs both at once: a
 * card showing "connected as ada-work" and a card showing "connect GitHub"
 * are the same card in two states, and fetching them separately would render
 * the wrong one first.
 */
export const ConnectionListSchema = z.object({
  items: z.array(ConnectionSchema),
  connectable: z.array(ConnectableProviderSchema),
});
export type ConnectionList = z.infer<typeof ConnectionListSchema>;
