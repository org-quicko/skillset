import {
  IDENTITY_PROVIDER_GUIDANCE,
  IDENTITY_PROVIDER_KINDS,
  isUngated,
  type IdentityProvider,
  type IdentityProviderKind,
} from "@skill-registry/shared";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader, FormField } from "@/components/form-dialog";
import { PROVIDER_ICONS } from "@/components/provider-icons";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [displayName, setDisplayName] = useState(provider?.display_name ?? "");
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
            display_name: displayName,
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
        display_name: displayName,
        client_id: clientId,
        client_secret: clientSecret,
        permitted_organisations: parsedOrganisations,
      },
      { onSuccess: () => handleOpenChange(false) },
    );
  }

  const canSubmit =
    displayName.trim() !== "" && clientId.trim() !== "" && (isEdit || clientSecret !== "");

  return (
    // Wider than the house 516px: this form has seven fields, most of them
    // carrying a line or two of guidance underneath.
    <FormDialog open={open} onOpenChange={handleOpenChange} className="w-[576px] max-w-[576px] sm:max-w-[576px]">
      <FormDialogHeader
        title={isEdit ? `Edit ${provider.display_name}` : "Add an Identity Provider"}
        description="Register this Registry as an application with the provider, then paste its credentials here. A Provider stays disabled until you enable it."
      />

      <FormDialogBody>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="idp_kind">Kind</Label>
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

        <FormField
          htmlFor="idp_display_name"
          label="Button label"
          helperText="Shown on the login page as “Continue with …”."
        >
          <Input
            id="idp_display_name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={pending}
            placeholder={guidance.label}
          />
        </FormField>

        <FormField htmlFor="idp_client_id" label="Client id">
          <Input
            id="idp_client_id"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            disabled={pending}
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
          />
        </FormField>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="idp_permitted_organisations">{guidance.organisation}</Label>
          <Input
            id="idp_permitted_organisations"
            value={permittedOrganisations}
            onChange={(event) => setPermittedOrganisations(event.target.value)}
            disabled={pending}
            placeholder="Separate several with commas"
          />

          {parsedOrganisations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {parsedOrganisations.map((organisation) => (
                <Badge key={organisation.toLowerCase()} variant="secondary">
                  {organisation}
                </Badge>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {guidance.organisationHint} Anyone they match who signs in here gets an account as a reader.
          </p>

          {/* The one setting on this form that can open the Registry to
              everyone, and it does it by being left blank — which is
              exactly how it would go unnoticed. */}
          {isUngated(parsedOrganisations) && (
            <p className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Leaving this empty turns the check off entirely. Anyone who can sign in with{" "}
              {guidance.label} — not just your organisation — will be able to create an account here as a
              reader.
            </p>
          )}
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
