import { importedSource, PLUGIN_AGENTS, PLUGIN_README_FILE_NAME } from "@in-org-quicko/skillset-shared";
import { DownloadIcon, EllipsisIcon, ExternalLinkIcon, PencilIcon, TagsIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { DeleteSkillDialog } from "@/components/delete-skill-dialog";
import { EditTagsDialog } from "@/components/edit-tags-dialog";
import { GIT_PROVIDER_ICONS } from "@/components/provider-icons";
import { InstallTrendChart } from "@/components/install-trend-chart";
import { McpDetailPanel } from "@/components/mcp-detail-panel";
import { AgentIcons } from "@/components/agent-icons";
import { Panel } from "@/components/panel";
import { Reveal } from "@/components/reveal";
import { SkillFilesPanel } from "@/components/skill-files-panel";
import { PluginComponentsPanel } from "@/components/plugin-components-panel";
import { PluginInstallCard } from "@/components/plugin-install-card";
import { PublishMcpForm } from "@/components/publish-mcp-form";
import { UpdatePluginForm } from "@/components/update-plugin-form";
import { SkillInstallCard } from "@/components/skill-install-card";
import { FormDialog, FormDialogHeader } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDownloadSkillArtifact, useSkill, useSkillInstallTrend } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";
import { SECTIONS } from "@/lib/sections";
import { cn, formatDate, splitAllowedTools, userDisplayName, userInitials } from "@/lib/utils";

