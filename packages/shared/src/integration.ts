import { z } from "zod";
import { isGitProvider } from "./git-provider.js";
import { timestamp } from "./timestamp.js";

/**
 * A Git Provider name, as the API will accept one.
 *
 * @remarks
 * A plain string validated against `GIT_PROVIDERS` rather than a `z.enum`, so
 * the only list of provider names in the codebase stays the config table
 * (ADR-0024). Adding a provider is a key there and nothing here.
 */
const Provider = z
  .string()
  .trim()
  .min(1)
  .refine(isGitProvider, { message: "Not a Git Provider this Registry reads from." });

/**
 * An app slug at the provider, used to build its installation URL.
 *
 * @remarks
 * Narrow because it is interpolated into that URL. `null` is meaningful rather
 * than merely unset: it says this provider has no installation step, which is
 * true of everything except GitHub today.
 */
const AppSlug = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9-]+$/, { message: "An app slug may hold only letters, digits, and hyphens." });

/**
 * A free-text note on what an Integration is for, shown alongside its other
 * details.
 *
 * @remarks
 * Capped at 180 characters — long enough for a sentence, short enough that it
 * cannot turn into documentation the display name and app slug should carry
 * instead.
 */
const Description = z.string().trim().max(180);

/**
 * An Admin's view of a configured Integration.
 *
 * @remarks
 * `client_secret` is deliberately absent: it is written and never read back,
 * so no response can leak it, not even to the Admin who set it. There is no
 * public counterpart to this shape at all — unlike an Identity Provider, an
 * Integration draws no button on an unauthenticated page.
 *
 * `id`, not `provider`, is the row's identity: more than one Integration may
 * exist for the same Git Provider (ADR-0025).
 */
export const IntegrationSchema = z.object({
  id: z.string(),
  provider: z.string(),
  display_name: z.string(),
  description: z.string().nullable(),
  client_id: z.string(),
  app_slug: z.string().nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type Integration = z.infer<typeof IntegrationSchema>;

/** `GET /integrations` response — every configured Integration. */
export const IntegrationListSchema = z.object({
  items: z.array(IntegrationSchema),
});
export type IntegrationList = z.infer<typeof IntegrationListSchema>;

/**
 * `POST /integrations` request body.
 *
 * @remarks
 * More than one Integration may be created for the same `provider` (ADR-0025)
 * — a second GitHub App, say — so this never conflicts on `provider` alone.
 * The server assigns the row's actual identity, `id`.
 */
export const IntegrationCreateSchema = z.object({
  provider: Provider,
  display_name: z.string().trim().min(1).max(100),
  /** Omitted is the same as `null`: there is nothing to say beyond the name. */
  description: Description.nullable().optional(),
  client_id: z.string().trim().min(1),
  client_secret: z.string().min(1),
  /** Omitted is the same as `null`: this provider has no installation step. */
  app_slug: AppSlug.nullable().optional(),
});
export type IntegrationCreate = z.infer<typeof IntegrationCreateSchema>;

/**
 * `PATCH /integrations/\{id\}` request body.
 *
 * @remarks
 * `provider` is absent on purpose: which Git Provider an app is for does not
 * change once registered, only the app's own details do. Omitting
 * `client_secret` leaves the stored one untouched, which is what lets an
 * Admin edit an Integration without being shown its secret.
 *
 * `app_slug` distinguishes absent from `null`: omitting it leaves whatever is
 * stored, while sending `null` clears it.
 */
export const IntegrationUpdateSchema = z.object({
  display_name: z.string().trim().min(1).max(100).optional(),
  /** Absent leaves the stored description as it is; `null` clears it. */
  description: Description.nullable().optional(),
  client_id: z.string().trim().min(1).optional(),
  client_secret: z.string().min(1).optional(),
  app_slug: AppSlug.nullable().optional(),
});
export type IntegrationUpdate = z.infer<typeof IntegrationUpdateSchema>;
