import {
  importedSource,
  MCP_DESCRIPTION_MAX_LENGTH,
  MCP_REGISTRIES,
  MCP_TRANSPORTS,
  type McpDetail,
  type McpRegistry,
  type McpTransport,
} from "@in-org-quicko/skillset-shared";
import { ImportIcon, PlusIcon, XIcon } from "lucide-react";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormDialogBody, FormDialogFooter, FormField } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { usePublishMcp } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";
import { toEnvironmentVariables, type McpEnvRow } from "@/lib/mcp-env";

type Delivery = "package" | "remote";

/**
 * Lists a new MCP server, or edits one: its name and description, its
 * repository, either a package an agent runs locally or a remote endpoint it
 * connects to, and its README.
 *
 * @remarks
 * Renders a {@link FormDialog}'s body and footer, so it goes straight inside
 * one, after its header. The form edits a server's first package or remote.
 * Package arguments and remote headers have no field, so an edit keeps the
 * ones the server has.
 *
 * @param initial - The server to edit. Its name cannot change; omit to list a new server.
 * @param onPublished - Called with the stored name and Namespace once the Registry accepts it.
 * @param onCancel - Called when Cancel is pressed.
 * @example
 * ```tsx
 * <FormDialog open={open} onOpenChange={setOpen}>
 *   <FormDialogHeader title="List an MCP server" />
 *   <PublishMcpForm onPublished={goTo} onCancel={() => setOpen(false)} />
 * </FormDialog>
 * ```
 */
