import type { Publisher } from "@in-org-quicko/sqillset-shared";
import { DownloadIcon, EllipsisIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { DeleteSkillDialog } from "@/components/delete-skill-dialog";
import { EditTagsDialog } from "@/components/edit-tags-dialog";
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
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-sm">{children}</div>
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
  canDelete,
  canEditTags,
  onBack,
  onDeleted,
}: {
  name: string;
  canDelete: boolean;
  canEditTags: boolean;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const skill = useSkill(name);
  const trend = useSkillInstallTrend(skill.data?.id);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editTagsOpen, setEditTagsOpen] = useState(false);
  const download = useDownloadSkillArtifact();

  if (skill.isPending) return <SkillDetailSkeleton />;
  if (skill.isError) return <p className="text-sm text-destructive">{apiErrorMessage(skill.error)}</p>;

  const data = skill.data;

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
          <SkillInstallCard name={data.name} />

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
