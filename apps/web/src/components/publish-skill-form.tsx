import { providerForHost, SkillValidationError, type SkillFile } from "@skill-registry/shared";
import { useRef, useState, type DragEvent } from "react";
import { connectHref, useConnections } from "@/hooks/use-connections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkillUploadError, usePublishSkill } from "@/hooks/use-skills";
import { ApiError, apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fetchSkillSourceFiles } from "@/lib/read-source-files";
import { readDroppedFiles, readPickedFiles } from "@/lib/read-skill-files";

function describeFailure(error: unknown): string {
  if (error instanceof SkillValidationError) {
    return error.field ? `${error.message} (${error.field})` : error.message;
  }
  if (error instanceof SkillUploadError) return error.message;
  return apiErrorMessage(error);
}

/**
 * The refusals whose remedy is a trip to the provider: what the button says,
 * and which of the two trips it is.
 *
 * @remarks
 * These land in **two different places**, which is the whole reason
 * `destination` exists. Authorizing and choosing repositories were one page
 * until the installation page turned out to mint no code on a re-visit
 * (ADR-0024); conflating them now would send a writer whose app is not
 * installed through an authorization that succeeds and changes nothing.
 *
 * `app_not_installed` is the one worth having a button for at all: its message
 * already names the owner, but the fix is to go and choose that repository, and
 * a writer who is not an organisation owner will find out there that they have
 * to ask one.
 */
const REMEDIES: Record<string, { label: string; destination: "connect" | "repositories" }> = {
  not_connected: { label: "Connect GitHub", destination: "connect" },
  connection_expired: { label: "Reconnect GitHub", destination: "connect" },
  app_not_installed: { label: "Choose repositories on GitHub", destination: "repositories" },
};

/**
 * The Git Provider a pasted URL names, if any.
 *
 * @remarks
 * Host-based, and deliberately forgiving: this only decides which provider a
 * remedy button points at, so a URL too malformed to parse simply gets no
 * button. The real parsing and its refusal live in `parseSkillSourceUrl`.
 *
 * @param url - The URL as typed.
 * @returns The provider name, or `null`.
 */
function providerOf(url: string): string | null {
  try {
    return providerForHost(new URL(url.trim()).hostname);
  } catch {
    return null;
  }
}

/** A read failure, and the trip to the provider that would fix it, if there is one. */
interface ReadFailure {
  message: string;
  /** The provider to send them to, or `null` when nothing here would help. */
  remedy: { provider: string; label: string; destination: "connect" | "repositories" } | null;
}

/**
 * Turns a failed import into a message, and an action when one exists.
 *
 * @param error - Whatever `fetchSkillSourceFiles` threw.
 * @param provider - The Git Provider the pasted URL named, when it parsed.
 * @returns The message to show, and the remedy to offer.
 */
function readFailure(error: unknown, provider: string | null): ReadFailure {
  const message = error instanceof Error ? error.message : "Could not read that URL. Try again.";
  if (!(error instanceof ApiError) || !provider) return { message, remedy: null };

  const remedy = REMEDIES[error.code];
  return { message, remedy: remedy ? { provider, ...remedy } : null };
}

export function PublishSkillForm({
  onPublished,
  onCancel,
}: {
  onPublished: (name: string) => void;
  onCancel: () => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  // A read failure (a file vanishes mid-drag, a permission error, an import
  // that 404s) happens before the mutation is ever invoked, so it can't live
  // on `publish`.
  const [readError, setReadError] = useState<ReadFailure | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const publish = usePublishSkill();
  // Only for the repository-selection remedy's URL, which is built server-side
  // from the Integration's app slug that this form cannot see.
  const connections = useConnections();

  function handleFiles(files: SkillFile[]) {
    setReadError(null);
    publish.mutate(files, { onSuccess: (skill) => onPublished(skill.name) });
  }

  async function handleImportSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isImporting || publish.isPending) return;
    setIsImporting(true);
    setReadError(null);
    try {
      handleFiles(await fetchSkillSourceFiles(sourceUrl));
    } catch (error) {
      // The provider is discovered from the URL, never chosen — so it is only
      // known once the URL parsed, and a URL that did not parse has no remedy
      // to offer beyond fixing the URL.
      setReadError(readFailure(error, providerOf(sourceUrl)));
    } finally {
      setIsImporting(false);
    }
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (publish.isPending || isImporting) return;
    try {
      handleFiles(await readDroppedFiles(event.dataTransfer.items));
    } catch {
      setReadError({ message: "Could not read the dropped folder. Try again.", remedy: null });
    }
  }

  async function handlePicked(event: React.ChangeEvent<HTMLInputElement>) {
    // Snapshot into a plain array before resetting `.value` — `.files` is a
    // live FileList, and clearing the input (so picking the same folder
    // again still fires onChange) can empty that same list out from under
    // a reference held past this point instead of swapping in a new one.
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0 || publish.isPending || isImporting) return;
    try {
      handleFiles(await readPickedFiles(files));
    } catch {
      setReadError({ message: "Could not read the chosen folder. Try again.", remedy: null });
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
          disabled={publish.isPending || isImporting}
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
        <p className="text-center text-xs text-muted-foreground">or publish from a repository URL</p>
        {/* One field, and the provider is discovered from the host rather than
            picked: a writer pastes the link they already have open. */}
        <form onSubmit={handleImportSubmit} className="flex gap-2">
          <Input
            type="url"
            placeholder="Eg. https://github.com/owner/repo or https://gitlab.com/group/project"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            disabled={publish.isPending || isImporting}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={sourceUrl.trim().length === 0 || publish.isPending || isImporting}
          >
            Publish
          </Button>
        </form>
      </div>

      {publish.isPending && <p className="text-sm text-muted-foreground">Publishing…</p>}
      {isImporting && <p className="text-sm text-muted-foreground">Reading the repository…</p>}
      {readError && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">{readError.message}</p>
          {readError.remedy && (() => {
            // Two destinations, and picking the wrong one wastes the writer's
            // trip: authorizing does not install the app, and installing it
            // does not authorize. A repository remedy with no URL to send them
            // to draws no button — the message already names the owner to ask.
            const { provider, label, destination } = readError.remedy;
            const href =
              destination === "connect"
                ? connectHref(provider)
                : (connections.data?.connectable.find((entry) => entry.provider === provider)
                    ?.manage_access_url ?? null);
            if (!href) return null;

            return (
              <Button asChild variant="outline" size="sm">
                <a
                  href={href}
                  {...(destination === "repositories" ? { target: "_blank", rel: "noreferrer" } : {})}
                >
                  {label}
                </a>
              </Button>
            );
          })()}
        </div>
      )}
      {publish.isError && <p className="text-sm text-destructive">{describeFailure(publish.error)}</p>}

      <Button type="button" variant="ghost" disabled={publish.isPending || isImporting} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
