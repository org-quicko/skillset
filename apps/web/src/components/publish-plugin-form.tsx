import { buildPluginBundle, PLUGIN_AGENTS, type PluginBundle, type SkillFile } from "@in-org-quicko/skillset-shared";
import { UploadIcon } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { AgentIcons } from "@/components/agent-icons";
import { Badge } from "@/components/ui/badge";
import { readDroppedFiles, readPickedFiles } from "@/lib/read-skill-files";
import { cn } from "@/lib/utils";

const MANIFEST_PATHS = Object.values(PLUGIN_AGENTS).map((agent) => agent.manifestPath);

/** A plugin folder read off disk, and the bundle built from it, waiting to be published. */
export interface StagedPlugin {
  files: SkillFile[];
  bundle: PluginBundle;
}

/**
 * What a staged plugin folder will publish: its name, version, agents, description, and file count.
 *
 * @param staged - The folder read, and the bundle built from it.
 * @example
 * ```tsx
 * <StagedPluginSummary staged={staged} />
 * ```
 */
export function StagedPluginSummary({ staged }: { staged: StagedPlugin }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium break-all">{staged.bundle.name}</span>
        {staged.bundle.request.version && <Badge variant="secondary">{staged.bundle.request.version}</Badge>}
        <AgentIcons agents={staged.bundle.request.agents} />
      </div>
      <p className="text-sm text-pretty text-muted-foreground">{staged.bundle.request.description}</p>
      <p className="text-xs text-muted-foreground">
        {staged.bundle.files.length} {staged.bundle.files.length === 1 ? "file" : "files"}
      </p>
    </div>
  );
}

/**
 * A drop zone for a plugin's folder: drop or pick one, and it is read and
 * built into a bundle from its agent manifests.
 *
 * @remarks
 * What happens to the folder is the parent's call: the publish dialog
 * publishes it at once, and the new-version form holds it for its footer.
 * A folder that cannot be read or has no manifest is reported here.
 *
 * @param onStage - Called with a newly read folder, or `undefined` when one could not be read.
 * @param disabled - True while a folder is publishing.
 * @example
 * ```tsx
 * <PluginFolderUpload onStage={(staged) => staged && publish(staged)} disabled={publishing} />
 * ```
 */
export function PluginFolderUpload({
  onStage,
  disabled,
}: {
  onStage: (staged: StagedPlugin | undefined) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [readError, setReadError] = useState<string>();

  function load(read: SkillFile[]) {
    try {
      onStage({ files: read, bundle: buildPluginBundle(read) });
      setReadError(undefined);
    } catch (error) {
      onStage(undefined);
      setReadError(error instanceof Error ? error.message : "Could not read the folder.");
    }
  }

  async function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
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
    if (picked.length === 0 || disabled) return;
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
        disabled={disabled}
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
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-muted/50",
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
      <p className="text-xs text-pretty text-muted-foreground">
        The folder needs an agent manifest at its root:{" "}
        {MANIFEST_PATHS.map((path, index) => (
          <span key={path}>
            {index > 0 && " or "}
            <span className="whitespace-nowrap">{path}</span>
          </span>
        ))}
        .
      </p>

      {readError && <p className="text-sm text-pretty text-destructive">{readError}</p>}
    </div>
  );
}