export function PublishMcpForm({
  initial,
  onPublished,
  onCancel,
}: {
  initial?: McpDetail;
  onPublished: (name: string, namespace: string) => void;
  onCancel: () => void;
}) {
  const publish = usePublishMcp();
  const formRef = useRef<HTMLFormElement>(null);
  const readmeInputRef = useRef<HTMLInputElement>(null);
  const pkg = initial?.packages?.[0];
  const remote = initial?.remotes?.[0];
  const [delivery, setDelivery] = useState<Delivery>(remote && !pkg ? "remote" : "package");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // A Source the Registry filled in for a server published here is its own address, not a repository.
  const [source, setSource] = useState(initial && importedSource(initial.source) ? initial.source : "");
  const [registry, setRegistry] = useState<McpRegistry>(pkg?.registry_name ?? "npm");
  const [packageName, setPackageName] = useState(pkg?.name ?? "");
  const [version, setVersion] = useState(pkg?.version ?? "");
  const [envRows, setEnvRows] = useState<McpEnvRow[]>(
    (pkg?.environment_variables ?? []).map(({ name, required }) => ({ name, required: required ?? false })),
  );
  const [transport, setTransport] = useState<McpTransport>(remote?.transport_type ?? "http");
  const [url, setUrl] = useState(remote?.url ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [readmeError, setReadmeError] = useState<string>();

  function updateEnvRow(index: number, change: Partial<McpEnvRow>) {
    setEnvRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }

  async function handleReadmePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again, after editing the text, still loads it.
    event.target.value = "";
    if (!file) return;
    try {
      setBody(await file.text());
      setReadmeError(undefined);
    } catch {
      setReadmeError(`Could not read ${file.name}. Try again.`);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const shared = {
      id: initial?.id,
      name: name.trim(),
      description: description.trim(),
      body: body.trim() || null,
      source: source.trim() || undefined,
    };
    const input =
      delivery === "package"
        ? {
            ...shared,
            packages: [
              {
                registry_name: registry,
                name: packageName.trim(),
                version: version.trim() || undefined,
                package_arguments: pkg?.package_arguments,
                environment_variables: toEnvironmentVariables(envRows, pkg?.environment_variables ?? []),
              },
            ],
          }
        : {
            ...shared,
            remotes: [{ transport_type: transport, url: url.trim(), headers: remote?.headers }],
          };
    publish.mutate(input, { onSuccess: (mcp) => onPublished(mcp.name, mcp.namespace) });
  }

  return (
    // `contents`, so the body and footer stay the dialog's own flex children while the
    // footer's button still submits through the form, with the browser checking required fields.
    <form ref={formRef} onSubmit={handleSubmit} className="contents">
      <FormDialogBody>
        <FormField label="Name" htmlFor="mcp-name" helperText={initial ? "A server's name cannot change." : undefined}>
          <Input
            id="mcp-name"
            required
            disabled={Boolean(initial)}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Eg: weather"
          />
        </FormField>

        <FormField
          label="Description"
          htmlFor="mcp-description"
          trailing={
            <span className="text-xs text-muted-foreground tabular-nums">
              {description.length}/{MCP_DESCRIPTION_MAX_LENGTH}
            </span>
          }
        >
          <Input
            id="mcp-description"
            required
            maxLength={MCP_DESCRIPTION_MAX_LENGTH}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Eg: Get forecasts and severe weather alerts for any city"
          />
        </FormField>

        <FormField label="Repository" htmlFor="mcp-source">
          <Input
            id="mcp-source"
            type="url"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="Eg: https://github.com/acme/weather-mcp"
          />
        </FormField>

        <Tabs value={delivery} onValueChange={(value) => setDelivery(value as Delivery)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="package">Package</TabsTrigger>
            <TabsTrigger value="remote">Remote</TabsTrigger>
          </TabsList>

          <TabsContent value="package" className="mt-4 flex flex-col gap-6">
            <div className="grid gap-6 sm:grid-cols-[140px_minmax(0,1fr)_120px] sm:gap-3">
              <FormField label="Registry" htmlFor="mcp-registry">
                <Select value={registry} onValueChange={(value) => setRegistry(value as McpRegistry)}>
                  <SelectTrigger id="mcp-registry" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MCP_REGISTRIES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Package" htmlFor="mcp-package">
                <Input
                  id="mcp-package"
                  required={delivery === "package"}
                  value={packageName}
                  onChange={(event) => setPackageName(event.target.value)}
                  placeholder="Eg: @acme/weather-mcp"
                />
              </FormField>
              <FormField label="Version" htmlFor="mcp-version">
                <Input
                  id="mcp-version"
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  placeholder="Eg: 1.0.0"
                />
              </FormField>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-env-0">Environment variables</Label>
              {envRows.map((row, index) => (
                <div key={index} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2">
                  <Input
                    id={`mcp-env-${index}`}
                    aria-label="Variable name"
                    value={row.name}
                    onChange={(event) => updateEnvRow(index, { name: event.target.value })}
                    placeholder="Eg: WEATHER_API_KEY"
                    className="font-mono text-xs"
                  />
                  <Select
                    value={row.required ? "required" : "optional"}
                    onValueChange={(value) => updateEnvRow(index, { required: value === "required" })}
                  >
                    <SelectTrigger aria-label="Required or optional" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="required">Required</SelectItem>
                      <SelectItem value="optional">Optional</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove variable"
                    className="text-muted-foreground"
                    onClick={() => setEnvRows((rows) => rows.filter((_, i) => i !== index))}
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => setEnvRows((rows) => [...rows, { name: "", required: true }])}
              >
                <PlusIcon />
                Add variable
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="remote" className="mt-4">
            <div className="grid gap-6 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-3">
              <FormField label="Transport" htmlFor="mcp-transport">
                <Select value={transport} onValueChange={(value) => setTransport(value as McpTransport)}>
                  <SelectTrigger id="mcp-transport" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MCP_TRANSPORTS.filter((option) => option !== "stdio").map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="URL" htmlFor="mcp-url">
                <Input
                  id="mcp-url"
                  type="url"
                  required={delivery === "remote"}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="Eg: https://mcp.acme.com/mcp"
                />
              </FormField>
            </div>
          </TabsContent>
        </Tabs>

        <FormField label="README" htmlFor="mcp-body" helperText={readmeError}>
          <div className="relative">
            <Textarea
              id="mcp-body"
              rows={6}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="font-mono text-xs"
            />
            {/* A placeholder with a button in it: a native one is text only. Clicks
                outside the button fall through to the textarea, so it still focuses. */}
            {!body && (
              <div className="pointer-events-none absolute inset-x-2.5 top-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                Start typing, or
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="pointer-events-auto -mx-1 text-foreground"
                  onClick={() => readmeInputRef.current?.click()}
                >
                  <ImportIcon />
                  Import README
                </Button>
              </div>
            )}
          </div>
        </FormField>
        <input
          ref={readmeInputRef}
          type="file"
          accept=".md,.markdown,text/markdown"
          className="hidden"
          onChange={handleReadmePicked}
        />

        {publish.isError && <p className="text-sm text-pretty text-destructive">{apiErrorMessage(publish.error)}</p>}
      </FormDialogBody>

      <FormDialogFooter
        onCancel={onCancel}
        cancelDisabled={publish.isPending}
        submit={{
          label: initial ? "Save changes" : "List MCP server",
          pendingLabel: initial ? "Saving…" : "Listing…",
          pending: publish.isPending,
          onClick: () => formRef.current?.requestSubmit(),
        }}
      />
    </form>
  );
}
