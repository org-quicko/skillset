import { importedSource, type Publisher } from "@in-org-quicko/skillset-shared";
import { DownloadIcon, EllipsisIcon, ExternalLinkIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { DeleteSkillDialog } from "@/components/delete-skill-dialog";
import { EditTagsDialog } from "@/components/edit-tags-dialog";
import { GIT_PROVIDER_ICONS } from "@/components/provider-icons";
import { InstallTrendChart } from "@/components/install-trend-chart";
import { Panel } from "@/components/panel";
import { Reveal } from "@/components/reveal";
import { SkillFilesPanel } from "@/components/skill-files-panel";
import { SkillInstallCard } from "@/components/skill-install-card";
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
import { formatDate, splitAllowedTools } from "@/lib/utils";

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

/** A Publisher's display name, falling back to their email once the User row is gone (docs/data-model.md). */
function publisherName(publisher: Publisher): string {
  const full = [publisher.first_name, publisher.last_name].filter(Boolean).join(" ");
  return full || publisher.email;
}

function publisherInitials(publisher: Publisher): string {
  if (publisher.first_name || publisher.last_name) {
    return `${publisher.first_name?.[0] ?? ""}${publisher.last_name?.[0] ?? ""}`.toUpperCase();
  }
  return publisher.email.slice(0, 2).toUpperCase();
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
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
        <span tabIndex={0} className="block truncate rounded-sm font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
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
    <div className="flex flex-wrap justify-end gap-1">
      {tools.map((tool) => (
        <Badge key={tool} variant="secondary" className="font-mono text-[11px]">
          {tool}
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
  const trend = useSkillInstallTrend(skill.data?.id);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editTagsOpen, setEditTagsOpen] = useState(false);
  const download = useDownloadSkillArtifact();

  if (skill.isPending) return <SkillDetailSkeleton />;
  if (skill.isError) return <p className="text-sm text-destructive">{apiErrorMessage(skill.error)}</p>;

  const data = skill.data;
  // Null for a Skill published straight to this Registry, which is what hides
  // the Source row entirely rather than showing it empty.
  const imported = importedSource(data.source);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3.5">
      <Reveal delayMs={0} className="flex items-center gap-2 text-xs text-muted-foreground">
        <nav className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="cursor-pointer hover:text-foreground">
            skills
          </button>
          <span>/</span>
          <span>{data.name}</span>
        </nav>
      </Reveal>

      <Reveal delayMs={50} className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-medium tracking-tight text-balance">{data.name}</h1>
        <div className="flex shrink-0 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                aria-label="Download Skill"
                onClick={() => download(data.id, data.name)}
              >
                <DownloadIcon />
                Download
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download Skill</TooltipContent>
          </Tooltip>
          {(canEditTags || canDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                {canEditTags && (
                  <DropdownMenuItem onClick={() => setEditTagsOpen(true)}>
                    <PencilIcon />
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
      {data.tags.length > 0 && (
        <Reveal delayMs={100} className="flex flex-wrap items-center gap-1.5">
          {data.tags.map((tag) => (
            <Badge key={tag.id} variant="outline">
              {tag.name}
            </Badge>
          ))}
        </Reveal>
      )}

      <Reveal delayMs={150} className="mt-2 grid min-h-0 flex-1 gap-7 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          {/* Qualified only for a Skill that came from elsewhere: one
              published here is what a bare name already reaches. */}
          <SkillInstallCard name={data.name} namespace={imported ? data.namespace : undefined} />

          <SkillFilesPanel id={data.id} body={data.body} />
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto">
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

          <Panel title="Details" contentClassName="p-0">
            <DetailRow label="Publisher">
              <div className="flex items-center gap-2">
                <Avatar className="size-[26px]">
                  <AvatarFallback className="text-[11px]">{publisherInitials(data.published_by)}</AvatarFallback>
                </Avatar>
                <span>{publisherName(data.published_by)}</span>
              </div>
            </DetailRow>
            <DetailRow label="Published">{formatDate(data.published_at)}</DetailRow>
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
            <DetailRow label="Tool access">
              <ToolAccess allowedTools={data.allowed_tools} />
            </DetailRow>
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
