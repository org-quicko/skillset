import {
  importedSource,
  MCP_REGISTRIES,
  MCP_TRANSPORTS,
  type McpDetail,
  type McpEnvironmentVariable,
  type McpRegistry,
  type McpTransport,
} from "@in-org-quicko/skillset-shared";
import { useState, type FormEvent } from "react";
import { LabeledField } from "@/components/labeled-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { usePublishMcp } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";

type Delivery = "package" | "remote";

/**
 * One name per line; blank lines are dropped. A name the server already had
 * keeps its description, default, and required flag; a new one is marked
 * required, the common case for tokens and keys.
 */
function parseEnvNames(text: string, existing: McpEnvironmentVariable[]): McpEnvironmentVariable[] | undefined {
  const names = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (names.length === 0) return undefined;
  return names.map((name) => existing.find((variable) => variable.name === name) ?? { name, required: true });
}

/**
 * Publishes a new MCP server, or edits one, from a form: its name and
 * description, its repository, and either a package an agent runs locally or
 * a remote endpoint it connects to.
 *
 * @remarks
 * The form edits a server's first package or remote. Package arguments and
 * remote headers have no field, so an edit keeps the ones the server has.
 *
 * @param initial - The server to edit. Its name cannot change; omit to publish a new server.
 * @param onPublished - Called with the stored name and Namespace once the Registry accepts it.
 */
export function PublishMcpForm({
  initial,
  onPublished,
}: {
  initial?: McpDetail;
  onPublished: (name: string, namespace: string) => void;
}) {
  const publish = usePublishMcp();
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
  const [envNames, setEnvNames] = useState(
    (pkg?.environment_variables ?? []).map((variable) => variable.name).join("\n"),
  );
  const [transport, setTransport] = useState<McpTransport>(remote?.transport_type ?? "http");
  const [url, setUrl] = useState(remote?.url ?? "");
  const [body, setBody] = useState(initial?.body ?? "");

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
                environment_variables: parseEnvNames(envNames, pkg?.environment_variables ?? []),
              },
            ],
          }
        : { ...shared, remotes: [{ transport_type: transport, url: url.trim(), headers: remote?.headers }] };
    publish.mutate(input, { onSuccess: (mcp) => onPublished(mcp.name, mcp.namespace) });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <LabeledField label="Name" htmlFor="mcp-name" hint={initial ? "A server's name cannot change." : undefined}>
        <Input
          id="mcp-name"
          required
          disabled={Boolean(initial)}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="weather"
        />
      </LabeledField>

      <LabeledField label="Description" htmlFor="mcp-description">
        <Input
          id="mcp-description"
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What the server lets an agent do"
        />
      </LabeledField>

      <LabeledField label="Repository" htmlFor="mcp-source" hint="Optional. Where the server's code lives.">
        <Input
          id="mcp-source"
          type="url"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="https://github.com/acme/weather-mcp"
        />
      </LabeledField>

      <Tabs value={delivery} onValueChange={(value) => setDelivery(value as Delivery)}>
        <TabsList>
          <TabsTrigger value="package">Package</TabsTrigger>
          <TabsTrigger value="remote">Remote</TabsTrigger>
        </TabsList>

        <TabsContent value="package" className="flex flex-col gap-4 pt-2">
          <div className="grid grid-cols-[140px_minmax(0,1fr)_120px] gap-3">
            <LabeledField label="Registry">
              <Select value={registry} onValueChange={(value) => setRegistry(value as McpRegistry)}>
                <SelectTrigger className="w-full" aria-label="Registry">
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
            </LabeledField>
            <LabeledField label="Package" htmlFor="mcp-package">
              <Input
                id="mcp-package"
                required={delivery === "package"}
                value={packageName}
                onChange={(event) => setPackageName(event.target.value)}
                placeholder="@acme/weather-mcp"
              />
            </LabeledField>
            <LabeledField label="Version" htmlFor="mcp-version">
              <Input
                id="mcp-version"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                placeholder="latest"
              />
            </LabeledField>
          </div>
          <LabeledField label="Environment variables" htmlFor="mcp-env" hint="One name per line. Each is marked required.">
            <Textarea
              id="mcp-env"
              rows={3}
              value={envNames}
              onChange={(event) => setEnvNames(event.target.value)}
              placeholder="WEATHER_API_KEY"
              className="font-mono text-xs"
            />
          </LabeledField>
        </TabsContent>

        <TabsContent value="remote" className="pt-2">
          <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3">
            <LabeledField label="Transport">
              <Select value={transport} onValueChange={(value) => setTransport(value as McpTransport)}>
                <SelectTrigger className="w-full" aria-label="Transport">
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
            </LabeledField>
            <LabeledField label="URL" htmlFor="mcp-url">
              <Input
                id="mcp-url"
                type="url"
                required={delivery === "remote"}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://mcp.acme.com/mcp"
              />
            </LabeledField>
          </div>
        </TabsContent>
      </Tabs>

      <LabeledField label="Documentation" htmlFor="mcp-body" hint="Optional. Markdown, shown on the server's page.">
        <Textarea id="mcp-body" rows={5} value={body} onChange={(event) => setBody(event.target.value)} />
      </LabeledField>

      {publish.isError && <p className="text-sm text-destructive">{apiErrorMessage(publish.error)}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={publish.isPending}>
          {publish.isPending && <Spinner />}
          {initial ? "Save changes" : "Publish MCP server"}
        </Button>
      </div>
    </form>
  );
}
