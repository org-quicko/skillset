import { buildPluginBundle, PLUGIN_AGENTS, type PluginBundle, type SkillFile } from "@in-org-quicko/skillset-shared";
import { UploadIcon } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { usePublishPlugin } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";
import { readDroppedFiles, readPickedFiles } from "@/lib/read-skill-files";
import { cn } from "@/lib/utils";

const MANIFEST_PATHS = Object.values(PLUGIN_AGENTS).map((agent) => agent.manifestPath);

/**
 * The upload tab of the Plugin publish form: drop or pick a folder, check the
 * name and agents read from its manifests, then publish.
 *
 * @remarks
 * The folder is read once, and the bundle built from it is shown before
 * anything is sent, so a wrong folder costs nothing.
 *
 * @param onPublished - Called with the stored name and Namespace once every file has uploaded.
 */
export function PluginFolderUpload({ onPublished }: { onPublished: (name: string, namespace: string) => void }) {
  const publish = usePublishPlugin();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<SkillFile[]>();
  const [bundle, setBundle] = useState<PluginBundle>();
  const [readError, setReadError] = useState<string>();

  function load(read: SkillFile[]) {
    publish.reset();
    try {
      setBundle(buildPluginBundle(read));
      setFiles(read);
      setReadError(undefined);
    } catch (error) {
      setBundle(undefined);
      setFiles(undefined);
      setReadError(error instanceof Error ? error.message : "Could not read the folder.");
    }
  }

  async function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (publish.isPending) return;
    try {
      load(await readDroppedFiles(event.dataTransfer.items));
    } catch {
      setReadError("Could not read the dropped folder. Try again.");
    }
  }

  async function handlePicked(event: React.ChangeEvent<HTMLInputElement>) {
    // Snapshot before clearing `.value`: `.files` is live, and clearing it lets the same folder be picked again.
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0 || publish.isPending) return;
    try {
      load(await readPickedFiles(picked));
    } catch {
      setReadError("Could not read the chosen folder. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={publish.isPending}
        onDragOver={(event) => {
          event.preventDefault();
          if (!isDragging) setIsDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
        }}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-150 ease-out",
          isDragging ? "border-primary bg-accent" : "border-border",
          publish.isPending ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-muted/50",
        )}
      >
        <UploadIcon className="size-5 text-muted-foreground" />
        <p className="text-sm text-pretty text-muted-foreground">
          Drag and drop a plugin&apos;s folder here, or{" "}
          <span className="text-foreground underline underline-offset-2">browse for a folder</span>
        </p>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handlePicked}
        // Nonstandard but universally supported folder-picking attribute — not in React's JSX typings.
        {...{ webkitdirectory: "true", directory: "true" }}
      />
      <p className="text-xs text-muted-foreground">
        The folder needs an agent manifest at its root: {MANIFEST_PATHS.join(" or ")}.
      </p>

      {readError && <p className="text-sm text-pretty text-destructive">{readError}</p>}

      {bundle && files && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{bundle.name}</span>
            {bundle.request.version && <Badge variant="secondary">{bundle.request.version}</Badge>}
            {bundle.request.agents.map((agent) => (
              <Badge key={agent} variant="outline">
                {PLUGIN_AGENTS[agent].label}
              </Badge>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{bundle.request.description}</p>
          <p className="text-xs text-muted-foreground">
            {bundle.files.length} {bundle.files.length === 1 ? "file" : "files"}
          </p>
          {publish.isError && <p className="text-sm text-pretty text-destructive">{apiErrorMessage(publish.error)}</p>}
          <div className="flex justify-end">
            <Button
              disabled={publish.isPending}
              onClick={() =>
                publish.mutate({ files }, { onSuccess: (plugin) => onPublished(plugin.name, plugin.namespace) })
              }
            >
              {publish.isPending && <Spinner />}
              Publish plugin
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
