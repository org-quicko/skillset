import { GIT_PROVIDER_KEYS, GIT_PROVIDERS, type Integration } from "@skill-registry/shared";
import { useState, type FormEvent } from "react";
import { LabeledField } from "@/components/labeled-field";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateIntegration, useIntegrations, useUpdateIntegration } from "@/hooks/use-integrations";
import { apiErrorMessage } from "@/lib/api";

/** Only providers with a credentialed flow can be registered; the rest are public-read only. */
const CONNECTABLE = GIT_PROVIDER_KEYS.filter((provider) => GIT_PROVIDERS[provider]?.oauth !== null);

function EditIntegration({ integration }: { integration: Integration }) {
  const [clientId, setClientId] = useState(integration.client_id);
  const [clientSecret, setClientSecret] = useState("");
  const [appSlug, setAppSlug] = useState(integration.app_slug ?? "");
  const update = useUpdateIntegration();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    update.mutate({
      provider: integration.provider,
      body: {
        client_id: clientId,
        // Omitted when blank, which is what leaves the stored secret alone.
        // There is no way to show it back — no response carries it — so an
        // empty field means "unchanged", not "clear it".
        ...(clientSecret.trim() === "" ? {} : { client_secret: clientSecret }),
        app_slug: appSlug.trim() === "" ? null : appSlug.trim(),
      },
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <LabeledField label="Client ID" htmlFor={`${integration.provider}_client_id`}>
        <Input
          id={`${integration.provider}_client_id`}
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          required
          className="h-10"
        />
      </LabeledField>

      <LabeledField
        label="Client secret"
        htmlFor={`${integration.provider}_client_secret`}
        hint="Leave blank to keep the stored secret. It is never shown back."
      >
        <Input
          id={`${integration.provider}_client_secret`}
          type="password"
          placeholder="••••••••"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          className="h-10"
        />
      </LabeledField>

      <LabeledField
        label="App slug"
        htmlFor={`${integration.provider}_app_slug`}
        hint="From the app's URL at the provider. It is what the install link is built from, so importing cannot work without it."
      >
        <Input
          id={`${integration.provider}_app_slug`}
          value={appSlug}
          onChange={(event) => setAppSlug(event.target.value)}
          placeholder="acme-skill-registry"
          className="h-10"
        />
      </LabeledField>

      {update.isError && <p className="text-sm text-destructive">{apiErrorMessage(update.error)}</p>}
      <Button type="submit" size="sm" className="w-fit" disabled={update.isPending}>
        {update.isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

function AddIntegration({ taken }: { taken: string[] }) {
  const available = CONNECTABLE.filter((provider) => !taken.includes(provider));
  const [provider, setProvider] = useState(available[0] ?? "");
  const [displayName, setDisplayName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [appSlug, setAppSlug] = useState("");
  const create = useCreateIntegration();

  if (available.length === 0) return null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      {
        provider,
        display_name: displayName,
        client_id: clientId,
        client_secret: clientSecret,
        app_slug: appSlug.trim() === "" ? null : appSlug.trim(),
      },
      {
        onSuccess: () => {
          setDisplayName("");
          setClientId("");
          setClientSecret("");
          setAppSlug("");
        },
      },
    );
  }

  return (
    <Panel
      title="Add an integration"
      description="Register an app you created at the Git Provider. Creating this is what makes importing available — there is no separate switch."
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <LabeledField label="Git Provider" htmlFor="integration_provider">
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger id="integration_provider" className="capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {available.map((option) => (
                <SelectItem key={option} value={option} className="capitalize">
                  {GIT_PROVIDERS[option]?.display_name ?? option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LabeledField>

        <LabeledField label="Display name" htmlFor="integration_display_name">
          <Input
            id="integration_display_name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="GitHub"
            required
            className="h-10"
          />
        </LabeledField>

        <LabeledField label="Client ID" htmlFor="integration_client_id">
          <Input
            id="integration_client_id"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            required
            className="h-10"
          />
        </LabeledField>

        <LabeledField label="Client secret" htmlFor="integration_client_secret">
          <Input
            id="integration_client_secret"
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            required
            className="h-10"
          />
        </LabeledField>

        <LabeledField
          label="App slug"
          htmlFor="integration_app_slug"
          hint="From the app's URL at the provider — github.com/apps/<slug>. Required for GitHub."
        >
          <Input
            id="integration_app_slug"
            value={appSlug}
            onChange={(event) => setAppSlug(event.target.value)}
            placeholder="acme-skill-registry"
            className="h-10"
          />
        </LabeledField>

        {create.isError && <p className="text-sm text-destructive">{apiErrorMessage(create.error)}</p>}
        <Button type="submit" className="w-fit" disabled={create.isPending}>
          {create.isPending ? "Saving…" : "Add integration"}
        </Button>
      </form>
    </Panel>
  );
}

/**
 * An Admin's view of the Registry's registrations with Git Providers
 * (ADR-0024).
 *
 * @remarks
 * Deliberately its own section rather than a card under Login, and the copy
 * says why in as many words: this is **not** a way to sign in. Signing in with
 * GitHub and importing from GitHub are two separate registrations that share
 * nothing but a vendor, and an Admin led to believe otherwise will turn off the
 * wrong one.
 *
 * An Integration's existence is the only switch importing has — there is no
 * enable flag — so an operator who wants this Registry to hold no repository
 * credentials for anybody simply registers nothing.
 */
export function IntegrationsCard() {
  const integrations = useIntegrations();
  const configured = integrations.data?.items ?? [];

  return (
    <div className="flex max-w-xl flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Integrations</h2>
        <p className="text-xs text-muted-foreground">
          Apps this Registry uses to read Skills out of private repositories. This is not a way to sign
          in — that is configured under Login, separately, and either can be turned off without
          affecting the other.
        </p>
      </div>

      {integrations.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {integrations.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(integrations.error)}</p>
      )}

      {configured.map((integration) => (
        <Panel
          key={integration.provider}
          title={integration.display_name}
          description={`Importing is available for ${integration.provider} because this exists. Removing it is not offered — writers hold connections against it.`}
        >
          <EditIntegration integration={integration} />
        </Panel>
      ))}

      {integrations.isSuccess && (
        <AddIntegration taken={configured.map((integration) => integration.provider)} />
      )}
    </div>
  );
}
