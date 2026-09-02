import type { GitProviderConfig } from "./git-provider-config.js";

/** How requests leave the walk: a `fetch`, the token to sign them with, and where to send them. */
export interface SkillFolderTransport {
  fetch: typeof fetch;
  token: string | undefined;
  config: GitProviderConfig;
}
