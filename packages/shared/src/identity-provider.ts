import { z } from "zod";
import { timestamp } from "./timestamp.js";

/**
 * A Provider's slug is immutable and appears in the `state` a login round-trips
 * through the provider (ADR-0015), so it is kept to characters that survive a
 * URL and a log line unescaped.
 */
export const IDENTITY_PROVIDER_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * The kinds of Provider the Registry knows how to talk to. Both do OIDC
 * discovery against an issuer, so they are one code path with different
 * configuration; the kind exists to say which claim carries the organisation
 * (`hd` for Google, `tid` for Microsoft) and to label the login button.
 */
export const IdentityProviderKindSchema = z.enum(["google", "microsoft"]);
export type IdentityProviderKind = z.infer<typeof IdentityProviderKindSchema>;

export const IdentityProviderSlugSchema = z.string().regex(IDENTITY_PROVIDER_SLUG_PATTERN);

/** The kinds a Provider picker offers, in the order they should list. */
export const IDENTITY_PROVIDER_KINDS = IdentityProviderKindSchema.options;

/**
 * What an unauthenticated visitor sees on the login page: enough to draw a
 * button and start a flow, and nothing else. Reads need no identity
 * (ADR-0013), so this shape is public and must never grow a secret.
 */
export const PublicIdentityProviderSchema = z.object({
  slug: IdentityProviderSlugSchema,
  kind: IdentityProviderKindSchema,
  display_name: z.string(),
});
export type PublicIdentityProvider = z.infer<typeof PublicIdentityProviderSchema>;

/** `GET /auth/providers` response — the enabled Providers, for the login page. */
export const PublicIdentityProviderListSchema = z.object({
  items: z.array(PublicIdentityProviderSchema),
});
export type PublicIdentityProviderList = z.infer<typeof PublicIdentityProviderListSchema>;

/**
 * An Admin's view of a configured Provider. `client_secret` is deliberately
 * absent: it is written and never read back, so no response can leak it, not
 * even to the Admin who set it.
 */
export const IdentityProviderSchema = z.object({
  id: z.string(),
  slug: IdentityProviderSlugSchema,
  kind: IdentityProviderKindSchema,
  display_name: z.string(),
  issuer_url: z.url(),
  client_id: z.string(),
  permitted_domain: z.string().nullable(),
  enabled: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type IdentityProvider = z.infer<typeof IdentityProviderSchema>;

/** `GET /identity-providers` response — every Provider, enabled or not. */
export const IdentityProviderListSchema = z.object({
  items: z.array(IdentityProviderSchema),
});
export type IdentityProviderList = z.infer<typeof IdentityProviderListSchema>;

/**
 * `POST /identity-providers` request body.
 *
 * `issuer_url` is the provider's Issuer Identifier — `https://accounts.google.com`,
 * or `https://login.microsoftonline.com/{tenant}/v2.0` — not the path to its
 * discovery document. Discovery is performed against it, and the `iss` claim of
 * every ID token is validated to match; pointing this at the document itself
 * would silently disable that check.
 */
export const IdentityProviderCreateSchema = z.object({
  slug: IdentityProviderSlugSchema,
  kind: IdentityProviderKindSchema,
  display_name: z.string().trim().min(1),
  issuer_url: z.url(),
  client_id: z.string().trim().min(1),
  client_secret: z.string().min(1),
  permitted_domain: z.string().trim().min(1).nullish(),
  enabled: z.boolean().optional(),
});
export type IdentityProviderCreate = z.infer<typeof IdentityProviderCreateSchema>;

/**
 * `PATCH /identity-providers/\{id\}` request body.
 *
 * `slug` and `kind` are absent on purpose. The slug is what a login carries
 * back in `state` and what an operator matches against their logs, and the kind
 * decides which claim gates the domain — changing either on a live Provider
 * would silently repoint an existing configuration rather than create a new one.
 * Omitting `client_secret` leaves the stored secret untouched.
 */
export const IdentityProviderUpdateSchema = z
  .object({
    display_name: z.string().trim().min(1).optional(),
    issuer_url: z.url().optional(),
    client_id: z.string().trim().min(1).optional(),
    client_secret: z.string().min(1).optional(),
    permitted_domain: z.string().trim().min(1).nullish(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field is required.",
  });
export type IdentityProviderUpdate = z.infer<typeof IdentityProviderUpdateSchema>;

/**
 * The claim that carries the organisation a person belongs to, per kind. It is
 * the only control on who gets an account (ADR-0015), so it is matched on the
 * claim itself and never on the email address's suffix.
 */
export const ORGANISATION_CLAIM: Record<IdentityProviderKind, "hd" | "tid"> = {
  google: "hd",
  microsoft: "tid",
};

/**
 * What an Admin configuring a Provider needs to know per kind, kept beside the
 * claim table above so the two cannot drift: what the organisation gate is
 * called in that provider's own vocabulary, and what its issuer looks like.
 */
export const IDENTITY_PROVIDER_GUIDANCE: Record<
  IdentityProviderKind,
  { label: string; organisation: string; issuerExample: string; organisationHint: string }
> = {
  google: {
    label: "Google Workspace",
    organisation: "Permitted Workspace domain",
    issuerExample: "https://accounts.google.com",
    organisationHint: "Matched against the hd claim, not the email address's suffix. For example: example.com",
  },
  microsoft: {
    label: "Microsoft Entra",
    organisation: "Permitted tenant id",
    issuerExample: "https://login.microsoftonline.com/{tenant}/v2.0",
    organisationHint: "Matched against the tid claim. The tenant's GUID, the same one that appears in the issuer.",
  },
};
