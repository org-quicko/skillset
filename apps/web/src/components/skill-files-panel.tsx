import { artifactMediaType, SKILL_FILE_NAME, splitFrontmatter, type ArtifactFile } from "@in-org-quicko/sqillset-shared";
import { ChevronDownIcon, CodeIcon, ExternalLinkIcon, EyeIcon, FileIcon, FolderIcon } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { artifactFileUrl, useArtifactFile, useArtifactFiles } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";
import { renderSkillBody } from "@/lib/render-skill-body";
import { cn, formatBytes } from "@/lib/utils";

// Monaco is around a megabyte of tokenizers, and a visitor who only reads the
// rendered `SKILL.md` never needs any of it. Splitting it out here keeps it
// out of every other page's bundle and off the critical path of this one.
const CodeViewer = lazy(() => import("@/components/code-viewer"));

/**
 * The panel's own height: it fills whatever the page's flex layout leaves for
 * it (see {@link Panel}'s `flex-1` body), so switching between a one-line
 * file and a long one never resizes the page under the reader — only the
 * panel's own contents scroll. Every child below sizes itself from this
 * rather than from its content — hence the `min-h-0` and `flex-1` pairs,
 * which are what let a flex child scroll instead of growing.
 */
const PANEL_HEIGHT = "h-full";

/** One directory of an Artifact and the files directly in it. `""` is the Skill's root. */
interface FileGroup {
  directory: string;
  files: ArtifactFile[];
}

/**
 * The Artifact's files grouped by the directory they sit in, root first and
 * then in the order the API listed them.
 *
 * @remarks
 * One level of grouping rather than a full recursive tree: a Skill's folder
 * is a `SKILL.md` beside a handful of shallow directories (`references/`,
 * `scripts/`, `assets/`), and a nested directory's full path in its header
 * says everything a second level of indentation would.
 */
function groupByDirectory(files: readonly ArtifactFile[]): FileGroup[] {
  const groups = new Map<string, ArtifactFile[]>();

  for (const file of files) {
    const slash = file.path.lastIndexOf("/");
    const directory = slash === -1 ? "" : file.path.slice(0, slash);
    const group = groups.get(directory);
    if (group) group.push(file);
    else groups.set(directory, [file]);
  }

  // The API already sorts by path with `SKILL.md` first, so insertion order
  // is the order to keep — except that the root's own files belong above the
  // directories regardless of how their names happen to sort.
  const entries = [...groups.entries()].map(([directory, files]) => ({ directory, files }));
  const root = entries.filter((group) => group.directory === "");
  return [...root, ...entries.filter((group) => group.directory !== "")];
}

/** The file to show before anyone has picked one: the `SKILL.md`, falling back to whatever is first. */
function defaultSelection(files: readonly ArtifactFile[]): string | undefined {
  return files.find((file) => file.path === SKILL_FILE_NAME)?.path ?? files[0]?.path;
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function FileTree({
  files,
  selected,
  onSelect,
}: {
  files: readonly ArtifactFile[];
  selected: string;
  onSelect: (path: string) => void;
}) {
  const groups = useMemo(() => groupByDirectory(files), [files]);
  // Every directory starts open — a Skill's folder is small enough to take in
  // at once, and a reader who came to browse it should not have to click to
  // see what is there.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  function toggle(directory: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(directory)) next.add(directory);
      return next;
    });
  }

  return (
    <nav aria-label="Skill files" className="flex h-full flex-col gap-0.5 overflow-y-auto p-2">
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.directory);
        return (
          <div key={group.directory} className="flex flex-col gap-0.5">
            {group.directory !== "" && (
              <button
                type="button"
                onClick={() => toggle(group.directory)}
                aria-expanded={!isCollapsed}
                title={group.directory}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <FolderIcon className="size-3.5 shrink-0 opacity-70" />
                <span className="truncate">{group.directory}</span>
                <ChevronDownIcon
                  className={cn("ml-auto size-3.5 shrink-0 opacity-60 transition-transform", isCollapsed && "-rotate-90")}
                />
              </button>
            )}
            {!isCollapsed &&
              group.files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => onSelect(file.path)}
                  aria-current={file.path === selected}
                  title={file.path}
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs transition-colors",
                    group.directory === "" ? "pl-2" : "pl-[1.6rem]",
                    file.path === selected
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {group.directory === "" && <FileIcon className="size-3.5 shrink-0 opacity-70" />}
                  <span className="truncate">{fileName(file.path)}</span>
                </button>
              ))}
          </div>
        );
      })}
    </nav>
  );
}

