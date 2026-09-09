import { z } from "zod";

/**
 * One repository a writer's Connection can see — a row in the picker behind
 * "browse repositories" on the publish screen (ADR-0024).
 *
 * @remarks
 * Only as much as the picker needs to show a row and build a browse URL
 * `parseSkillSourceUrl` already knows how to read — nothing from the
 * provider's own response shape passes through unfiltered.
 */
export const RepositorySchema = z.object({
  /** `owner/name`, exactly what a `SkillSourceLocation.project` expects. */
  full_name: z.string(),
  name: z.string(),
  owner: z.string(),
  private: z.boolean(),
  html_url: z.string(),
  description: z.string().nullable(),
});
export type Repository = z.infer<typeof RepositorySchema>;

/** `GET /imports/:provider/repositories` response. */
export const RepositoryListSchema = z.object({
  items: z.array(RepositorySchema),
});
export type RepositoryList = z.infer<typeof RepositoryListSchema>;
