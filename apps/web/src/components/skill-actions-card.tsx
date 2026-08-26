import type { Tag } from "@skill-registry/shared";
import { useState } from "react";
import { DeleteSkillDialog } from "@/components/delete-skill-dialog";
import { EditTagsDialog } from "@/components/edit-tags-dialog";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { skillArtifactUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Download and, for those permitted, Edit tags and Delete — unchanged by
 * splitting the page into widgets.
 *
 * @param id - The Skill's id — what Download, Edit tags, and Delete act on (ticket 16).
 * @param name - The Skill's name, shown in the delete confirmation and tag editor.
 * @param tags - The Skill's current Tags, seeded into the tag editor.
 * @param canDelete - Whether the signed-in User may delete this Skill (admin or above).
 * @param canEditTags - Whether the signed-in User may attach, create, or detach this Skill's Tags (writer or above).
 * @param canRenameTags - Whether the signed-in User may rename a Tag from the editor (admin or above) — a catalog-wide action, stricter than editing this one Skill's list.
 * @param onDeleted - Called once the Skill has been deleted.
 */
export function SkillActionsCard({
  id,
  name,
  tags,
  canDelete,
  canEditTags,
  canRenameTags,
  onDeleted,
}: {
  id: string;
  name: string;
  tags: Tag[];
  canDelete: boolean;
  canEditTags: boolean;
  canRenameTags: boolean;
  onDeleted: () => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editTagsOpen, setEditTagsOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <a href={skillArtifactUrl(id)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Download
        </a>
        {canEditTags && (
          <Button variant="outline" size="sm" onClick={() => setEditTagsOpen(true)}>
            Edit tags
          </Button>
        )}
        {canDelete && (
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            Delete
          </Button>
        )}
      </CardContent>
      {canDelete && (
        <DeleteSkillDialog id={id} name={name} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={onDeleted} />
      )}
      {canEditTags && (
        <EditTagsDialog
          id={id}
          name={name}
          tags={tags}
          canRenameTags={canRenameTags}
          open={editTagsOpen}
          onOpenChange={setEditTagsOpen}
        />
      )}
    </Card>
  );
}
