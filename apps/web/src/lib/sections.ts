/** The catalog sections the top nav switches between, one per Kind the site lists. */
export type SectionKind = "skill" | "mcp" | "plugin";

export interface Section {
  kind: SectionKind;
  /** The nav label and the hero's heading. */
  title: string;
  /** Lower-case, for breadcrumbs and empty states. */
  noun: string;
  nounPlural: string;
  /**
   * What adding one is called. An MCP server is "listed": the Registry only
   * points at a package or endpoint that lives elsewhere, it stores no files.
   */
  publishVerb: "Publish" | "List";
  description: string;
  /** Where the section's list lives. */
  path: string;
  /** What every detail page in this section sits under. */
  detailPrefix: string;
  /**
   * Whether this Kind's Installs are counted. An MCP server's are not:
   * `skillset mcp install` only reads it, so its count is always 0.
   */
  tracksInstalls: boolean;
}

export const SECTIONS: Record<SectionKind, Section> = {
  skill: {
    kind: "skill",
    title: "Skills",
    noun: "skill",
    nounPlural: "skills",
    publishVerb: "Publish",
    description: "Browse and install skills for research, coding, design, automation, and more.",
    path: "/",
    detailPrefix: "/skills/",
    tracksInstalls: true,
  },
  mcp: {
    kind: "mcp",
    title: "MCP Servers",
    noun: "MCP server",
    nounPlural: "MCP servers",
    publishVerb: "List",
    description: "Connect your agents to tools and data through Model Context Protocol servers.",
    path: "/mcp-servers",
    detailPrefix: "/mcp-servers/",
    tracksInstalls: false,
  },
  plugin: {
    kind: "plugin",
    title: "Plugins",
    noun: "plugin",
    nounPlural: "plugins",
    publishVerb: "Publish",
    description: "Bundles of skills, commands, and MCP servers you install in one step.",
    path: "/plugins",
    detailPrefix: "/plugins/",
    tracksInstalls: true,
  },
};

export const SECTION_LIST: readonly Section[] = [SECTIONS.skill, SECTIONS.mcp, SECTIONS.plugin];

/**
 * The section a URL path belongs to — its list or any detail page under it.
 *
 * @param pathname - The URL path.
 * @returns The section; Skills for `/` and for any path no other section claims.
 */
export function sectionForPath(pathname: string): Section {
  return (
    SECTION_LIST.find(
      (section) => section.path !== "/" && (pathname === section.path || pathname.startsWith(section.detailPrefix)),
    ) ?? SECTIONS.skill
  );
}

/** Whether a Resource's `kind` string is one of the site's sections. */
export function isSectionKind(kind: string): kind is SectionKind {
  return Object.hasOwn(SECTIONS, kind);
}
