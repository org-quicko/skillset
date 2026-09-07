import { z } from "zod";
import { timestamp } from "./timestamp.js";

/**
 * The kinds of Provider the Registry knows how to talk to, and — since there is
 * at most one Provider of each (ADR-0017) — the key a Provider is identified
 * by. Google and Microsoft assert the organisation in a claim; GitHub has no ID
 * token and is gated on a live membership check instead (ADR-0018).
 */
export const IdentityProviderKindSchema = z.enum(["google", "microsoft", "github"]);
export type IdentityProviderKind = z.infer<typeof IdentityProviderKindSchema>;

/** The kinds a Provider picker offers, in the order they should list. */
export const IDENTITY_PROVIDER_KINDS = IdentityProviderKindSchema.options;

/**
 * What an unauthenticated visitor sees on the login page: enough to draw a
 * button and start a flow, and nothing else. Reads need no identity
 * (ADR-0013), so this shape is public and must never grow a secret.
 */
export const PublicIdentityProviderSchema = z.object({
  kind: IdentityProviderKindSchema,
  display_name: z.string(),
});
export type PublicIdentityProvider = z.infer<typeof PublicIdentityProviderSchema>;

/**
 * Why an external login was refused, as the login page is told it.
 *
 * @remarks
 * These reach the browser in the callback's `?error=` parameter, so each one is
 * a fact the person can act on and nothing more. They deliberately do not name
 * *which* organisation was expected: that is configuration, it is in the logs,
 * and a refused visitor has no business learning it.
 *
 * `oauth_app_not_approved` is the one worth keeping distinct. It is what an
 * organisation with third-party application restrictions looks like before an
 * owner approves the app — GitHub returns no organisations at all rather than
 * an error — and it refuses every member with no other symptom (ADR-0018).
 * Told apart from plain non-membership, it is a five-minute fix; folded in with
 * it, it is an afternoon.
 */
export const LOGIN_REFUSAL_MESSAGE: Record<string, string> = {
  external_login_failed: "That sign-in could not be completed. Try again, or use your password.",
  provider_disabled: "That way of signing in is currently switched off. Use your password, or ask an administrator.",
  provider_not_configured: "That way of signing in is not configured here. Use your password instead.",
  organisation_not_permitted:
    "Your account is not in an organisation this Registry admits. Ask an administrator to add it, or use your password.",
  oauth_app_not_approved:
    "GitHub did not report any organisation for your account. If your organisation restricts third-party " +
    "applications, an owner has to approve this Registry's OAuth app before anyone can sign in with GitHub.",
  no_email_from_provider:
    "That provider did not give this Registry an email address, which is how accounts are identified here.",
  email_not_verified:
    "Your provider reports that your email address has not been verified. Verify it with your provider and try " +
    "again, or use your password.",
};

/**
 * The message to show for a refusal code, falling back to the generic one.
 *
 * @param code - The `?error=` value the callback redirected with, if any.
 * @returns A sentence to show on the login page.
 * @example
 * ```ts
 * const message = loginRefusalMessage(search.get("error"));
 * ```
 */
export function loginRefusalMessage(code: string | null | undefined): string {
  return (
    (code ? LOGIN_REFUSAL_MESSAGE[code] : undefined) ??
    LOGIN_REFUSAL_MESSAGE.external_login_failed ??
    "That sign-in could not be completed."
  );
}

/** `GET /auth/providers` response — the enabled Providers, for the login page. */
export const PublicIdentityProviderListSchema = z.object({
  items: z.array(PublicIdentityProviderSchema),
});
export type PublicIdentityProviderList = z.infer<typeof PublicIdentityProviderListSchema>;

/**
 * The organisations a Provider admits: Workspace domains, Entra tenant ids, or
 * GitHub organisation logins, depending on kind.
 *
 * @remarks
 * A list, because one Registry may serve several domains or several GitHub
 * organisations, and an empty list is meaningful rather than merely unset — it
 * means this Provider performs no organisation check at all. See
 * `isUngated`.
 */
const PermittedOrganisations = z.array(z.string().trim().min(1)).max(50);

/**
 * Whether a Provider admits anyone the provider itself will authenticate.
 *
 * @remarks
 * An empty list is not "unconfigured", it is a configuration: no organisation
 * check runs, so every account the provider vouches for gets a `reader` here.
 * That is the whole gate gone (ADR-0015, ADR-0021), which is why this is a
 * named predicate rather than an inline `length === 0` — every place that has
 * to warn about it says the same thing.
 *
 * @param organisations - The Provider's permitted organisations.
 * @returns Whether the Provider performs no organisation check.
 * @example
 * ```ts
 * if (isUngated(provider.permitted_organisations)) warnLoudly();
 * ```
 */
