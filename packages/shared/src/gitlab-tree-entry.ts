/**
 * The subset of GitLab's repository-tree entry shape the walk reads.
 *
 * @remarks
 * No size field, and that is not an omission here — GitLab's tree response
 * genuinely carries none, which is why the byte ceiling has to be charged as
 * bytes arrive rather than before the fetch.
 */
export interface GitLabTreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
}
