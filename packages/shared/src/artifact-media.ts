/**
 * What kind of thing a file in an Artifact is, decided from its path alone.
 *
 * The API needs a `content-type` to serve a stored file with, and the web
 * interface needs to know which viewer to reach for — a code editor, an
 * `<img>`, or a "nothing to show here" placeholder. Both answers come from
 * the same table, so a file the interface offers to render is a file the API
 * labels renderably.
 *
 * Deciding from the path is the only option available: an Artifact's bytes
 * are uploaded straight to storage and the API never reads them (ADR-0001,
 * as amended by ADR-0032), so there is no sniffed type to prefer over the
 * extension.
 */

/** How an Artifact's file can be shown. `binary` means it cannot be — offer the bytes instead. */
export type ArtifactMediaKind = "text" | "image" | "pdf" | "binary";

export interface ArtifactMediaType {
  /** The `content-type` the API serves this file with. */
  contentType: string;
  kind: ArtifactMediaKind;
}

const TEXT = (subtype: string): ArtifactMediaType => ({ contentType: `text/${subtype}; charset=utf-8`, kind: "text" });
const CODE = (subtype: string): ArtifactMediaType => ({
  contentType: `application/${subtype}; charset=utf-8`,
  kind: "text",
});
const IMAGE = (subtype: string): ArtifactMediaType => ({ contentType: `image/${subtype}`, kind: "image" });
const BINARY = (contentType: string): ArtifactMediaType => ({ contentType, kind: "binary" });

/**
 * Extension → media type. Keyed without the dot, lowercase.
 *
 * Deliberately a table and not a dependency: the set of things a Skill's
 * folder actually holds is small and known — documentation, scripts,
 * configuration, the occasional screenshot — and a full MIME database would
 * bring thousands of entries to answer a question about a few dozen.
 * Anything unlisted falls back to `application/octet-stream`, which the
 * interface shows as a downloadable file rather than guessing at it.
 */
