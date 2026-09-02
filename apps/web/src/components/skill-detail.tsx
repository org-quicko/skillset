import type { Publisher, Skill } from "@skill-registry/shared";
import { DownloadIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { DeleteSkillDialog } from "@/components/delete-skill-dialog";
import { EditTagsDialog } from "@/components/edit-tags-dialog";
import { Panel } from "@/components/panel";
import { SkillInstallCard } from "@/components/skill-install-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDownloadSkillArtifact, useSkill } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";
import { renderSkillBody } from "@/lib/render-skill-body";
import { formatDate } from "@/lib/utils";

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
 * A Skill's page: breadcrumb and title, then a two-column layout — the
 * install command, description, and rendered `SKILL.md` on the left; installs,
 * publisher details, and the download/manage actions on the right. Fetches
 * the Skill once; the widgets below take it as a prop.
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editTagsOpen, setEditTagsOpen] = useState(false);
  const download = useDownloadSkillArtifact();

  const bodyHtml = useMemo(() => (skill.data ? renderSkillBody(skill.data.body) : ""), [skill.data]);

  if (skill.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (skill.isError) return <p className="text-sm text-destructive">{apiErrorMessage(skill.error)}</p>;

  const data = skill.data;

  return (
    <div className="flex flex-col gap-3.5">
      <nav className="flex items-center gap-2 text-xs text-muted-foreground">
        <button type="button" onClick={onBack} className="cursor-pointer hover:text-foreground">
          skills
        </button>
        <span>/</span>
        <span>{data.name}</span>
      </nav>

      <h1 className="text-3xl font-medium tracking-tight">{data.name}</h1>

      {data.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {data.tags.map((tag) => (
            <Badge key={tag.id} variant="outline">
              {tag.name}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-2 grid gap-7 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-4">
          <SkillInstallCard name={data.name} />

          <Panel title="Description">
            <p className="text-sm leading-relaxed font-medium">{data.description}</p>
            <FrontmatterFields skill={data} />
          </Panel>

          <Panel title="SKILL.md">
            <div
              className="text-sm leading-relaxed [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em] [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Installs">
            <span className="text-[28px] font-medium">{data.installs.toLocaleString()}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {data.installs === 1 ? "install" : "installs"} recorded
            </span>
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

          <div className="flex flex-col gap-2">
            <Button
              className="w-full"
              disabled={download.isPending}
              onClick={() => download.mutate({ id: data.id })}
            >
              <DownloadIcon />
              {download.isPending ? "Downloading…" : "Download skill"}
            </Button>
            {download.isError && (
              <p className="text-sm text-destructive">{apiErrorMessage(download.error)}</p>
            )}
            {canEditTags && (
              <Button variant="outline" className="w-full" onClick={() => setEditTagsOpen(true)}>
                Edit tags
              </Button>
            )}
            {canDelete && (
              <Button variant="destructive" className="w-full" onClick={() => setDeleteOpen(true)}>
                <Trash2Icon />
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>

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
