import { splitFrontmatter } from "@skillset/shared";
import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * A markdown file from a Skill, as sanitised HTML.
 *
 * @remarks
 * Markup here is untrusted — it comes from whoever last published the Skill,
 * not from the reader viewing it — so it goes through DOMPurify's allowlist
 * before ever reaching the DOM.
 *
 * A leading YAML frontmatter block is dropped first. The `body` column the
 * Skill page used to render arrived with it already stripped; a file read
 * straight out of the Artifact does not, and handing a fence to a markdown
 * renderer turns `name: …  description: …` into a paragraph of prose above
 * the real content.
 *
 * @param markdown - The file's raw text, frontmatter and all.
 * @returns Sanitised HTML, safe to assign to `innerHTML`.
 * @example
 * ```tsx
 * <div dangerouslySetInnerHTML={{ __html: renderSkillBody(source) }} />
 * ```
 */
export function renderSkillBody(markdown: string): string {
  const html = marked.parse(splitFrontmatter(markdown).body, { async: false, breaks: false });
  // `target` is stripped rather than allowed through with a forced
  // `rel="noopener noreferrer"`: a link opening in the reader's own tab has
  // no `window.opener` to hand a publisher-controlled page in the first place.
  return DOMPurify.sanitize(html, { FORBID_ATTR: ["target"] });
}
