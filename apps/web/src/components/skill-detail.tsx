import type { Publisher, Skill } from "@skill-registry/shared";
import { DownloadIcon, EllipsisIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { DeleteSkillDialog } from "@/components/delete-skill-dialog";
import { EditTagsDialog } from "@/components/edit-tags-dialog";
import { InstallTrendChart } from "@/components/install-trend-chart";
import { Panel } from "@/components/panel";
import { Reveal } from "@/components/reveal";
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
import { renderSkillBody } from "@/lib/render-skill-body";
import { formatDate } from "@/lib/utils";

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
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
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
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/** The optional Agent Skills frontmatter fields the Registry keeps, shown only when set. */
function FrontmatterFields({ skill }: { skill: Skill }) {
  const metadata = skill.metadata ? Object.entries(skill.metadata) : [];
  const rows: [string, string][] = [];
  if (skill.license) rows.push(["License", skill.license]);
  if (skill.compatibility) rows.push(["Compatibility", skill.compatibility]);
  if (skill.allowed_tools) rows.push(["Allowed tools", skill.allowed_tools]);

  if (rows.length === 0 && metadata.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t pt-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">{value}</span>
        </div>
      ))}
      {metadata.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">Metadata</span>
          {metadata.map(([key, value]) => (
            <div key={key} className="flex gap-1.5 text-muted-foreground">
              <span className="font-medium text-foreground">{key}:</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A Skill's page: breadcrumb, then title with download and manage actions
 * aligned beside it, then a two-column layout — the install command,
 * description, and rendered `SKILL.md` on the left; installs and publisher
 * details on the right. Fetches the Skill once; the widgets below take it
 * as a prop.
 */
export function SkillDetail({
  name,
  canDelete,
  canEditTags,
  canRenameTags,
  onBack,
  onDeleted,
}: {
  name: string;
  canDelete: boolean;
  canEditTags: boolean;
  canRenameTags: boolean;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const skill = useSkill(name);
  const trend = useSkillInstallTrend(skill.data?.id);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editTagsOpen, setEditTagsOpen] = useState(false);
  const download = useDownloadSkillArtifact();

  const bodyHtml = useMemo(() => (skill.data ? renderSkillBody(skill.data.body) : ""), [skill.data]);

  if (skill.isPending) return <SkillDetailSkeleton />;
  if (skill.isError) return <p className="text-sm text-destructive">{apiErrorMessage(skill.error)}</p>;

  const data = skill.data;

  return (
    <div className="flex flex-col gap-3.5">
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
                size="icon"
                aria-label="Download skill"
                disabled={download.isPending}
                onClick={() => download.mutate({ id: data.id })}
              >
                <DownloadIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{download.isPending ? "Downloading…" : "Download skill"}</TooltipContent>
          </Tooltip>
          {(canEditTags || canDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEditTags && (
                  <DropdownMenuItem onClick={() => setEditTagsOpen(true)}>
                    <PencilIcon />
                    Edit tags
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
      {download.isError && <p className="text-sm text-destructive">{apiErrorMessage(download.error)}</p>}

      {data.tags.length > 0 && (
        <Reveal delayMs={100} className="flex flex-wrap items-center gap-1.5">
          {data.tags.map((tag) => (
            <Badge key={tag.id} variant="outline">
              {tag.name}
            </Badge>
          ))}
        </Reveal>
      )}

      <Reveal delayMs={150} className="mt-2 grid gap-7 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-4">
          <SkillInstallCard name={data.name} />

          <Panel title="Description">
            <p className="text-sm leading-relaxed font-medium">{data.description}</p>
            <FrontmatterFields skill={data} />
          </Panel>

          <Panel title="SKILL.md">
            <div
              className="text-sm leading-relaxed text-pretty [&_a]:underline [&_code]:font-mono [&_code]:text-[0.85em] [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md [&_img]:outline [&_img]:outline-1 [&_img]:-outline-offset-1 [&_img]:outline-[oklch(0_0_0/0.1)] dark:[&_img]:outline-[oklch(1_0_0/0.1)] [&_li]:ml-4 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Analytics">
            <span className="text-[44px] leading-none font-semibold">{data.installs.toLocaleString()}</span>
            <span className="mt-1.5 block text-xs text-muted-foreground">
              {data.installs === 1 ? "install" : "installs"} recorded
            </span>
            {trend.data && trend.data.points.length > 0 && (
              <div className="mt-3.5 border-t pt-3.5">
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
          canRenameTags={canRenameTags}
          open={editTagsOpen}
          onOpenChange={setEditTagsOpen}
        />
      )}
    </div>
  );
}
