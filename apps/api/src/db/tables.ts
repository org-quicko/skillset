import type { Insertable, Selectable } from "kysely";
import type { DB } from "./database.js";

// Row shapes by the names the services use, over the types kysely-codegen
// generates into `database.ts` from the migrations.

export type AccountRow = Selectable<DB["accounts"]>;
export type ConnectionRow = Selectable<DB["connections"]>;
export type NewConnectionRow = Insertable<DB["connections"]>;
export type IdentityProviderRow = Selectable<DB["identity_providers"]>;
export type NewIdentityProviderRow = Insertable<DB["identity_providers"]>;
export type IntegrationRow = Selectable<DB["integrations"]>;
export type NewIntegrationRow = Insertable<DB["integrations"]>;
export type RateLimitRow = Selectable<DB["rate_limits"]>;
export type ResourceInstallEventRow = Selectable<DB["resource_install_events"]>;
export type NewResourceInstallEventRow = Insertable<DB["resource_install_events"]>;
export type ResourceSubmissionRow = Selectable<DB["resource_submissions"]>;
export type NewResourceSubmissionRow = Insertable<DB["resource_submissions"]>;
export type ResourceTagRow = Selectable<DB["resource_tags"]>;
export type NewResourceTagRow = Insertable<DB["resource_tags"]>;
export type ResourceRow = Selectable<DB["resources"]>;
export type NewResourceRow = Insertable<DB["resources"]>;
export type SessionRow = Selectable<DB["sessions"]>;
export type TagRow = Selectable<DB["tags"]>;
export type NewTagRow = Insertable<DB["tags"]>;
export type TokenRow = Selectable<DB["tokens"]>;
export type NewTokenRow = Insertable<DB["tokens"]>;
export type UserRow = Selectable<DB["users"]>;
export type NewUserRow = Insertable<DB["users"]>;
export type VerificationRow = Selectable<DB["verifications"]>;

export type { IdentityProviderKind, SkillInstallSource, UserRole } from "./database.js";
