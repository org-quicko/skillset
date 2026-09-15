import {
  parseSkillSourceUrl,
  SkillValidationError,
  type SkillFile,
  type SkillSourceLocation,
} from "@in-org-quicko/sqillset-shared";
import { CircleAlertIcon, CircleCheckIcon, UploadIcon } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { connectHref, useConnections, useRepositories } from "@/hooks/use-connections";
import { GIT_PROVIDER_ICONS } from "@/components/provider-icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SkillUploadError, usePublishSkill } from "@/hooks/use-skills";
import { ApiError, apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { discoverSkillSources, fetchSkillFilesAt } from "@/lib/read-source-files";
import { readDroppedFiles, readPickedFiles } from "@/lib/read-skill-files";

/**
 * One Skill folder's label in the candidate list.
 *
 * @remarks
 * Relative to the project, which is what makes the bare label readable: the
 * panel's own header already names the project, so a row only has to say
 * which folder inside it — and the root needs words because it has no path.
 */
function sourceLabel(location: SkillSourceLocation): string {
  return location.path || "Repository root";
}

/** How a chosen source reads in the panel header — the project, and the folder when it isn't the root. */
function sourceTitle(location: SkillSourceLocation): string {
  return location.path ? `${location.project}/${location.path}` : location.project;
}

/**
 * Supplies the scheme a pasted URL is missing.
 *
 * @remarks
 * `parseSkillSourceUrl` requires an absolute URL, but `github.com/owner/repo`
 * copied out of a README is the same thing to everyone except `new URL`. Only
 * the scheme is guessed — a host this Registry does not read from still fails
 * to parse, so this cannot widen what is accepted.
 *
 * @param url - The URL as typed.
 * @returns `url`, trimmed, with `https://` prepended if it named no scheme.
 */
function withScheme(url: string): string {
  const trimmed = url.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * The Skill source a search box's contents name, if any.
 *
 * @remarks
 * Deliberately silent on failure: this runs on every keystroke to decide
 * whether to offer an "import this URL" row beside the repository matches, so
 * a half-typed URL — or an ordinary search term — simply names nothing yet.
 * The refusal a writer should read is the one `runImport` raises when they
 * actually submit.
 *
 * @param query - The search box's contents.
 * @returns The location named, or `null` when the text is not a Skill source URL.
 * @example
 * ```ts
 * locationOf("github.com/acme/skills"); // { provider: "github", project: "acme/skills", … }
 * locationOf("code review");            // null
 * ```
 */
function locationOf(query: string): SkillSourceLocation | null {
  if (query.trim().length === 0) return null;
  try {
    return parseSkillSourceUrl(withScheme(query));
  } catch {
    return null;
  }
}

/** One Skill's outcome from importing more than one at once — reported individually, never aborting the rest. */
type ImportOutcome =
  | { path: string; status: "published"; name: string }
  | { path: string; status: "failed"; message: string };

function describeFailure(error: unknown): string {
  if (error instanceof SkillValidationError) {
    return error.field ? `${error.message} (${error.field})` : error.message;
  }
  if (error instanceof SkillUploadError) return error.message;
  return apiErrorMessage(error);
}

/**
 * The refusals whose remedy is a trip to the provider: what the button says,
 * and which of the two trips it is.
 *
 * @remarks
 * These land in **two different places**, which is the whole reason
 * `destination` exists. Authorizing and choosing repositories were one page
 * until the installation page turned out to mint no code on a re-visit
 * (ADR-0024); conflating them now would send a writer whose app is not
 * installed through an authorization that succeeds and changes nothing.
 *
 * `app_not_installed` is the one worth having a button for at all: its message
 * already names the owner, but the fix is to go and choose that repository, and
 * a writer who is not an organisation owner will find out there that they have
 * to ask one.
 */
const REMEDIES: Record<string, { label: string; destination: "connect" | "repositories" }> = {
  not_connected: { label: "Connect GitHub", destination: "connect" },
  connection_expired: { label: "Reconnect GitHub", destination: "connect" },
  app_not_installed: { label: "Choose repositories on GitHub", destination: "repositories" },
};

/** A read failure, and the trip to the provider that would fix it, if there is one. */
interface ReadFailure {
  message: string;
  /** The provider to send them to, or `null` when nothing here would help. */
  remedy: { provider: string; label: string; destination: "connect" | "repositories" } | null;
}

/**
 * Turns a failed import into a message, and an action when one exists.
 *
 * @param error - Whatever the discovery walk threw.
 * @param provider - The Git Provider the source named. Always known by the time
 * a walk can fail, since nothing is walked until the URL has parsed.
 * @returns The message to show, and the remedy to offer.
 */
function readFailure(error: unknown, provider: string): ReadFailure {
  const message = error instanceof Error ? error.message : "Could not read that URL. Try again.";
  if (!(error instanceof ApiError)) return { message, remedy: null };

  const remedy = REMEDIES[error.code];
  return { message, remedy: remedy ? { provider, ...remedy } : null };
}

/**
 * Which step of the GitHub tab is on screen.
 *
 * @remarks
 * Exactly one at a time, and that is the point: picking a source, choosing
 * Skills, and reading what happened used to stack on top of one another inside
 * a height-capped dialog, so the list a writer had just triggered appeared
 * below the picker they no longer needed and off the bottom of the surface.
 *
 * Every step after `pick` carries its `source`, so the panel can keep saying
 * where the Skills are coming from without re-deriving it from the search box
 * — which the writer is free to edit in the meantime.
 */
type ImportStep =
  | { kind: "pick" }
  | { kind: "reading"; source: SkillSourceLocation }
  | { kind: "choose"; source: SkillSourceLocation; found: SkillSourceLocation[] }
  | { kind: "publishing"; source: SkillSourceLocation; total: number; done: number }
  | { kind: "report"; source: SkillSourceLocation; outcomes: ImportOutcome[] };

/**
 * Extends a short control's hit area to the full height of the 40px row it
 * sits in, without changing how big it looks.
 *
 * @remarks
 * The rows this is used in are exactly `min-h-10`, so the grown box fills its
 * row and stops — two of these can sit in adjacent rows without their hit
 * areas overlapping. Horizontal insets stay at zero for the same reason.
 */
const ROW_HIT_AREA = "relative after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']";

/**
 * Both tabs' minimum content height, so switching between them never resizes
 * the dialog.
 *
 * @remarks
 * Sized to the GitHub tab's default (repository-picker) state — the shortest
 * of its steps — so this is a floor, not a cap: GitHub's own later steps
 * (choosing candidates, publishing, the report) stay free to grow past it.
 */
const TAB_CONTENT_MIN_HEIGHT = "min-h-[330px]";

/** A Git Provider's brand mark, and nothing when the provider has none — an unknown provider is a missing icon, never a missing row. */
function SourceGlyph({ provider, className }: { provider: string; className?: string }) {
  const Glyph = GIT_PROVIDER_ICONS[provider];
  return Glyph ? <Glyph className={cn("size-4 shrink-0", className)} /> : null;
}

/** The one surface the GitHub tab draws, whichever step is on it — rounded to stay concentric with the rows inset inside it. */
function SourcePanel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col overflow-hidden rounded-xl border", className)}>{children}</div>;
}

/**
 * A `SourcePanel`'s header: which project its Skills are coming from, and
 * whatever belongs to the right of that — the way back, a spinner, a count.
 */
function SourceHeader({ source, trailing }: { source: SkillSourceLocation; trailing?: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center gap-2 border-b px-3 py-1.5">
      <SourceGlyph provider={source.provider} />
      <span className="truncate text-sm font-medium">{sourceTitle(source)}</span>
      {trailing && <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">{trailing}</div>}
    </div>
  );
}

/**
 * Placeholder shaped like the "choose" step it leads into — the same count
 * bar and row area — so the list holds its height across the reading-to-
 * choose handoff instead of resizing once the real candidate list arrives.
 */
function DiscoverySkeleton() {
  return (
    <>
      <div className="flex min-h-10 items-center justify-between gap-2 px-2 pt-1">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="flex flex-col gap-1 p-1">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex min-h-10 items-center gap-2.5 px-2">
            <Skeleton className="size-4 shrink-0 rounded-[4px]" />
            <Skeleton className="h-3.5" style={{ width: `${56 - row * 6}%` }} />
          </div>
        ))}
      </div>
    </>
  );
}

