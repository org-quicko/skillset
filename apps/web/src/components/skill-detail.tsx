import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteSkillDialog } from "@/components/delete-skill-dialog";
import { useSkill } from "@/hooks/use-skills";
import { apiErrorMessage, skillArtifactUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { renderSkillBody } from "@/lib/render-skill-body";

export function SkillDetail({
  name,
  canDelete,
  onBack,
  onDeleted,
}: {
  name: string;
  canDelete: boolean;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const skill = useSkill(name);
  const body = skill.data?.body;
  const html = useMemo(() => (body === undefined ? "" : renderSkillBody(body)), [body]);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader>
        <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
          ← Back to Skills
        </Button>
        {skill.isSuccess && (
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{skill.data.name}</CardTitle>
              <CardDescription>{skill.data.description}</CardDescription>
            </div>
            <div className="flex shrink-0 gap-2">
              <a
                href={skillArtifactUrl(skill.data.name)}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                Download
              </a>
              {canDelete && (
                <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {skill.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {skill.isError && <p className="text-sm text-destructive">{apiErrorMessage(skill.error)}</p>}
        {skill.isSuccess && (
          <div
            className="text-sm leading-relaxed [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </CardContent>
      {canDelete && (
        <DeleteSkillDialog name={name} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={onDeleted} />
      )}
    </Card>
  );
}
