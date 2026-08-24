import { SkillValidationError, type SkillFile } from "@skill-registry/shared";
import { useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SkillUploadError, usePublishSkill } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { readDroppedFiles, readPickedFiles } from "@/lib/read-skill-files";

function describeFailure(error: unknown): string {
  if (error instanceof SkillValidationError) {
    return error.field ? `${error.message} (${error.field})` : error.message;
  }
  if (error instanceof SkillUploadError) return error.message;
  return apiErrorMessage(error);
}

export function PublishSkillForm({
  onPublished,
  onCancel,
}: {
  onPublished: (name: string) => void;
  onCancel: () => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const publish = usePublishSkill();

  function handleFiles(files: SkillFile[]) {
    publish.mutate(files, { onSuccess: (skill) => onPublished(skill.name) });
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    handleFiles(await readDroppedFiles(event.dataTransfer.items));
  }

  async function handlePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files;
    event.target.value = "";
    if (!fileList || fileList.length === 0) return;
    handleFiles(await readPickedFiles(fileList));
  }

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader>
        <CardTitle>Publish a Skill</CardTitle>
        <CardDescription>Drop the Skill's folder here, or choose it from a dialog.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(event) => {
            // `dragleave` fires when the pointer crosses onto a child element
            // too, not just when it leaves the drop zone entirely — only
            // clear the highlight once it's genuinely outside.
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
          }}
          onDrop={handleDrop}
          className={cn(
            "flex flex-col items-center gap-3 rounded-md border-2 border-dashed p-10 text-center",
            isDragging ? "border-primary bg-accent" : "border-border",
          )}
        >
          <p className="text-sm text-muted-foreground">Drag a Skill's folder here</p>
          <p className="text-xs text-muted-foreground">or</p>
          <Button
            type="button"
            variant="outline"
            disabled={publish.isPending}
            onClick={() => inputRef.current?.click()}
          >
            Choose folder…
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handlePicked}
            // Nonstandard but universally supported attributes for picking a
            // folder from the file dialog — not in React's JSX typings.
            {...{ webkitdirectory: "true", directory: "true" }}
          />
        </div>

        {publish.isPending && <p className="text-sm text-muted-foreground">Publishing…</p>}
        {publish.isError && <p className="text-sm text-destructive">{describeFailure(publish.error)}</p>}

        <Button type="button" variant="ghost" disabled={publish.isPending} onClick={onCancel}>
          Cancel
        </Button>
      </CardContent>
    </Card>
  );
}
