import { useState } from "react";
import { DeleteSkillDialog } from "@/components/delete-skill-dialog";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { skillArtifactUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Download and, for those permitted, Delete — unchanged by splitting the
 * page into widgets.
 *
 * @param id - The Skill's id — what Download and Delete act on (ticket 16).
 * @param name - The Skill's name, shown in the delete confirmation.
 * @param canDelete - Whether the signed-in User may delete this Skill (admin or above).
 * @param onDeleted - Called once the Skill has been deleted.
 */
export function SkillActionsCard({
  id,
  name,
  canDelete,
  onDeleted,
}: {
  id: string;
  name: string;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <a href={skillArtifactUrl(id)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Download
        </a>
        {canDelete && (
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            Delete
          </Button>
        )}
      </CardContent>
      {canDelete && (
        <DeleteSkillDialog id={id} name={name} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={onDeleted} />
      )}
    </Card>
  );
}
