import {
  IDENTITY_PROVIDER_GUIDANCE,
  IDENTITY_PROVIDER_KINDS,
  type IdentityProvider,
  type IdentityProviderKind,
} from "@skill-registry/shared";
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
import { useCreateIdentityProvider, useUpdateIdentityProvider } from "@/hooks/use-identity-providers";
import { apiErrorMessage } from "@/lib/api";

/**
 * Configures an Identity Provider, either a new one or an existing one.
 *
 * @remarks
 * Editing differs from creating in two ways that both come straight from the
 * data model. `slug` and `kind` are shown but not editable: the slug is what a
 * login carries back in `state` and the kind decides which claim gates the
 * domain, so changing either would silently repoint a live configuration. And
 * the client secret is never filled in, because no response returns it —
 * leaving it blank keeps the stored one.
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
  const [slug, setSlug] = useState(provider?.slug ?? "");
  const [displayName, setDisplayName] = useState(provider?.display_name ?? "");
  const [issuerUrl, setIssuerUrl] = useState(provider?.issuer_url ?? "");
  const [clientId, setClientId] = useState(provider?.client_id ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [permittedDomain, setPermittedDomain] = useState(provider?.permitted_domain ?? "");

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
    const domain = permittedDomain.trim() === "" ? null : permittedDomain.trim();

    if (isEdit) {
      update.mutate(
        {
          id: provider.id,
          body: {
            display_name: displayName,
            issuer_url: issuerUrl,
            client_id: clientId,
            permitted_domain: domain,
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
        slug,
        kind,
        display_name: displayName,
        issuer_url: issuerUrl,
        client_id: clientId,
        client_secret: clientSecret,
        permitted_domain: domain,
      },
      { onSuccess: () => handleOpenChange(false) },
    );
  }

  const canSubmit =
    displayName.trim() !== "" &&
    issuerUrl.trim() !== "" &&
    clientId.trim() !== "" &&
    (isEdit || (slug.trim() !== "" && clientSecret !== ""));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Wider than the sm:max-w-sm default: this form has seven fields, most
          of them carrying a line or two of guidance underneath. */}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${provider.display_name}` : "Add an Identity Provider"}</DialogTitle>
          <DialogDescription>
            Register this Registry as an application with the provider, then paste its credentials here. A
            Provider stays disabled until you enable it.
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-hidden flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idp_kind">Kind</Label>
            {isEdit ? (
              <Input id="idp_kind" value={guidance.label} readOnly disabled />
            ) : (
              <Select value={kind} onValueChange={(value) => setKind(value as IdentityProviderKind)} disabled={pending}>
                <SelectTrigger id="idp_kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IDENTITY_PROVIDER_KINDS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {IDENTITY_PROVIDER_GUIDANCE[option].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idp_slug">Slug</Label>
            <Input
              id="idp_slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              readOnly={isEdit}
              disabled={isEdit || pending}
              placeholder="google"
            />
            <p className="text-xs text-muted-foreground">
              {isEdit
                ? "Fixed once set — a login carries it back from the provider."
                : "Lowercase letters, digits, and hyphens. Cannot be changed later."}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idp_display_name">Button label</Label>
            <Input
              id="idp_display_name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={pending}
              placeholder={guidance.label}
            />
            <p className="text-xs text-muted-foreground">Shown on the login page as “Continue with …”.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idp_issuer_url">Issuer URL</Label>
            <Input
              id="idp_issuer_url"
              value={issuerUrl}
              onChange={(event) => setIssuerUrl(event.target.value)}
              disabled={pending}
              placeholder={guidance.issuerExample}
            />
            <p className="text-xs text-muted-foreground">
              The issuer itself, not the path to its discovery document.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idp_client_id">Client id</Label>
            <Input
              id="idp_client_id"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={pending}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idp_client_secret">Client secret</Label>
            <Input
              id="idp_client_secret"
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              disabled={pending}
              placeholder={isEdit ? "Leave blank to keep the current secret" : ""}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idp_permitted_domain">{guidance.organisation}</Label>
            <Input
              id="idp_permitted_domain"
              value={permittedDomain}
              onChange={(event) => setPermittedDomain(event.target.value)}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              {guidance.organisationHint} Anyone it matches who signs in here gets an account as a reader, so
              this Provider cannot be enabled without it.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{apiErrorMessage(error)}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit || pending} onClick={handleSubmit}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Add Provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