/** A markdown file's two readings, since a Skill's documentation is written to be read, not inspected. */
type MarkdownView = "preview" | "code";

const VIEW_CONTROLS = [
  { view: "preview", label: "Preview", Icon: EyeIcon },
  { view: "code", label: "Code", Icon: CodeIcon },
] as const;

function ViewToggle({ view, onChange }: { view: MarkdownView; onChange: (view: MarkdownView) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5">
      {VIEW_CONTROLS.map(({ view: candidate, label, Icon }) => (
        <Tooltip key={candidate}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onChange(candidate)}
              aria-pressed={view === candidate}
              aria-label={label}
              className={cn(
                "cursor-pointer rounded p-1 transition-colors",
                view === candidate ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/**
 * A text file in the viewer, in whichever reading is selected: a markdown
 * file's preview is its frontmatter above its rendered prose, and every other
 * file — including that same markdown file's Code reading — is its source.
 *
 * @remarks
 * Both readings put their editor at the same place in this tree, keyed by the
 * file rather than by the fragment, so toggling between them hands the one
 * editor new text instead of tearing it down and building a second.
 *
 * The frontmatter is configuration rather than prose — a markdown renderer
 * turns it into a paragraph of `name: … description: …` — but for a
 * `SKILL.md` it is also the Skill's declaration of itself, so it is shown as
 * what it is instead of dropped. This is where the Skill page's separate
 * Description panel used to live; keeping it here means the fields come from
 * the published file rather than from columns parsed out of it, and there is
 * only one place to read them.
 *
 * The prose is sanitised by `renderSkillBody` — the markup is whoever
 * published the Skill's, not the reader's.
 */
function TextFileViewer({ path, source, view }: { path: string; source: string; view: MarkdownView }) {
  const isPreview = isMarkdownPath(path) && view === "preview";
  const { frontmatter, body } = useMemo(() => splitFrontmatter(source), [source]);
  const html = useMemo(() => (isPreview ? renderSkillBody(body) : ""), [isPreview, body]);

  const hasFrontmatter = frontmatter !== null && frontmatter.trim() !== "";
  // Preview shows only the frontmatter in the editor — the body is below it,
  // rendered — and a file without any has nothing for the editor to hold.
  const showEditor = !isPreview || hasFrontmatter;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", isPreview && "overflow-y-auto")}>
      {showEditor && (
        <div className={cn("flex flex-col", isPreview ? "shrink-0 border-b bg-muted/20" : "min-h-0 flex-1")}>
          {isPreview && (
            <span className="px-4 pt-2.5 text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              Frontmatter
            </span>
          )}
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center py-5">
                <Spinner className="size-5" />
              </div>
            }
          >
            <CodeViewer
              path={path}
              value={isPreview ? (frontmatter ?? "") : source}
              language={isPreview ? "yaml" : undefined}
              fitContent={isPreview}
            />
          </Suspense>
        </div>
      )}
      {isPreview && (
        <div
          className="px-6 py-5 text-sm leading-relaxed text-pretty [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:font-mono [&_code]:text-[0.85em] [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:first:mt-0 [&_h2]:mt-5 [&_h2]:mb-1.5 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:font-semibold [&_hr]:my-5 [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md [&_li]:my-1 [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-2.5 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_table]:my-3 [&_table]:w-full [&_table]:text-left [&_td]:border-t [&_td]:py-1.5 [&_td]:pr-3 [&_th]:py-1.5 [&_th]:pr-3 [&_th]:font-medium [&_ul]:list-disc [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}

/**
 * The chosen file, shown however its kind can be shown: text in the editor,
 * an image inline, a PDF in a frame, and for bytes nothing recognises, its
 * size and a way to fetch it.
 */
function FileViewer({ id, file, view }: { id: string; file: ArtifactFile; view: MarkdownView }) {
  const media = artifactMediaType(file.path);
  const url = artifactFileUrl(id, file.path);
  const content = useArtifactFile(id, file.path);

  if (media.kind === "image") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/40 p-5">
        <img
          src={url}
          alt={file.path}
          className="max-h-full max-w-full rounded-md object-contain outline outline-1 -outline-offset-1 outline-[oklch(0_0_0/0.1)] dark:outline-[oklch(1_0_0/0.1)]"
        />
      </div>
    );
  }

  if (media.kind === "pdf") {
    // A frame, not an `<object>`: the browser's own PDF viewer already has
    // paging, zoom and search, and none of it needs anything from this page.
    return <iframe src={url} title={file.path} className="min-h-0 w-full flex-1 border-0 bg-muted/40" />;
  }

  if (media.kind === "binary") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 p-5 text-center">
        <FileIcon className="size-7 text-muted-foreground" />
        <p className="text-sm font-medium">{fileName(file.path)}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(file.size)} · nothing to preview for this kind of file
        </p>
        <Button variant="outline" size="sm" asChild>
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLinkIcon />
            Open file
          </a>
        </Button>
      </div>
    );
  }

  if (content.isPending) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (content.isError) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-5">
        <p className="text-sm text-destructive">{apiErrorMessage(content.error)}</p>
      </div>
    );
  }

  return <TextFileViewer path={file.path} source={content.data} view={view} />;
}

/** Whether a file has a rendered reading as well as a source one. */
function isMarkdownPath(path: string): boolean {
  return artifactMediaType(path).contentType.startsWith("text/markdown");
}

/**
 * A Skill's Artifact, browsable file by file: the tree of what it holds
 * beside a viewer for whichever file is selected, opening on the `SKILL.md`.
 *
 * @remarks
 * This is the Skill page's primary content, and the reason there is no longer
 * a separate rendered-`SKILL.md` section above it — that section showed the
 * `body` column, which is only ever the `SKILL.md` below its frontmatter, so
 * keeping both would have meant two renderings of the same text with nothing
 * guaranteeing they agreed.
 *
 * The listing and each file come from what storage actually holds, not from
 * anything the publisher declared (ADR-0032). A Skill whose Artifact was
 * never uploaded 404s that listing, and the panel then falls back to
 * rendering `body` on its own — which is the one thing the Registry still has
 * for such a Skill.
 *
 * @param id - The Skill's id.
 * @param body - The Skill's `body` column, shown when there is no Artifact to
 * browse.
 * @example
 * ```tsx
 * <SkillFilesPanel id={skill.id} body={skill.body} />
 * ```
 */
export function SkillFilesPanel({ id, body }: { id: string; body: string }) {
  const listing = useArtifactFiles(id);
  const [selected, setSelected] = useState<string>();
  const [view, setView] = useState<MarkdownView>("preview");

  if (listing.isPending) {
    return (
      <Panel title={SKILL_FILE_NAME}>
        <Skeleton className="h-72 w-full rounded-lg" />
      </Panel>
    );
  }

  // No Artifact — the ordinary state between a publish and its upload. The
  // `body` is still the SKILL.md's own text, so it is shown alone rather than
  // beside a file tree with nothing in it.
  if (listing.isError) {
    return (
      <Panel title={SKILL_FILE_NAME} className="min-h-0 flex-1" contentClassName="p-0">
        <div className={cn("flex flex-col", PANEL_HEIGHT)}>
          <TextFileViewer path={SKILL_FILE_NAME} source={body} view="preview" />
        </div>
      </Panel>
    );
  }

  const files = listing.data.files;
  const path = selected ?? defaultSelection(files);
  const file = files.find((candidate) => candidate.path === path);

  if (!file) return null;

  return (
    <Panel title={`Contents (${files.length})`} className="min-h-0 flex-1" contentClassName="p-0">
      <div className={cn("grid grid-rows-[minmax(0,9rem)_minmax(0,1fr)] sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:grid-rows-1", PANEL_HEIGHT)}>
        <div className="min-h-0 border-b bg-muted/20 sm:border-r sm:border-b-0">
          <FileTree files={files} selected={file.path} onSelect={setSelected} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
            <span className="truncate font-mono text-xs text-muted-foreground" title={file.path}>
              /{file.path}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] text-muted-foreground">{formatBytes(file.size)}</span>
              {isMarkdownPath(file.path) && <ViewToggle view={view} onChange={setView} />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={artifactFileUrl(id, file.path)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open in a new tab"
                    className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>Open in a new tab</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <FileViewer id={id} file={file} view={view} />
        </div>
      </div>
    </Panel>
  );
}
