import { ArtifactManifestSchema, SkillSchema } from "@in-org-quicko/skillset-shared";

/** One Skill, whole, without installing it. */
export interface ReadSkillResult {
  name: string;
  description: string;
  /** The `SKILL.md` body — everything below the frontmatter. */
  body: string;
  tags: string[];
  updated_at: string;
  installs: number;
  license: string | null;
  compatibility: string | null;
  allowed_tools: string | null;
  /** Where the Skill came from: a repository URL, or the Registry's own reverse-DNS domain. */
  source: string;
  /** Every file the Skill ships, with its size — what it brings beyond `SKILL.md`. */
  files: { path: string; size: number }[];
}

/**
 * Reads one Skill from the Registry without installing it.
 *
 * @param fetchImpl - The `fetch` implementation to send the request with — injected so this
 * function is testable without a real network call or a running MCP client.
 * @param registryUrl - The Registry's base URL, as configured by `--registry`/`SKILLSET_REGISTRY`.
 * @param name - The Skill's name, exactly as the Registry reports it.
 * @returns The Skill's metadata, its `SKILL.md` body, and its file list.
 * @throws Error when the Registry has no Skill by that name, or refuses either request.
 * @throws ZodError if a 2xx body does not match the expected shape.
 *
 * @remarks
 * This exists because the only way an Agent could previously see what a Skill actually
 * says was to install it — and an install writes to a developer's project. Reading and
 * adopting are different decisions, and one should not require the other.
 *
 * Records no Install. Neither request is one: reading the metadata never was, and listing
 * an Artifact's files is explicitly not obtaining it (ADR-0028). Only the zip endpoint
 * counts, and nothing here touches it.
 *
 * The file list comes from what storage actually holds rather than what was declared at
 * publish time, so a partially-uploaded Artifact reads as the short list it really is
 * (ADR-0032).
 *
 * @example
 * ```ts
 * const skill = await readSkill(fetch, "https://registry.example", "code-review");
 * skill.files.map((file) => file.path); // -> ["SKILL.md", "references/java.md"]
 * ```
 */
export async function readSkill(
  fetchImpl: typeof fetch,
  registryUrl: string,
  name: string,
): Promise<ReadSkillResult> {
  const res = await fetchImpl(new URL(`/api/resources/skill/by-name/${encodeURIComponent(name)}`, registryUrl));
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `No Skill named "${name}" on this Registry. Call search_skills to see what there is.`
        : `Reading "${name}" failed with status ${res.status}.`,
    );
  }
  const skill = SkillSchema.parse(await res.json());

  // Best-effort: a Skill whose metadata reads fine but whose file listing
  // does not is still worth answering with, because the body — the part a
  // caller is deciding on — is already in hand.
  let files: { path: string; size: number }[] = [];
  const filesRes = await fetchImpl(new URL(`/api/resources/${skill.id}/files`, registryUrl));
  if (filesRes.ok) {
    files = ArtifactManifestSchema.parse(await filesRes.json()).files;
  }

  return {
    name: skill.name,
    description: skill.description,
    body: skill.body,
    tags: skill.tags.map((tag) => tag.name),
    updated_at: skill.updated_at,
    installs: skill.installs,
    license: skill.license,
    compatibility: skill.compatibility,
    allowed_tools: skill.allowed_tools,
    source: skill.source,
    files,
  };
}