/** Placeholder rows shaped like the repository list, shown while it loads. */
function RepositorySkeleton() {
  return (
    <div className="flex flex-col gap-3.5 p-3">
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-3.5" style={{ width: `${64 - row * 8}%` }} />
      ))}
    </div>
  );
}

/**
 * A failed read, and the trip to the provider that would fix it.
 *
 * @remarks
 * Rendered by both tabs, because both can fail before a mutation exists to
 * carry the error: a folder that vanishes mid-drag and a repository the
 * writer's Connection cannot see are the same kind of refusal here.
 *
 * @param failure - What went wrong, and the remedy if there is one.
 * @param manageAccessUrl - Where a provider's repository-selection page lives,
 * or `null` when this Registry doesn't know — built server-side from the
 * Integration's app slug, which this form cannot see.
 */
function ReadErrorNotice({
  failure,
  manageAccessUrl,
}: {
  failure: ReadFailure;
  manageAccessUrl: (provider: string) => string | null;
}) {
  // Two destinations, and picking the wrong one wastes the writer's trip:
  // authorizing does not install the app, and installing it does not
  // authorize. A repository remedy with no URL to send them to draws no
  // button — the message already names the owner to ask.
  const href = failure.remedy
    ? failure.remedy.destination === "connect"
      ? connectHref(failure.remedy.provider)
      : manageAccessUrl(failure.remedy.provider)
    : null;

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-pretty text-destructive">{failure.message}</p>
      {failure.remedy && href && (
        <Button asChild variant="outline" size="sm">
          <a
            href={href}
            {...(failure.remedy.destination === "repositories" ? { target: "_blank", rel: "noreferrer" } : {})}
          >
            {failure.remedy.label}
          </a>
        </Button>
      )}
    </div>
  );
}

