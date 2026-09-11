import {
  IDENTITY_PROVIDER_GUIDANCE,
  IDENTITY_PROVIDER_KINDS,
  type IdentityProvider,
  type IdentityProviderKind,
} from "@in-org-quicko/skillset-shared";
import { InfoIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader, FormField } from "@/components/ui/dialog";
import { PROVIDER_ICONS } from "@/components/provider-icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCreateIdentityProvider, useUpdateIdentityProvider } from "@/hooks/use-identity-providers";
import { apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Splits what an Admin typed into the organisations that will be stored.
 *
 * @remarks
 * Commas or newlines, because an Admin pasting a list from elsewhere should
 * not have to care which one they got. Deduplication is left to the API, which
 * has to do it anyway for requests that never came from this form.
 *
 * @param value - The raw field contents.
 * @returns The organisations named, trimmed, with blanks dropped.
 * @example
 * ```ts
 * parseOrganisations("acme, acme-labs"); // ["acme", "acme-labs"]
 * ```
 */
function parseOrganisations(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * Configures an Identity Provider, either a new one or an existing one.
 *
 * @remarks
 * Editing differs from creating in two ways that both come straight from the
 * data model. `kind` is shown but not editable, because it *is* the Provider's
 * identity (ADR-0017) — changing it would silently repoint a live
 * configuration rather than configure a second one. And the client secret is
 * never filled in, because no response returns it; leaving it blank keeps the
 * stored one.
 */
export function IdentityProviderDialog({
  open,
  onOpenChange,
  provider,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Provider being edited, or `null` to configure a new one. */
  provider: IdentityProvider | null;
}) {
  const isEdit = provider !== null;

  const [kind, setKind] = useState<IdentityProviderKind>(provider?.kind ?? "google");
  const [clientId, setClientId] = useState(provider?.client_id ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [permittedOrganisations, setPermittedOrganisations] = useState(
    (provider?.permitted_organisations ?? []).join(", "),
  );

  // Parsed on every keystroke rather than only on submit, so the chips below
  // the field show exactly what will be stored — separators are easy to get
  // wrong and an unnoticed empty list is the one mistake that matters here.
  const parsedOrganisations = parseOrganisations(permittedOrganisations);

  const create = useCreateIdentityProvider();
  const update = useUpdateIdentityProvider();
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const guidance = IDENTITY_PROVIDER_GUIDANCE[kind];

  function handleOpenChange(next: boolean) {
    if (!next) {
      create.reset();
      update.reset();
      setClientSecret("");
    }
    onOpenChange(next);
  }

  function handleSubmit() {
    if (isEdit) {
      update.mutate(
        {
          id: provider.id,
          body: {
            display_name: guidance.label,
            client_id: clientId,
            permitted_organisations: parsedOrganisations,
            // Blank means "leave the stored secret alone" — the field starts
            // blank every time, since it can never be read back to prefill.
            ...(clientSecret === "" ? {} : { client_secret: clientSecret }),
          },
        },
        { onSuccess: () => handleOpenChange(false) },
      );
      return;
    }

    create.mutate(
      {
        kind,
        display_name: guidance.label,
        client_id: clientId,
        client_secret: clientSecret,
        permitted_organisations: parsedOrganisations,
        // A new Provider comes up enabled — disabling one is a choice made
        // afterward, from its row, not a decision to front-load onto this form.
        enabled: true,
      },
      { onSuccess: () => handleOpenChange(false) },
    );
  }

  const canSubmit = clientId.trim() !== "" && (isEdit || clientSecret !== "");

  return (
    <FormDialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogHeader
        title={isEdit ? `Edit ${provider.display_name}` : "Add an Identity Provider"}
        description="Set up an OAuth app with the provider, then paste its client ID and secret below."
      />

      <FormDialogBody>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="idp_kind">Provider</Label>
          {isEdit ? (
            <Input id="idp_kind" value={guidance.label} readOnly disabled />
          ) : (
            <div id="idp_kind" role="radiogroup" className="grid grid-cols-3 gap-2">
              {IDENTITY_PROVIDER_KINDS.map((option) => {
                const Icon = PROVIDER_ICONS[option];
                const selected = option === kind;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={pending}
                    onClick={() => setKind(option)}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-sm font-medium transition-colors",
                      selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <Icon className="size-6 shrink-0" />
                    <span className="text-center leading-snug">{IDENTITY_PROVIDER_GUIDANCE[option].label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField htmlFor="idp_client_id" label="Client ID">
            <Input
              id="idp_client_id"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={pending}
              autoComplete="off"
            />
          </FormField>

          <FormField htmlFor="idp_client_secret" label="Client secret">
            <Input
              id="idp_client_secret"
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              disabled={pending}
              placeholder={isEdit ? "Leave blank to keep the current secret" : ""}
              // Not the viewer's own login password — "new-password" is what
              // reliably stops a browser from offering to autofill it with
              // their saved site credentials (e.g. a saved Google account).
              autoComplete="new-password"
            />
          </FormField>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="idp_permitted_organisations">{guidance.organisation}</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoIcon className="size-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>{guidance.organisationTooltip}</TooltipContent>
            </Tooltip>
          </div>
          <Input
            id="idp_permitted_organisations"
            value={permittedOrganisations}
            onChange={(event) => setPermittedOrganisations(event.target.value)}
            disabled={pending}
            placeholder="Separate several with commas"
          />

          <p className="text-xs text-muted-foreground">{guidance.organisationSupport}</p>
        </div>

        {error && <p className="text-sm text-destructive">{apiErrorMessage(error)}</p>}
      </FormDialogBody>

      <FormDialogFooter
        onCancel={() => handleOpenChange(false)}
        submit={{
          label: isEdit ? "Save changes" : "Add Provider",
          pending,
          disabled: !canSubmit,
          onClick: handleSubmit,
          icon: isEdit ? undefined : PlusIcon,
        }}
      />
    </FormDialog>
  );
}