export function isUngated(organisations: readonly string[]): boolean {
  return organisations.length === 0;
}

/**
 * An Admin's view of a configured Provider. `client_secret` is deliberately
 * absent: it is written and never read back, so no response can leak it, not
 * even to the Admin who set it.
 */
export const IdentityProviderSchema = z.object({
  id: z.string(),
  kind: IdentityProviderKindSchema,
  display_name: z.string(),
  client_id: z.string(),
  permitted_organisations: PermittedOrganisations,
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
 * There is no issuer URL and no slug. Better Auth knows each kind's endpoints
 * already (ADR-0016), and the kind is the identity (ADR-0017), so what an
 * Admin supplies is the credential pair and the organisation to admit.
 */
export const IdentityProviderCreateSchema = z.object({
  kind: IdentityProviderKindSchema,
  display_name: z.string().trim().min(1),
  client_id: z.string().trim().min(1),
  client_secret: z.string().min(1),
  /** Omitted or empty means no organisation check runs — see `isUngated`. */
  permitted_organisations: PermittedOrganisations.optional(),
  enabled: z.boolean().optional(),
});
export type IdentityProviderCreate = z.infer<typeof IdentityProviderCreateSchema>;

/**
 * `PATCH /identity-providers/\{id\}` request body.
 *
 * `kind` is absent on purpose: it is the Provider's identity, and changing it
 * would silently repoint a configuration rather than create a new one.
 * Omitting `client_secret` leaves the stored secret untouched.
 */
export const IdentityProviderUpdateSchema = z
  .object({
    display_name: z.string().trim().min(1).optional(),
    client_id: z.string().trim().min(1).optional(),
    client_secret: z.string().min(1).optional(),
    /** An empty array clears the gate; omitting the field leaves it alone. */
    permitted_organisations: PermittedOrganisations.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field is required.",
  });
export type IdentityProviderUpdate = z.infer<typeof IdentityProviderUpdateSchema>;

/**
 * The claim carrying the organisation a person belongs to, per kind, or `null`
 * where there is no claim to read.
 *
 * @remarks
 * GitHub is the `null`: it issues no ID token, so its gate is a live call to
 * `/user/orgs` rather than a claim (ADR-0018). The principle is the same for
 * all three and is the reason this table exists at all — the organisation is
 * whatever the Provider asserts, never what the email address's suffix
 * suggests.
 */
export const ORGANISATION_CLAIM: Record<IdentityProviderKind, "hd" | "tid" | null> = {
  google: "hd",
  microsoft: "tid",
  github: null,
};

/**
 * What an Admin configuring a Provider needs to know per kind, kept beside the
 * claim table above so the two cannot drift: what the organisation gate is
 * called in that provider's own vocabulary, how it is matched, and what
 * leaving it empty does.
 */
export const IDENTITY_PROVIDER_GUIDANCE: Record<
  IdentityProviderKind,
  { label: string; organisation: string; organisationTooltip: string; organisationSupport: string }
> = {
  google: {
    label: "Google Workspace",
    organisation: "Permitted Workspace domains",
    organisationTooltip:
      "Matched against the account's Workspace domain, not the email address's suffix. For example: " +
      "example.com, example.org",
    organisationSupport:
      "Anyone whose domain matches gets a reader account. Leave empty to allow anyone to sign in with " +
      "Google Workspace.",
  },
  microsoft: {
    label: "Microsoft Entra",
    organisation: "Permitted tenant ids",
    organisationTooltip:
      "Matched against the tenant's ID, found in the Entra admin center. Listing more than one switches " +
      "sign-in to the multi-tenant endpoint, so each tenant must consent to the app separately.",
    organisationSupport:
      "Anyone whose tenant matches gets a reader account. Leave empty to allow anyone to sign in with " +
      "Microsoft Entra.",
  },
  github: {
    label: "GitHub",
    organisation: "Permitted organisations",
    organisationTooltip:
      "Each organisation's login as it appears in its URL, for example acme, acme-labs. Membership is " +
      "checked on every login, so the OAuth app must be approved by an owner of each organisation that " +
      "restricts third-party access.",
    organisationSupport:
      "Anyone who belongs to one of these gets a reader account. Leave empty to allow anyone to sign in " +
      "with GitHub.",
  },
};
