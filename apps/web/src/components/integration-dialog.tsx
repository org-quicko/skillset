import { GIT_PROVIDER_KEYS, GIT_PROVIDERS, type Integration } from "@skill-registry/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateIntegration, useUpdateIntegration } from "@/hooks/use-integrations";
import { apiErrorMessage } from "@/lib/api";

/** Only providers with a credentialed flow can be registered; the rest are public-read only. */
const CONNECTABLE = GIT_PROVIDER_KEYS.filter((provider) => GIT_PROVIDERS[provider]?.oauth !== null);

/**
 * Configures an Integration — an app registered with a Git Provider — either a
 * new one or an existing one.
 *
 * @remarks
 * `provider` is shown but not editable once created: it is not the row's
 * identity any more (ADR-0025, several Integrations may share one), but which
 * Git Provider an app is for still does not change after the fact — that
 * would repoint a live registration rather than configure a new one.
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

  const [provider, setProvider] = useState(integration?.provider ?? CONNECTABLE[0] ?? "");
  const [displayName, setDisplayName] = useState(integration?.display_name ?? "");
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

    if (isEdit) {
      update.mutate(
        {
          id: integration.id,
          body: {
            display_name: displayName,
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
        provider,
        display_name: displayName,
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${integration.display_name}` : "Add an integration"}</DialogTitle>
          <DialogDescription>
            Register an app you created at the Git Provider. Creating this is what makes importing
            available — there is no separate switch.
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-hidden flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="integration_provider">Git Provider</Label>
            {isEdit ? (
              <Input
                id="integration_provider"
                value={GIT_PROVIDERS[integration.provider]?.display_name ?? integration.provider}
                readOnly
                disabled
              />
            ) : (
              <Select value={provider} onValueChange={setProvider} disabled={pending}>
                <SelectTrigger id="integration_provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONNECTABLE.map((option) => (
                    <SelectItem key={option} value={option}>
                      {GIT_PROVIDERS[option]?.display_name ?? option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="integration_display_name">Display name</Label>
            <Input
              id="integration_display_name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="GitHub"
              disabled={pending}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="integration_client_id">Client ID</Label>
            <Input
              id="integration_client_id"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={pending}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="integration_client_secret">Client secret</Label>
            <Input
              id="integration_client_secret"
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              disabled={pending}
              placeholder={isEdit ? "Leave blank to keep the stored secret" : ""}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="integration_app_slug">App slug</Label>
            <Input
              id="integration_app_slug"
              value={appSlug}
              onChange={(event) => setAppSlug(event.target.value)}
              placeholder="acme-skill-registry"
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              From the app&apos;s URL at the provider — github.com/apps/&lt;slug&gt;. Required for GitHub, and
              what tells two apps for the same provider apart in this interface.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{apiErrorMessage(error)}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit || pending} onClick={handleSubmit}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Add integration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
