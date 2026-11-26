import {
  DEFAULT_MARKETPLACE_SETTINGS,
  MarketplaceSettingsSchema,
  type MarketplaceSettings,
  type MarketplaceSettingsUpdate,
} from "@in-org-quicko/skillset-shared";
import { sql } from "kysely";
import type { Database } from "../../db/client.js";
import type { Logger } from "../../lib/logger.js";

/** The details of the Registry's Claude Code marketplace, which an Admin can edit. */
export class MarketplaceService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /**
   * Reads the marketplace's details.
   *
   * @returns The saved details, or the defaults (`skillset`, owned by `Skillset`) when an Admin has never saved any.
   * @example
   * ```ts
   * const { name } = await marketplaceService.getSettings();
   * ```
   */
  async getSettings(): Promise<MarketplaceSettings> {
    const row = await this.db
      .selectFrom("marketplace_settings")
      .select(["name", "owner_name", "owner_email", "description", "updated_at"])
      .executeTakeFirst();
    return row ? MarketplaceSettingsSchema.parse(row) : DEFAULT_MARKETPLACE_SETTINGS;
  }

  /**
   * Replaces the marketplace's details.
   *
   * @remarks
   * Renaming the marketplace changes the `@<name>` Claude Code installs from,
   * so a User who added it under the old name keeps that name until they add
   * it again.
   *
   * @param update - Every detail, already validated by `MarketplaceSettingsUpdateSchema`.
   * @returns The details as saved.
   * @example
   * ```ts
   * await marketplaceService.updateSettings({ name: "acme", owner_name: "Acme", owner_email: null, description: null });
   * ```
   */
  async updateSettings(update: MarketplaceSettingsUpdate): Promise<MarketplaceSettings> {
    const row = await this.db
      .insertInto("marketplace_settings")
      .values({ id: true, ...update })
      .onConflict((oc) => oc.column("id").doUpdateSet({ ...update, updated_at: sql`now()` }))
      .returning(["name", "owner_name", "owner_email", "description", "updated_at"])
      .executeTakeFirstOrThrow();
    this.logger.info({ name: row.name }, "marketplace settings updated");
    return MarketplaceSettingsSchema.parse(row);
  }
}
