import { SkillValidationError, type SkillFile } from "@skill-registry/shared";
import { useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkillUploadError, usePublishSkill } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fetchGitHubSkillFiles } from "@/lib/read-github-files";
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
  // A read failure (a file vanishes mid-drag, a permission error, a GitHub
  // fetch that 404s) happens before the mutation is ever invoked, so it
  // can't live on `publish`.
  const [readError, setReadError] = useState<string | null>(null);
  const [githubUrl, setGithubUrl] = useState("");
  const [isFetchingGithub, setIsFetchingGithub] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const publish = usePublishSkill();

  function handleFiles(files: SkillFile[]) {
    setReadError(null);
    publish.mutate(files, { onSuccess: (skill) => onPublished(skill.name) });
  }

  async function handleGithubSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isFetchingGithub || publish.isPending) return;
    setIsFetchingGithub(true);
    setReadError(null);
    try {
      handleFiles(await fetchGitHubSkillFiles(githubUrl));
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "Could not fetch that GitHub URL. Try again.");
    } finally {
      setIsFetchingGithub(false);
    }
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (publish.isPending || isFetchingGithub) return;
    try {
      handleFiles(await readDroppedFiles(event.dataTransfer.items));
    } catch {
      setReadError("Could not read the dropped folder. Try again.");
    }
  }

  async function handlePicked(event: React.ChangeEvent<HTMLInputElement>) {
    // Snapshot into a plain array before resetting `.value` — `.files` is a
    // live FileList, and clearing the input (so picking the same folder
    // again still fires onChange) can empty that same list out from under
    // a reference held past this point instead of swapping in a new one.
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0 || publish.isPending || isFetchingGithub) return;
    try {
      handleFiles(await readPickedFiles(files));
    } catch {
      setReadError("Could not read the chosen folder. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
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
        className={cn(
          "flex flex-col items-center gap-3 rounded-md border-2 border-dashed p-10 text-center",
          isDragging ? "border-primary bg-accent" : "border-border",
        )}
      >
        <p className="text-sm text-muted-foreground">Drag a Skill&apos;s folder here</p>
        <p className="text-xs text-muted-foreground">or</p>
        <Button
          type="button"
          variant="outline"
          disabled={publish.isPending || isFetchingGithub}
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

      <div className="flex flex-col gap-2">
        <p className="text-center text-xs text-muted-foreground">or publish from a GitHub URL</p>
        <form onSubmit={handleGithubSubmit} className="flex gap-2">
          <Input
            type="url"
            placeholder="https://github.com/owner/repo"
            value={githubUrl}
            onChange={(event) => setGithubUrl(event.target.value)}
            disabled={publish.isPending || isFetchingGithub}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={githubUrl.trim().length === 0 || publish.isPending || isFetchingGithub}
          >
            Publish
          </Button>
        </form>
      </div>

      {publish.isPending && <p className="text-sm text-muted-foreground">Publishing…</p>}
      {isFetchingGithub && <p className="text-sm text-muted-foreground">Fetching from GitHub…</p>}
      {readError && <p className="text-sm text-destructive">{readError}</p>}
      {publish.isError && <p className="text-sm text-destructive">{describeFailure(publish.error)}</p>}

      <Button type="button" variant="ghost" disabled={publish.isPending || isFetchingGithub} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
