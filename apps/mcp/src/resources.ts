import type { Tag } from "@in-org-quicko/skillset-shared";
import { fetchTagCatalog, searchSkills } from "./tools/search-skills.js";
import { readSkill } from "./tools/read-skill.js";

/**
 * The MCP `resources` primitive for this server (spec, "Protocol hygiene"): a Skill's
 * `SKILL.md` and a Tag's member Skills, each exposed as a URI a host can list, complete, and
 * read directly — without a tool call. Before this, the only way to see a Skill's body was
 * `read_skill`, and the only way to discover a valid `name` or `tag` value was to guess or
 * call `search_skills` first and parse its result.
 */

/** One Skill's resource entry, as `resources/list` on the `skillset://skills/{name}` template reports it. */
export interface SkillResourceEntry {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
}

/** One Tag's resource entry, as `resources/list` on the `skillset://tags/{tag}` template reports it. */
export interface TagResourceEntry {
  uri: string;
  name: string;
  title: string;
}

export function skillResourceUri(name: string): string {
  return `skillset://skills/${encodeURIComponent(name)}`;
}

export function tagResourceUri(name: string): string {
  return `skillset://tags/${encodeURIComponent(name)}`;
}

/**
 * Resolves one captured URI template variable to a single string, taking the first value when
 * the template matched several.
 *
 * @throws Error naming `key` if the URI match left it absent — the template guarantees a
 * value in practice, but its type (an index signature) does not, so this is where that gap is
 * closed rather than asserted away at every call site.
 */
export function resourceVariable(variables: Record<string, string | string[] | undefined>, key: string): string {
  const value = variables[key];
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) throw new Error(`Resource template is missing its "${key}" variable.`);
  return first;
}

/** Lists every Skill in the catalog as a `skillset://skills/{name}` resource. @throws Error on a non-2xx response. */
export async function listSkillResources(fetchImpl: typeof fetch, registry: string): Promise<SkillResourceEntry[]> {
  const { results } = await searchSkills(fetchImpl, registry, {});
  return results.map((skill) => ({
    uri: skillResourceUri(skill.name),
    name: skill.name,
    title: skill.name,
    description: skill.description,
    mimeType: "text/markdown",
  }));
}

/** Completes a `skillset://skills/{name}` URI's `name` variable against Skill names matching `value`. */
export async function completeSkillName(fetchImpl: typeof fetch, registry: string, value: string): Promise<string[]> {
  const { results } = await searchSkills(fetchImpl, registry, { query: value });
  return results.map((skill) => skill.name);
}

/** Reads one Skill's `SKILL.md` body for its resource. @throws Error when no Skill has this name. */
export async function readSkillResource(fetchImpl: typeof fetch, registry: string, name: string): Promise<{ uri: string; body: string }> {
  const skill = await readSkill(fetchImpl, registry, name);
  return { uri: skillResourceUri(skill.name), body: skill.body };
}

/** Lists every Tag in the catalog as a `skillset://tags/{tag}` resource. @throws Error on a non-2xx response. */
export async function listTagResources(fetchImpl: typeof fetch, registry: string): Promise<TagResourceEntry[]> {
  const tags: Tag[] = await fetchTagCatalog(fetchImpl, registry);
  return tags.map((tag) => ({ uri: tagResourceUri(tag.name), name: tag.name, title: tag.name }));
}

/** Completes a `skillset://tags/{tag}` URI's `tag` variable against Tag names starting with `value`. */
export async function completeTagName(fetchImpl: typeof fetch, registry: string, value: string): Promise<string[]> {
  const tags = await fetchTagCatalog(fetchImpl, registry);
  const wanted = value.trim().toLowerCase();
  return tags.filter((tag) => tag.name.startsWith(wanted)).map((tag) => tag.name);
}

/** One Skill under a Tag, as `skillset://tags/{tag}` reads back. */
export interface TagResourceSkill {
  name: string;
  description: string;
}

/**
 * Reads the Skills carrying one Tag, for the `skillset://tags/{tag}` resource.
 * @throws Error naming every known Tag when `tag` matches none (via `search_skills`'s own resolution).
 */
export async function readTagResource(
  fetchImpl: typeof fetch,
  registry: string,
  tag: string,
): Promise<{ uri: string; skills: TagResourceSkill[] }> {
  const { results } = await searchSkills(fetchImpl, registry, { tag });
  return {
    uri: tagResourceUri(tag),
    skills: results.map((skill) => ({ name: skill.name, description: skill.description })),
  };
}
