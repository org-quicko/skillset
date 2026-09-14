/** The subset of GitHub's Contents API entry shape the walk reads. */
export interface GitHubContentsEntry {
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size?: number;
  download_url: string | null;
}
