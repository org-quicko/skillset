import { z } from "zod";
import { CLAUDE_MARKETPLACE_NAME } from "./plugin.js";
import { timestamp } from "./timestamp.js";

/** How long the marketplace's description may run. Exported so the settings form can show the same limit. */
export const MARKETPLACE_DESCRIPTION_MAX_LENGTH = 300;

/**
 * The marketplace's name: what Claude Code users type after the `@` in
 * `claude plugin install <plugin>@<name>`.
 *
 * @remarks
 * Kebab-case, because Claude Code refuses a marketplace name with spaces or
 * capitals.
 */
const Name = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Use lowercase letters, digits, and single hyphens, e.g. acme-plugins.",
  });

const OwnerName = z.string().trim().min(1).max(100);
const OwnerEmail = z.email().nullable();
const Description = z.string().trim().min(1).max(MARKETPLACE_DESCRIPTION_MAX_LENGTH).nullable();

/**
 * The details an Admin gives the Registry's Claude Code marketplace, served in
 * `/.claude-plugin/marketplace.json`.
 *
 * @remarks
 * Only these details are editable. Which Plugins the marketplace lists always
 * follows what is published. `updated_at` is `null` until an Admin first saves.
 */
export const MarketplaceSettingsSchema = z.object({
  name: z.string(),
  owner_name: z.string(),
  owner_email: z.string().nullable(),
  description: z.string().nullable(),
  updated_at: timestamp.nullable(),
});
export type MarketplaceSettings = z.infer<typeof MarketplaceSettingsSchema>;

/** The body of `PUT /marketplace/settings`: every detail, replaced together. */
export const MarketplaceSettingsUpdateSchema = z.object({
  name: Name,
  owner_name: OwnerName,
  owner_email: OwnerEmail,
  description: Description,
});
export type MarketplaceSettingsUpdate = z.infer<typeof MarketplaceSettingsUpdateSchema>;

/** The marketplace's details until an Admin saves any. */
export const DEFAULT_MARKETPLACE_SETTINGS: MarketplaceSettings = {
  name: CLAUDE_MARKETPLACE_NAME,
  owner_name: "Skillset",
  owner_email: null,
  description: null,
  updated_at: null,
};
