import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * A Skill's `SKILL.md` body, as sanitised HTML. Markup inside a `SKILL.md`
 * is untrusted — it comes from whoever last published the Skill, not from
 * the reader viewing it — so it goes through DOMPurify's allowlist before
 * ever reaching the DOM.
 */
export function renderSkillBody(markdown: string): string {
  const html = marked.parse(markdown, { async: false, breaks: false });
  // `target` is stripped rather than allowed through with a forced
  // `rel="noopener noreferrer"`: a link opening in the reader's own tab has
  // no `window.opener` to hand a publisher-controlled page in the first place.
  return DOMPurify.sanitize(html, { FORBID_ATTR: ["target"] });
}
