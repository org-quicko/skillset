import { splitFrontmatter } from "@in-org-quicko/skillset-shared";
import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * Tags DOMPurify's default profile allows that a publisher must not have.
 *
 * @remarks
 * The default profile takes out `<script>`, which was never the whole of it
 * (ISSUE-16). What is left over still lets whoever published a Skill draw
 * whatever they like on this page:
 *
 * - `<style>` restyles and overlays the *whole application*, not just the
 *   rendered document — which is how a convincing "your session expired,
 *   re-enter your password" panel gets onto a page a reader trusts, and how
 *   an admin control gets covered by something that looks like a different
 *   one.
 * - `<form>`, `<input>` and friends give that panel somewhere to post to.
 *
 * None of them has a legitimate use in a Skill's documentation, which is
 * prose, code fences, tables and images.
 */
const FORBIDDEN_TAGS = ["style", "form", "input", "button", "textarea", "select", "option", "label"] as const;

/**
 * Attributes DOMPurify's default profile allows that a publisher must not
 * have.
 *
 * @remarks
 * `style` for the same reason `<style>` is forbidden above — an inline
 * declaration overlays a page just as well as a stylesheet does.
 *
 * `target` is stripped rather than allowed through with a forced
 * `rel="noopener noreferrer"`: a link opening in the reader's own tab has no
 * `window.opener` to hand a publisher-controlled page in the first place.
 */
const FORBIDDEN_ATTRIBUTES = ["style", "target"] as const;

/**
 * A markdown file from a Skill, as sanitised HTML.
 *
 * @remarks
 * Markup here is untrusted — it comes from whoever last published the Skill,
 * not from the reader viewing it — so it goes through DOMPurify's allowlist
 * before ever reaching the DOM.
 *
 * Remote images are left alone here and bounded by the interface's own
 * Content-Security-Policy instead (`img-src 'self' data: blob:`, ISSUE-8):
 * an `<img src="https://attacker/...">` in a Skill's documentation is a
 * tracking pixel that would otherwise log every reader's address and reading
 * time to whoever published it.
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
  return DOMPurify.sanitize(html, { FORBID_TAGS: [...FORBIDDEN_TAGS], FORBID_ATTR: [...FORBIDDEN_ATTRIBUTES] });
}