/** The placeholder page shown while a Skill loads — mirrors the real two-column layout. */
function SkillDetailSkeleton() {
  return (
    <div className="flex flex-col gap-3.5">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-8 w-64" />
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <div className="mt-2 grid gap-7 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-[34rem] w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children,
  stacked = false,
}: {
  label: string;
  children: React.ReactNode;
  stacked?: boolean;
}) {
  if (stacked) {
    return (
      <div className="flex flex-col gap-2 border-b px-5 py-3 last:border-b-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="min-w-0 text-sm">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b px-5 py-3 last:border-b-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      {/* `min-w-0` so a value that wants to truncate can: a flex item will not
          shrink below its content otherwise, and a long Namespace wraps to
          three lines instead. */}
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

/**
 * The Details panel's Namespace value: one line, truncated, with the whole of
 * it in a tooltip.
 *
 * @remarks
 * Truncated rather than wrapped because `owner/repo` for a long organisation
 * runs to three lines in this column and pushes the rest of the panel down for
 * a value most readers only glance at. Unlike the Source beside it, this one
 * has to stay *readable* rather than just identifiable — it is the string a
 * reader retypes after `--namespace` — so the full value is always one hover
 * away, and `tabIndex` makes it one Tab away too, since a bare span is not
 * focusable and the tooltip would otherwise be pointer-only.
 */
function NamespaceValue({ namespace }: { namespace: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="block truncate rounded-sm text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {namespace}
        </span>
      </TooltipTrigger>
      <TooltipContent>{namespace}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The Details panel's source value: the Git Provider's mark, linking out to the
 * repository a Skill was Imported from.
 *
 * The icon carries the whole value because the URL underneath is long, and the
 * one thing a reader wants from it at a glance is which provider it is. The
 * address itself stays reachable — as the link's target, its tooltip, and its
 * accessible name — rather than taking up a row it would have to truncate.
 *
 * A host no Git Provider claims falls back to the host as text. An Import
 * cannot produce one, but a hand-written publish can declare any http(s) URL
 * (ADR-0041), and showing it is better than an icon that would name the wrong
 * provider or a row that silently disappears.
 */
function SourceLink({ source }: { source: { url: string; provider: string | null } }) {
  const Icon = source.provider ? GIT_PROVIDER_ICONS[source.provider] : undefined;
  const label = `Open the source repository at ${new URL(source.url).hostname}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={label}
          className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          {Icon ? (
            <Icon className="size-4" aria-hidden="true" />
          ) : (
            <>
              <span className="max-w-[150px] truncate">{new URL(source.url).hostname}</span>
              <ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
            </>
          )}
        </a>
      </TooltipTrigger>
      <TooltipContent>{source.url}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The Details panel's tool-access value: one Badge per tool a Skill claims,
 * or a note that it claims nothing in particular.
 *
 * A Skill that declares no `allowed-tools` is not restricted — it inherits
 * whatever the Agent already permits — so the empty case says that rather
 * than reading as "no access".
 */
function ToolAccess({ allowedTools }: { allowedTools: string | null }) {
  const tools = splitAllowedTools(allowedTools);

  if (tools.length === 0) {
    return <span className="text-muted-foreground">Unrestricted</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tools.map((tool) => (
        <Badge key={tool} variant="secondary" title={tool} className="max-w-full shrink font-mono text-[11px]">
          <span className="truncate">{tool}</span>
        </Badge>
      ))}
    </div>
  );
}

/**
 * A Skill's page: breadcrumb, then title with download and manage actions
 * aligned beside it, then a two-column layout — the install command and the
 * Artifact's browsable contents on the left; installs and publisher details
 * on the right. Fetches the Skill once; the widgets below take it as a prop.
 */
export function SkillDetail({
  name,
  namespace,
  canDelete,
  canEditTags,
  onBack,
  onDeleted,
}: {
  name: string;
  /** From the URL's `?namespace=`; undefined lets the Registry resolve the bare name (ADR-0042). */
  namespace?: string;
  canDelete: boolean;
  canEditTags: boolean;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const skill = useSkill(name, namespace);
  // Nothing records an MCP server's Installs: `skillset mcp install` only reads it.
  const tracksInstalls = skill.data?.kind !== "mcp";
  const trend = useSkillInstallTrend(tracksInstalls ? skill.data?.id : undefined);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editTagsOpen, setEditTagsOpen] = useState(false);
  const [editMcpOpen, setEditMcpOpen] = useState(false);
  const [updatePluginOpen, setUpdatePluginOpen] = useState(false);
  // A Plugin's component list opens a component's file in the files panel below it.
  const [openFile, setOpenFile] = useState<string>();
  const filesRef = useRef<HTMLDivElement>(null);
  const download = useDownloadSkillArtifact();

  if (skill.isPending) return <SkillDetailSkeleton />;
  if (skill.isError) return <p className="text-sm text-destructive">{apiErrorMessage(skill.error)}</p>;

  const data = skill.data;
  // Null for a Skill published straight to this Registry, which is what hides
  // the Source row entirely rather than showing it empty.
  const imported = importedSource(data.source);
  // Only a Skill's page fills the viewport, so its files panel can take the
  // height left over. MCP servers and Plugins stack several panels and scroll
  // with the page instead; so does every Kind below `lg`, where the two
  // columns stack and a fixed height would let one overlap the other.
  const fillsViewport = data.kind === "skill";

  return (
    <div className={cn("flex flex-col gap-3.5", fillsViewport && "lg:h-full lg:min-h-0")}>
      <Reveal delayMs={0} className="flex items-center gap-2 text-xs text-muted-foreground">
        <nav className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="cursor-pointer hover:text-foreground">
            {SECTIONS[data.kind].nounPlural}
          </button>
          <span>/</span>
          <span>{data.name}</span>
        </nav>
      </Reveal>

      <Reveal delayMs={50} className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 text-3xl font-medium tracking-tight break-words text-balance">{data.name}</h1>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* An MCP server has no Artifact to download (ADR-0027). */}
          {data.kind !== "mcp" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  aria-label={`Download ${data.kind === "plugin" ? "plugin" : "Skill"}`}
                  onClick={() => download(data.id, data.name)}
                >
                  <DownloadIcon />
                  Download
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download {data.kind === "plugin" ? "plugin" : "Skill"}</TooltipContent>
            </Tooltip>
          )}
          {(canEditTags || canDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                {canEditTags && data.kind === "mcp" && (
                  <DropdownMenuItem onClick={() => setEditMcpOpen(true)}>
                    <PencilIcon />
                    Edit
                  </DropdownMenuItem>
                )}
                {canEditTags && data.kind === "plugin" && (
                  <DropdownMenuItem onClick={() => setUpdatePluginOpen(true)}>
                    <UploadIcon />
                    Publish new version
                  </DropdownMenuItem>
                )}
                {canEditTags && (
                  <DropdownMenuItem onClick={() => setEditTagsOpen(true)}>
                    <TagsIcon />
                    Edit Tags
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </Reveal>
      <Reveal delayMs={75}>
        <p className="max-w-2xl text-sm text-pretty text-muted-foreground">{data.description}</p>
      </Reveal>
      {data.tags.length > 0 && (
        <Reveal delayMs={100} className="flex flex-wrap items-center gap-1.5">
          {data.tags.map((tag) => (
            <Badge key={tag.id} variant="outline">
              {tag.name}
            </Badge>
          ))}
        </Reveal>
      )}

      <Reveal
        delayMs={150}
        className={cn("mt-2 grid gap-7 lg:grid-cols-[minmax(0,1fr)_280px]", fillsViewport && "lg:min-h-0 lg:flex-1")}
      >
        <div className={cn("flex min-w-0 flex-col gap-4", fillsViewport && "lg:min-h-0")}>
          {/* An MCP server's Configuration panel says how to add it, so the
              install command is a Skill's only. Qualified only for a Skill
              that came from elsewhere: one published here is what a bare
              name already reaches. */}
          {data.kind === "skill" && (
            <SkillInstallCard name={data.name} namespace={imported ? data.namespace : undefined} />
          )}
          {data.kind === "plugin" && <PluginInstallCard plugin={data} />}

          {data.kind === "mcp" && <McpDetailPanel mcp={data} />}
          {data.kind === "skill" && (
            <div className="flex h-[560px] flex-col lg:h-auto lg:min-h-0 lg:flex-1">
              <SkillFilesPanel id={data.id} body={data.body} />
            </div>
          )}
          {data.kind === "plugin" && (
            <>
              <PluginComponentsPanel
                plugin={data}
                onOpenFile={(path) => {
                  setOpenFile(path);
                  filesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
              <div ref={filesRef} className="flex h-[560px] shrink-0 flex-col">
                <SkillFilesPanel
                  id={data.id}
                  body={data.body ?? ""}
                  rootFile={
                    data.body !== null || !data.agents[0]
                      ? PLUGIN_README_FILE_NAME
                      : PLUGIN_AGENTS[data.agents[0]].manifestPath
                  }
                  selectedPath={openFile}
                  onSelectedPathChange={setOpenFile}
                />
              </div>
            </>
          )}
        </div>

        <div className={cn("flex flex-col gap-4", fillsViewport && "lg:overflow-y-auto")}>
          {tracksInstalls && (
            <Panel title="Installs">
              <span className="text-[44px] leading-none font-semibold">{data.installs.toLocaleString()}</span>
              {trend.data && trend.data.points.length > 0 && (
                <div className="mt-1">
                  <InstallTrendChart points={trend.data.points} />
                  <span className="mt-1.5 block text-[11px] text-muted-foreground">
                    Last {trend.data.points.length} days
                  </span>
                </div>
              )}
            </Panel>
          )}

          <Panel title="Details" contentClassName="p-0">
            <DetailRow label={data.kind === "mcp" ? "Listed by" : "Publisher"}>
              <div className="flex items-center gap-2">
                <Avatar className="size-[26px]">
                  <AvatarFallback className="text-[11px]">{userInitials(data.published_by)}</AvatarFallback>
                </Avatar>
                <span>{userDisplayName(data.published_by)}</span>
              </div>
            </DetailRow>
            <DetailRow label={data.kind === "mcp" ? "Listed" : "Published"}>{formatDate(data.published_at)}</DetailRow>
            {/* Absent, not blank, for a Skill published straight here: the row
                would name the Registry the reader is already looking at. */}
            {/* Always, unlike the Source below it. A Namespace is identity and
                is never absent (ADR-0042) — every Skill has one, including one
                uploaded straight here, which is named after this Registry. A
                Source is an address, and for a Skill published here it points
                at the page the reader is already on, so that row is hidden
                rather than shown empty (ADR-0041). */}
            <DetailRow label="Namespace">
              <NamespaceValue namespace={data.namespace} />
            </DetailRow>
            {imported && (
              <DetailRow label="Source">
                <SourceLink source={imported} />
              </DetailRow>
            )}
            {data.kind === "plugin" && (
              <>
                <DetailRow label="Agents">
                  <AgentIcons agents={data.agents} />
                </DetailRow>
                {data.version && <DetailRow label="Version">{data.version}</DetailRow>}
                {data.license && <DetailRow label="License">{data.license}</DetailRow>}
                {data.homepage && (
                  <DetailRow label="Homepage">
                    <a
                      href={data.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      Open
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  </DetailRow>
                )}
              </>
            )}
            {data.kind === "skill" && (
              <DetailRow
                label="Tool access"
                stacked={Boolean(data.allowed_tools && splitAllowedTools(data.allowed_tools).length > 0)}
              >
                <ToolAccess allowedTools={data.allowed_tools} />
              </DetailRow>
            )}
            {data.kind === "mcp" && (
              <DetailRow label="Type">
                <span className="text-xs">
                  {data.packages && data.packages.length > 0
                    ? `${data.packages[0]?.registry_name} package`
                    : data.remotes && data.remotes.length > 0
                      ? `${data.remotes[0]?.transport_type} remote`
                      : "MCP Server"}
                </span>
              </DetailRow>
            )}
          </Panel>
        </div>
      </Reveal>

      {canDelete && (
        <DeleteSkillDialog
          id={data.id}
          name={data.name}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onDeleted={onDeleted}
        />
      )}
      {canEditTags && data.kind === "mcp" && (
        <FormDialog
          open={editMcpOpen}
          onOpenChange={setEditMcpOpen}
          className="max-h-[648px] w-full max-w-2xl sm:max-w-2xl"
        >
          <FormDialogHeader title="Edit MCP server" description={data.name} />
          <PublishMcpForm
            initial={data}
            onPublished={() => setEditMcpOpen(false)}
            onCancel={() => setEditMcpOpen(false)}
          />
        </FormDialog>
      )}
      {canEditTags && data.kind === "plugin" && (
        <FormDialog
          open={updatePluginOpen}
          onOpenChange={setUpdatePluginOpen}
          className="w-full max-w-xl sm:max-w-xl"
        >
          <FormDialogHeader title="Publish a new version" description={data.name} />
          <UpdatePluginForm
            plugin={data}
            onPublished={() => setUpdatePluginOpen(false)}
            onCancel={() => setUpdatePluginOpen(false)}
          />
        </FormDialog>
      )}
      {canEditTags && (
        <EditTagsDialog
          id={data.id}
          name={data.name}
          tags={data.tags}
          open={editTagsOpen}
          onOpenChange={setEditTagsOpen}
        />
      )}
    </div>
  );
}