const MEDIA_TYPES: Record<string, ArtifactMediaType> = {
  // Documentation and plain text.
  md: TEXT("markdown"),
  markdown: TEXT("markdown"),
  mdx: TEXT("markdown"),
  txt: TEXT("plain"),
  rst: TEXT("plain"),
  adoc: TEXT("plain"),
  csv: TEXT("csv"),
  tsv: TEXT("tab-separated-values"),
  log: TEXT("plain"),
  license: TEXT("plain"),

  // Configuration and data.
  json: CODE("json"),
  jsonc: CODE("json"),
  json5: CODE("json"),
  yaml: TEXT("yaml"),
  yml: TEXT("yaml"),
  toml: TEXT("plain"),
  ini: TEXT("plain"),
  cfg: TEXT("plain"),
  conf: TEXT("plain"),
  env: TEXT("plain"),
  properties: TEXT("plain"),
  // Plain text, not `application/xml`: a browser *renders* an XML document,
  // and one in the XHTML namespace carries `<script>` that runs on whatever
  // origin served it. The preview is a code viewer either way, so nothing is
  // lost by labelling it as the text it is shown as.
  xml: TEXT("plain"),
  xsl: TEXT("plain"),
  xhtml: TEXT("plain"),
  svgz: BINARY("application/octet-stream"),
  graphql: TEXT("plain"),
  gql: TEXT("plain"),
  proto: TEXT("plain"),
  sql: TEXT("plain"),

  // Web.
  html: TEXT("html"),
  htm: TEXT("html"),
  css: TEXT("css"),
  scss: TEXT("plain"),
  sass: TEXT("plain"),
  less: TEXT("plain"),
  js: CODE("javascript"),
  mjs: CODE("javascript"),
  cjs: CODE("javascript"),
  jsx: CODE("javascript"),
  ts: CODE("typescript"),
  mts: CODE("typescript"),
  cts: CODE("typescript"),
  tsx: CODE("typescript"),
  vue: TEXT("plain"),
  svelte: TEXT("plain"),

  // Scripts and programs.
  py: TEXT("x-python"),
  rb: TEXT("x-ruby"),
  sh: TEXT("x-shellscript"),
  bash: TEXT("x-shellscript"),
  zsh: TEXT("x-shellscript"),
  fish: TEXT("x-shellscript"),
  ps1: TEXT("plain"),
  bat: TEXT("plain"),
  cmd: TEXT("plain"),
  go: TEXT("x-go"),
  rs: TEXT("x-rust"),
  java: TEXT("x-java-source"),
  kt: TEXT("plain"),
  kts: TEXT("plain"),
  scala: TEXT("plain"),
  swift: TEXT("plain"),
  c: TEXT("x-c"),
  h: TEXT("x-c"),
  cc: TEXT("x-c++"),
  cpp: TEXT("x-c++"),
  hpp: TEXT("x-c++"),
  cs: TEXT("plain"),
  php: TEXT("x-php"),
  pl: TEXT("plain"),
  lua: TEXT("plain"),
  r: TEXT("plain"),
  dart: TEXT("plain"),
  ex: TEXT("plain"),
  exs: TEXT("plain"),
  hs: TEXT("plain"),
  clj: TEXT("plain"),
  el: TEXT("plain"),
  vim: TEXT("plain"),
  dockerfile: TEXT("plain"),
  makefile: TEXT("plain"),
  ipynb: CODE("json"),

  // Images, shown inline.
  png: IMAGE("png"),
  jpg: IMAGE("jpeg"),
  jpeg: IMAGE("jpeg"),
  gif: IMAGE("gif"),
  webp: IMAGE("webp"),
  avif: IMAGE("avif"),
  bmp: IMAGE("bmp"),
  ico: IMAGE("x-icon"),
  // Rendered as an image, not as its markup: an Artifact's SVG is content to
  // look at, and an inline `<svg>` from an untrusted publisher is a script
  // host. An `<img src>` cannot run what it loads.
  svg: { contentType: "image/svg+xml", kind: "image" },

  pdf: { contentType: "application/pdf", kind: "pdf" },

  // Everything below is bytes to hand over rather than show.
  zip: BINARY("application/zip"),
  gz: BINARY("application/gzip"),
  tar: BINARY("application/x-tar"),
  tgz: BINARY("application/gzip"),
  bz2: BINARY("application/x-bzip2"),
  xz: BINARY("application/x-xz"),
  "7z": BINARY("application/x-7z-compressed"),
  woff: BINARY("font/woff"),
  woff2: BINARY("font/woff2"),
  ttf: BINARY("font/ttf"),
  otf: BINARY("font/otf"),
  mp3: BINARY("audio/mpeg"),
  wav: BINARY("audio/wav"),
  mp4: BINARY("video/mp4"),
  webm: BINARY("video/webm"),
  wasm: BINARY("application/wasm"),
  so: BINARY("application/octet-stream"),
  dll: BINARY("application/octet-stream"),
  exe: BINARY("application/octet-stream"),
  xlsx: BINARY("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  docx: BINARY("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  pptx: BINARY("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
};

/** Extensionless file names that are nonetheless known to be text. */
const KNOWN_TEXT_FILE_NAMES = new Set([
  "dockerfile",
  "makefile",
  "license",
  "licence",
  "notice",
  "readme",
  "changelog",
  "authors",
  "contributing",
  "codeowners",
  "procfile",
  "gemfile",
  "rakefile",
  "justfile",
  "brewfile",
]);

const UNKNOWN: ArtifactMediaType = { contentType: "application/octet-stream", kind: "binary" };

/**
 * The media type of a file in an Artifact, from its path.
 *
 * @remarks
 * Matches on the extension, then — for a file that has none — on the whole
 * name against a short list of conventionally-extensionless text files
 * (`Dockerfile`, `LICENSE`, `Makefile`). Anything else is
 * `application/octet-stream` of kind `binary`, which is the honest answer
 * for bytes nothing here recognises.
 *
 * @param path - The file's path, relative to the Skill's root.
 * @returns The `content-type` to serve it with and how it can be shown.
 * @example
 * ```ts
 * artifactMediaType("references/java.md"); // { contentType: "text/markdown; charset=utf-8", kind: "text" }
 * artifactMediaType("assets/logo.png"); // { contentType: "image/png", kind: "image" }
 * artifactMediaType("bin/tool"); // { contentType: "application/octet-stream", kind: "binary" }
 * ```
 */
export function artifactMediaType(path: string): ArtifactMediaType {
  const fileName = (path.split("/").pop() ?? "").toLowerCase();
  const dot = fileName.lastIndexOf(".");

  if (dot > 0) {
    const extension = fileName.slice(dot + 1);
    const byExtension = MEDIA_TYPES[extension];
    if (byExtension) return byExtension;
  }

  // No usable extension: `Dockerfile`, `LICENSE`, `Makefile` and friends, and
  // also `Dockerfile.dev` — the part before the first dot is what names those.
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  if (KNOWN_TEXT_FILE_NAMES.has(stem)) return TEXT("plain");

  return UNKNOWN;
}
