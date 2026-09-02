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
 * An Admin's view of a configured Integration.
 *
 * @remarks
 * `client_secret` is deliberately absent: it is written and never read back,
 * so no response can leak it, not even to the Admin who set it. There is no
 * public counterpart to this shape at all — unlike an Identity Provider, an
 * Integration draws no button on an unauthenticated page.
 */
export const IntegrationSchema = z.object({
  provider: z.string(),
  display_name: z.string(),
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
 * `provider` is the row's identity, so there is at most one Integration per
 * Git Provider and a second is a conflict rather than an addition.
 */
export const IntegrationCreateSchema = z.object({
  provider: Provider,
  display_name: z.string().trim().min(1).max(100),
  client_id: z.string().trim().min(1),
  client_secret: z.string().min(1),
  /** Omitted is the same as `null`: this provider has no installation step. */
  app_slug: AppSlug.nullable().optional(),
});
export type IntegrationCreate = z.infer<typeof IntegrationCreateSchema>;

/**
 * `PATCH /integrations/\{provider\}` request body.
 *
 * @remarks
 * `provider` is absent on purpose: it is the Integration's identity, so
 * changing it would repoint an existing registration rather than create a new
 * one. Omitting `client_secret` leaves the stored one untouched, which is what
 * lets an Admin edit an Integration without being shown its secret.
 *
 * `app_slug` distinguishes absent from `null`: omitting it leaves whatever is
 * stored, while sending `null` clears it.
 */
export const IntegrationUpdateSchema = z.object({
  display_name: z.string().trim().min(1).max(100).optional(),
  client_id: z.string().trim().min(1).optional(),
  client_secret: z.string().min(1).optional(),
  app_slug: AppSlug.nullable().optional(),
});
export type IntegrationUpdate = z.infer<typeof IntegrationUpdateSchema>;
