import {
  buildPluginBundle,
  importedSource,
  parseSkillSourceUrl,
  type Plugin,
} from "@in-org-quicko/skillset-shared";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { GIT_PROVIDER_ICONS } from "@/components/provider-icons";
import {
  PluginFolderUpload,
  StagedPluginSummary,
  type StagedPlugin,
} from "@/components/publish-plugin-form";
import { Button } from "@/components/ui/button";
import { FormDialogBody, FormDialogFooter } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePublishPlugin } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";
import { findPluginFiles } from "@/lib/plugin-update";
import { discoverSkillSources, fetchSkillFilesAt } from "@/lib/read-source-files";

/** The repository a Plugin was Imported from, when it was Imported from one this Registry can read. */
function repositoryOf(plugin: Plugin): string | null {
  const imported = importedSource(plugin.source);
  if (!imported?.provider) return null;
  try {
    parseSkillSourceUrl(imported.url);
    return imported.url;
  } catch {
    return null;
  }
}

/**
 * Publishes a new version of an existing Plugin: from a folder on disk, or the
 * latest from the repository it was Imported from.
 *
 * @remarks
 * Publishing overwrites the Plugin in place (ADR-0002), so its page, its
 * Claude Code marketplace entry and `skillset plugins update` all pick up the
 * new version. The new files must name the same Plugin — a different name
 * would publish a second Plugin instead. An Imported Plugin keeps its Source,
 * so a folder uploaded over it stays in its Namespace (ADR-0042) rather than
 * landing beside it in the Registry's own. Reading the repository again is an
 * on-demand re-Import (ADR-0046).
 *
 * Renders a {@link FormDialog}'s body and footer, so it goes straight inside one.
 *
 * @param plugin - The Plugin to update.
 * @param onPublished - Called once the new version is published.
 * @param onCancel - Called when the footer's Cancel is pressed.
 * @example
 * ```tsx
 * <FormDialog open={open} onOpenChange={setOpen}>
 *   <FormDialogHeader title="Publish a new version" description={plugin.name} />
 *   <UpdatePluginForm plugin={plugin} onPublished={() => setOpen(false)} onCancel={() => setOpen(false)} />
 * </FormDialog>
 * ```
 */
export function UpdatePluginForm({
  plugin,
  onPublished,
  onCancel,
}: {
  plugin: Plugin;
  onPublished: () => void;
  onCancel: () => void;
}) {
  const repository = repositoryOf(plugin);
  const [tab, setTab] = useState(repository ? "repository" : "upload");
  const [staged, setStaged] = useState<StagedPlugin>();
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string>();
  const publish = usePublishPlugin();
  const RepositoryIcon = repository
    ? GIT_PROVIDER_ICONS[importedSource(repository)?.provider ?? ""]
    : undefined;

  const mismatch = staged && staged.bundle.name !== plugin.name ? staged.bundle.name : null;
  const busy = reading || publish.isPending;

  function stage(next: StagedPlugin | undefined) {
    publish.reset();
    setReadError(undefined);
    setStaged(next);
  }

  function switchTab(next: string) {
    stage(undefined);
    setTab(next);
  }

  async function readRepository() {
    if (!repository) return;
    stage(undefined);
    setReading(true);
    try {
      const files = await findPluginFiles(
        await discoverSkillSources(repository, "plugin"),
        fetchSkillFilesAt,
        plugin.name,
      );
      setStaged({ files, bundle: buildPluginBundle(files, { source: repository }) });
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "Could not read the repository.");
    } finally {
      setReading(false);
    }
  }

  return (
    <>
      <FormDialogBody>
        {/* A Plugin with no repository to read again has only the one way in, so no tabs. */}
        {!repository ? (
          <PluginFolderUpload onStage={stage} disabled={publish.isPending} />
        ) : (
          <Tabs value={tab} onValueChange={switchTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="repository" disabled={busy}>
                From repository
              </TabsTrigger>
              <TabsTrigger value="upload" disabled={busy}>
                Drag and drop
              </TabsTrigger>
            </TabsList>

            <TabsContent value="repository" className="mt-4 flex flex-col gap-3">
              <>
                <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  {RepositoryIcon && <RepositoryIcon className="size-4 shrink-0 opacity-70" />}
                  <a
                    href={repository}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate hover:underline"
                  >
                    {repository.replace(/^https:\/\//, "")}
                  </a>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    disabled={busy}
                    onClick={readRepository}
                  >
                    {reading ? <Spinner /> : <RefreshCwIcon />}
                    {staged ? "Read again" : "Read latest"}
                  </Button>
                </div>
                {staged && <StagedPluginSummary staged={staged} />}
              </>
            </TabsContent>

            <TabsContent value="upload" className="mt-4 flex flex-col gap-3">
              <PluginFolderUpload onStage={stage} disabled={publish.isPending} />
            </TabsContent>
          </Tabs>
        )}

        <div className="mt-3 flex flex-col gap-1.5">
          {mismatch && (
            <p className="text-sm text-pretty text-destructive">
              This folder is the plugin &quot;{mismatch}&quot;, not &quot;{plugin.name}&quot;.
              Publishing it would add a second plugin, so pick {plugin.name}&apos;s folder.
            </p>
          )}
          {readError && <p className="text-sm text-pretty text-destructive">{readError}</p>}
          {publish.isError && (
            <p className="text-sm text-pretty text-destructive">{apiErrorMessage(publish.error)}</p>
          )}
        </div>
      </FormDialogBody>
      <FormDialogFooter
        onCancel={onCancel}
        cancelDisabled={publish.isPending}
        submit={{
          label: "Publish new version",
          pendingLabel: "Publishing…",
          pending: publish.isPending,
          disabled: !staged || Boolean(mismatch) || reading,
          onClick: () => {
            if (!staged) return;
            // An Imported Plugin keeps its Source, so its Namespace — and so its identity — stays the same.
            const source = importedSource(plugin.source) ? plugin.source : undefined;
            publish.mutate({ files: staged.files, source }, { onSuccess: onPublished });
          },
        }}
      />
    </>
  );
}
