import { INTEGRATION_DESCRIPTION_MAX_LENGTH, type Integration } from "@in-org-quicko/skillset-shared";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader, FormField } from "@/components/ui/dialog";
import { PROVIDER_ICONS } from "@/components/provider-icons";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateIntegration, useUpdateIntegration } from "@/hooks/use-integrations";
import { apiErrorMessage } from "@/lib/api";

const GithubIcon = PROVIDER_ICONS.github;

/**
 * Configures an Integration — a GitHub App registered with Skillset —
 * either a new one or an existing one.
 *
 * @remarks
 * GitHub only: it is the sole Git Provider with a credentialed flow (ADR-0024),
 * so there is no provider picker — creating one always registers a GitHub App.
 *
 * The client secret is never filled in when editing, because no response
 * returns it; leaving it blank keeps the stored one.
 */
export function IntegrationDialog({
  open,
  onOpenChange,
  integration,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Integration being edited, or `null` to configure a new one. */
  integration: Integration | null;
}) {
  const isEdit = integration !== null;

  const [displayName, setDisplayName] = useState(integration?.display_name ?? "");
  const [description, setDescription] = useState(integration?.description ?? "");
  const [clientId, setClientId] = useState(integration?.client_id ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [appSlug, setAppSlug] = useState(integration?.app_slug ?? "");

  const create = useCreateIntegration();
  const update = useUpdateIntegration();
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  function handleOpenChange(next: boolean) {
    if (!next) {
      create.reset();
      update.reset();
      setClientSecret("");
    }
    onOpenChange(next);
  }

  function handleSubmit() {
    const trimmedSlug = appSlug.trim();
    const trimmedDescription = description.trim();

    if (isEdit) {
      update.mutate(
        {
          id: integration.id,
          body: {
            display_name: displayName,
            description: trimmedDescription === "" ? null : trimmedDescription,
            client_id: clientId,
            // Blank means "leave the stored secret alone" — the field starts
            // blank every time, since it can never be read back to prefill.
            ...(clientSecret === "" ? {} : { client_secret: clientSecret }),
            app_slug: trimmedSlug === "" ? null : trimmedSlug,
          },
        },
        { onSuccess: () => handleOpenChange(false) },
      );
      return;
    }

    create.mutate(
      {
        provider: "github",
        display_name: displayName,
        description: trimmedDescription === "" ? null : trimmedDescription,
        client_id: clientId,
        client_secret: clientSecret,
        app_slug: trimmedSlug === "" ? null : trimmedSlug,
      },
      { onSuccess: () => handleOpenChange(false) },
    );
  }

  const canSubmit =
    displayName.trim() !== "" && clientId.trim() !== "" && (isEdit || clientSecret !== "");

  return (
    <FormDialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogHeader
        icon={GithubIcon}
        title={isEdit ? `Edit ${integration.display_name}` : "Add GitHub app"}
        description="A Github app created for Skillset to access repositories."
      />

      <FormDialogBody>
        <FormField htmlFor="integration_display_name" label="Display name">
          <Input
            id="integration_display_name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Eg. Platform repos"
            disabled={pending}
          />
        </FormField>

        <FormField
          htmlFor="integration_description"
          label="Description"
          trailing={
            <span className="text-xs text-muted-foreground">
              {description.length}/{INTEGRATION_DESCRIPTION_MAX_LENGTH}
            </span>
          }
        >
          <Textarea
            id="integration_description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={INTEGRATION_DESCRIPTION_MAX_LENGTH}
            placeholder="Eg. Skills from the platform team's private repos, synced on every push to main."
            disabled={pending}
            className="min-h-[84px] resize-none"
          />
        </FormField>

        <FormField htmlFor="integration_app_slug" label="App slug">
          <Input
            id="integration_app_slug"
            value={appSlug}
            onChange={(event) => setAppSlug(event.target.value)}
            placeholder="Eg. acme-skillset"
            disabled={pending}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField htmlFor="integration_client_id" label="Client ID">
            <Input
              id="integration_client_id"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={pending}
              autoComplete="off"
            />
          </FormField>

          <FormField htmlFor="integration_client_secret" label="Client secret">
            <Input
              id="integration_client_secret"
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              disabled={pending}
              placeholder={isEdit ? "Leave blank to keep the stored secret" : ""}
              // Not the viewer's own login password — "new-password" is what
              // reliably stops a browser from offering to autofill it with
              // their saved site credentials.
              autoComplete="new-password"
            />
          </FormField>
        </div>

        {error && <p className="text-sm text-destructive">{apiErrorMessage(error)}</p>}
      </FormDialogBody>

      <FormDialogFooter
        onCancel={() => handleOpenChange(false)}
        submit={{
          label: isEdit ? "Save changes" : "Add Integration",
          pending,
          disabled: !canSubmit,
          onClick: handleSubmit,
          icon: isEdit ? undefined : PlusIcon,
        }}
      />
    </FormDialog>
  );
}