/**
 * One checkbox row in the candidate list — the whole row toggles, not just the
 * 16px box drawn in it.
 *
 * @remarks
 * A wrapping `<label>` rather than a `for` on the text: Radix renders the
 * checkbox as a `<button>`, which is a labelable element, so the label
 * forwards a click from anywhere in the row to it — and a click that lands on
 * the box itself is not forwarded twice, because a label skips its activation
 * behaviour for events already targeting an interactive descendant.
 *
 * The focus ring follows the row rather than the box, so what is focused and
 * what a click acts on are the same shape. The box keeps its own ring
 * suppressed for the same reason.
 */
function CandidateRow({
  label,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-10 items-center gap-2.5 rounded-md px-2 transition-colors duration-150 ease-out",
        "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        disabled ? "opacity-50" : "cursor-pointer hover:bg-muted",
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onToggle(next === true)}
        className="focus-visible:border-input focus-visible:ring-0"
      />
      <span className="truncate text-sm">{label}</span>
    </label>
  );
}

export function PublishSkillForm({ onPublished }: { onPublished: (name: string) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  // A read failure (a file vanishes mid-drag, a permission error, an import
  // that 404s) happens before the mutation is ever invoked, so it can't live
  // on `publish`.
  const [readError, setReadError] = useState<ReadFailure | null>(null);
  // Doubles as the repository filter and the URL field: which one it is falls
  // out of whether the text parses, not out of a mode the writer picks.
  const [query, setQuery] = useState("");
  const [step, setStep] = useState<ImportStep>({ kind: "pick" });
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const publish = usePublishSkill();
  // Also read for the repository-selection remedy's URL (built server-side
  // from the Integration's app slug this form cannot see) and to tell a
  // connected GitHub picker from a bare "Connect GitHub" prompt.
  const connections = useConnections();
  const githubConnection = connections.data?.items.find((item) => item.provider === "github");
  const githubConnectable = connections.data?.connectable.find((entry) => entry.provider === "github");
  const repositories = useRepositories("github", Boolean(githubConnection));

  const typedSource = locationOf(query);
  // Undefined (not null) when there's no match, so it doubles as the prop's own "use the default" value.
  const TypedSourceIcon = typedSource ? GIT_PROVIDER_ICONS[typedSource.provider] : undefined;
  const manageAccessUrl = (provider: string) =>
    connections.data?.connectable.find((entry) => entry.provider === provider)?.manage_access_url ?? null;
  const isBusy = publish.isPending || step.kind === "reading" || step.kind === "publishing";

  function handleFiles(files: SkillFile[]) {
    setReadError(null);
    publish.mutate(files, { onSuccess: (skill) => onPublished(skill.name) });
  }

  /** Back to picking a source, keeping whatever was typed so a corrected URL doesn't have to be retyped. */
  function reset() {
    setStep({ kind: "pick" });
    setReadError(null);
    setSelectedPaths(new Set());
  }

  /** Editing the query while a source is being read or chosen backs out to "pick" — there is no separate "Change" control. */
  function handleQueryChange(value: string) {
    setQuery(value);
    if (step.kind !== "pick") reset();
  }

  /**
   * Publishes the chosen Skill folders, one at a time.
   *
   * @remarks
   * A Skill's own failure to fetch or publish is reported and does not stop the
   * rest — the same "outcome per Skill" shape the CLI's multi-Skill publish
   * reports. One Skill that published is the exception: there is nothing to
   * report, so it goes straight to `onPublished` and gets the same
   * close-and-navigate a drag-and-drop publish does.
   *
   * @param source - What the writer picked, kept on screen throughout.
   * @param chosen - The folders to publish, in the order they were found.
   */
  async function publishLocations(source: SkillSourceLocation, chosen: SkillSourceLocation[]) {
    const outcomes: ImportOutcome[] = [];
    for (const [index, location] of chosen.entries()) {
      setStep({ kind: "publishing", source, total: chosen.length, done: index });
      try {
        const files = await fetchSkillFilesAt(location);
        const skill = await publish.mutateAsync(files);
        outcomes.push({ path: location.path, status: "published", name: skill.name });
      } catch (error) {
        outcomes.push({ path: location.path, status: "failed", message: describeFailure(error) });
      }
    }

    const [only] = outcomes;
    if (outcomes.length === 1 && only.status === "published") {
      onPublished(only.name);
      return;
    }
    setStep({ kind: "report", source, outcomes });
  }

  /**
   * Discovers and imports whatever `url` names — a bare repository (which may
   * hold more than one Skill, so a pick is offered) or a folder naming exactly
   * one. Shared by the search box and a repository picked from the list: the
   * latter hands its `html_url` here rather than duplicating the walk.
   */
  async function runImport(url: string) {
    if (isBusy) return;

    let source: SkillSourceLocation;
    try {
      source = parseSkillSourceUrl(withScheme(url));
    } catch (error) {
      // Nothing was walked, so there is no provider to send them to and no
      // remedy but fixing the URL — which `parseSkillSourceUrl` explains.
      setReadError({ message: describeFailure(error), remedy: null });
      return;
    }

    setReadError(null);
    setStep({ kind: "reading", source });
    try {
      const found = await discoverSkillSources(withScheme(url));
      if (found.length === 1) {
        await publishLocations(source, found);
      } else {
        setSelectedPaths(new Set(found.map((location) => location.path)));
        setStep({ kind: "choose", source, found });
      }
    } catch (error) {
      setStep({ kind: "pick" });
      setReadError(readFailure(error, source.provider));
    }
  }

  function toggleCandidate(path: string, checked: boolean) {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  }

  async function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (isBusy) return;
    try {
      handleFiles(await readDroppedFiles(event.dataTransfer.items));
    } catch {
      setReadError({ message: "Could not read the dropped folder. Try again.", remedy: null });
    }
  }

  async function handlePicked(event: React.ChangeEvent<HTMLInputElement>) {
    // Snapshot into a plain array before resetting `.value` — `.files` is a
    // live FileList, and clearing the input (so picking the same folder
    // again still fires onChange) can empty that same list out from under
    // a reference held past this point instead of swapping in a new one.
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0 || isBusy) return;
    try {
      handleFiles(await readPickedFiles(files));
    } catch {
      setReadError({ message: "Could not read the chosen folder. Try again.", remedy: null });
    }
  }

  return (
    <Tabs defaultValue="upload">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="upload" disabled={isBusy}>
          Drag and drop
        </TabsTrigger>
        <TabsTrigger value="github" disabled={isBusy}>
          GitHub
        </TabsTrigger>
      </TabsList>

      <TabsContent value="upload" className={cn("mt-4 flex flex-col gap-3", TAB_CONTENT_MIN_HEIGHT)}>
        <button
          type="button"
          disabled={isBusy}
          onDragOver={(event) => {
            event.preventDefault();
            if (!isDragging) setIsDragging(true);
          }}
          onDragLeave={(event) => {
            // `dragleave` fires when the pointer crosses onto a child element
            // too, not just when it leaves the drop zone entirely — only
            // clear the highlight once it's genuinely outside.
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
          }}
          onDrop={handleDrop}
          // Dropping is read via `webkitGetAsEntry` and accepts a folder or a
          // lone SKILL.md either way (see `readDroppedFiles`). Clicking opens
          // a native dialog, which can only ever be in one mode or the
          // other — `webkitdirectory` below picks folder-picking mode, so a
          // single markdown file has to be dragged in instead.
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors duration-150 ease-out",
            isDragging ? "border-primary bg-accent" : "border-border",
            isBusy ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-muted/50",
          )}
        >
          <UploadIcon className="size-5 text-muted-foreground" />
          <p className="text-sm text-pretty text-muted-foreground">
            Drag and drop a Skill&apos;s folder or a SKILL.md file here, or{" "}
            <span className="text-foreground underline underline-offset-2">browse for a folder</span>
          </p>
        </button>
        {/* Kept outside the button — HTML doesn't allow interactive content
            nested inside one — but still hidden and driven entirely by
            `fileInputRef`, so it needs no layout of its own. */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handlePicked}
          // Nonstandard but universally supported attribute for picking a
          // folder from the file dialog — not in React's JSX typings.
          {...{ webkitdirectory: "true", directory: "true" }}
        />
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          <li>A folder must include a SKILL.md file</li>
          <li>A markdown file must have its skill name and description in YAML frontmatter</li>
        </ul>
        {readError && <ReadErrorNotice failure={readError} manageAccessUrl={manageAccessUrl} />}
        {/* Only this tab publishes through `publish.mutate` directly. Every
            GitHub failure lands in an `ImportOutcome` instead, so the two
            can't report the same error twice. */}
        {publish.isPending && <p className="text-sm text-muted-foreground">Publishing…</p>}
        {publish.isError && <p className="text-sm text-pretty text-destructive">{describeFailure(publish.error)}</p>}
      </TabsContent>

      <TabsContent value="github" className={cn("mt-4 flex flex-col gap-3", TAB_CONTENT_MIN_HEIGHT)}>
        {/* One search box for both ways in, because they are the same question:
            a repository this writer's Connection can see, or one named by URL.
            Which it is falls out of whether the text parses, so there is no
            mode to choose and no second field competing for the same intent.
            It stays mounted through reading and choosing, too — picking a
            repository or submitting a URL swaps what the list below it shows,
            never the box itself, so the query that got them here stays put. */}
        {(step.kind === "pick" || step.kind === "reading" || step.kind === "choose") && (
          <>
            <SourcePanel>
              <Command
                shouldFilter={step.kind === "pick"}
                className="rounded-none! bg-transparent **:data-[slot=input-group]:rounded-md!"
              >
                <CommandInput
                  placeholder="Search your repositories, or paste a repository URL"
                  value={query}
                  onValueChange={handleQueryChange}
                  disabled={isBusy}
                  icon={TypedSourceIcon && <TypedSourceIcon className="size-4 shrink-0 opacity-70" />}
                />
                <CommandList className={step.kind === "pick" ? "h-64" : undefined}>
                  {step.kind === "pick" && (
                    <>
                      {typedSource && (
                        <CommandGroup heading="From URL">
                          <CommandItem
                            value={query}
                            disabled={isBusy}
                            onSelect={() => runImport(query)}
                            className="rounded-md"
                          >
                            <SourceGlyph provider={typedSource.provider} />
                            <span className="truncate">{sourceTitle(typedSource)}</span>
                            {/* The field looks like a search box, so the key that
                                imports what was pasted into it is worth naming. */}
                            <CommandShortcut>↵</CommandShortcut>
                          </CommandItem>
                        </CommandGroup>
                      )}

                      {/* Connection-aware, and in the same place the repositories
                          would be rather than in a block of its own above them: a
                          writer with no GitHub Connection is offered one, and a
                          connected writer gets every repository it can see.
                          Absent while an Admin has configured no GitHub
                          Integration at all, since there is then nothing to
                          connect to or list. */}
                      {githubConnectable && !githubConnection && (
                        <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
                          <p className="text-sm text-pretty text-muted-foreground">
                            Connect GitHub to search your own repositories, public and private.
                          </p>
                          <Button asChild size="sm">
                            <a href={connectHref("github", githubConnectable.id)}>Connect GitHub</a>
                          </Button>
                        </div>
                      )}

                      {githubConnection && (
                        <>
                          {repositories.isLoading && <RepositorySkeleton />}
                          {repositories.isError && (
                            <p className="px-6 py-7 text-center text-sm text-pretty text-destructive">
                              {apiErrorMessage(repositories.error)}
                            </p>
                          )}
                          {repositories.data && (
                            <>
                              <CommandEmpty>No repositories match.</CommandEmpty>
                              <CommandGroup heading="Your repositories">
                                {repositories.data.items.map((repository) => (
                                  <CommandItem
                                    key={repository.full_name}
                                    value={repository.full_name}
                                    disabled={isBusy}
                                    onSelect={() => {
                                      setQuery(repository.html_url);
                                      runImport(repository.html_url);
                                    }}
                                    className="cursor-pointer rounded-md"
                                  >
                                    <span className="truncate">{repository.full_name}</span>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </>
                          )}
                        </>
                      )}

                      {!githubConnectable && !typedSource && (
                        <p className="px-6 py-7 text-center text-sm text-pretty text-muted-foreground">
                          Paste a repository URL to publish a Skill from GitHub or GitLab.
                        </p>
                      )}
                    </>
                  )}

                  {/* A bare repository has to be searched before there is
                      anything to show, so it gets a skeleton of the list about
                      to appear; a URL already naming a folder resolves to one
                      Skill and has no list coming, so it keeps a plain line. */}
                  {step.kind === "reading" && (
                    <div className="animate-in fade-in-0 duration-150 ease-out">
                      {step.source.path === "" ? (
                        <DiscoverySkeleton />
                      ) : (
                        <p className="px-6 py-7 text-center text-sm text-muted-foreground">
                          Reading {sourceTitle(step.source)}…
                        </p>
                      )}
                    </div>
                  )}

                  {step.kind === "choose" && (
                    <div className="animate-in fade-in-0 duration-150 ease-out">
                      <div className="flex min-h-10 items-center justify-between gap-2 px-2 pt-1">
                        <p className="truncate text-xs text-muted-foreground">
                          <span className="tabular-nums">{step.found.length}</span> Skills found in{" "}
                          {sourceTitle(step.source)}
                        </p>
                        <label
                          className={cn(
                            ROW_HIT_AREA,
                            "flex shrink-0 items-center gap-2 rounded-md pl-2",
                            "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                            isBusy ? "opacity-50" : "cursor-pointer",
                          )}
                        >
                          <Checkbox
                            checked={
                              selectedPaths.size === 0
                                ? false
                                : selectedPaths.size === step.found.length
                                  ? true
                                  : "indeterminate"
                            }
                            disabled={isBusy}
                            onCheckedChange={(next) =>
                              setSelectedPaths(
                                next === true ? new Set(step.found.map((location) => location.path)) : new Set(),
                              )
                            }
                            className="focus-visible:border-input focus-visible:ring-0"
                          />
                          <span className="text-xs text-muted-foreground">Select all</span>
                        </label>
                      </div>
                      <ul className="flex flex-col p-1">
                        {step.found.map((location) => (
                          <li key={location.path}>
                            <CandidateRow
                              label={sourceLabel(location)}
                              checked={selectedPaths.has(location.path)}
                              disabled={isBusy}
                              onToggle={(checked) => toggleCandidate(location.path, checked)}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CommandList>
              </Command>
            </SourcePanel>

            {step.kind === "choose" ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={isBusy || selectedPaths.size === 0}
                  onClick={() =>
                    publishLocations(
                      step.source,
                      step.found.filter((location) => selectedPaths.has(location.path)),
                    )
                  }
                >
                  {/* One flex child, so the button's own `gap-1.5` can't pry the
                      label apart — and no count while there is nothing to count,
                      since "Publish 0 Skills" reads as an instruction to do it. */}
                  <span className="tabular-nums">
                    {selectedPaths.size === 0
                      ? "Publish"
                      : `Publish ${selectedPaths.size} ${selectedPaths.size === 1 ? "Skill" : "Skills"}`}
                  </span>
                </Button>
              </div>
            ) : (
              step.kind === "pick" &&
              /* The failure sits where the hint would, so it reads as the
                 answer to what was just typed rather than a line after an
                 aside. */
              (readError ? (
                <ReadErrorNotice failure={readError} manageAccessUrl={manageAccessUrl} />
              ) : (
                <p className="text-xs text-pretty text-muted-foreground">
                  A public repository URL works without connecting — a project&apos;s page, or a folder view inside it.
                </p>
              ))
            )}
          </>
        )}

        {step.kind === "publishing" && (
          <SourcePanel className="flex-1">
            <SourceHeader source={step.source} trailing={<Spinner className="size-4" />} />
            <div className="flex flex-1 items-center justify-center px-6">
              <p className="text-center text-sm text-muted-foreground">
                {step.total === 1 ? (
                  "Publishing…"
                ) : (
                  <>
                    Publishing <span className="tabular-nums">{step.done + 1}</span> of{" "}
                    <span className="tabular-nums">{step.total}</span>…
                  </>
                )}
              </p>
            </div>
          </SourcePanel>
        )}

        {step.kind === "report" && (
          <SourcePanel className="animate-in fade-in-0 duration-150 ease-out">
            <SourceHeader
              source={step.source}
              trailing={
                <span className="text-xs tabular-nums text-muted-foreground">
                  {step.outcomes.filter((outcome) => outcome.status === "published").length} of {step.outcomes.length}{" "}
                  published
                </span>
              }
            />
            <ul className="scrollbar-hidden flex max-h-56 flex-col overflow-y-auto p-1">
              {step.outcomes.map((outcome) => (
                <li key={outcome.path} className="flex min-h-9 items-start gap-2.5 px-2 py-1.5 text-sm">
                  {outcome.status === "published" ? (
                    <CircleCheckIcon className="mt-px size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <CircleAlertIcon className="mt-px size-4 shrink-0 text-destructive" />
                  )}
                  {outcome.status === "published" ? (
                    <span className="truncate">{outcome.name}</span>
                  ) : (
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{sourceLabel({ ...step.source, path: outcome.path })}</span>
                      <span className="text-pretty text-destructive">{outcome.message}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex justify-end border-t px-3 py-2.5">
              <Button type="button" variant="outline" onClick={reset}>
                Publish another
              </Button>
            </div>
          </SourcePanel>
        )}
      </TabsContent>
    </Tabs>
  );
}
