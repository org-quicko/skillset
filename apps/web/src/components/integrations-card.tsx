import { GIT_PROVIDERS, type Integration } from "@in-org-quicko/skillset-shared";
import { EllipsisIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { DeleteIntegrationDialog } from "@/components/delete-integration-dialog";
import { IntegrationDialog } from "@/components/integration-dialog";
import { Panel } from "@/components/panel";
import { GIT_PROVIDER_ICONS } from "@/components/provider-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useIntegrations } from "@/hooks/use-integrations";
import { apiErrorMessage } from "@/lib/api";

/** Placeholder integration tiles while `useIntegrations` is in flight. */
function IntegrationTilesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <Panel key={index}>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-1.5 h-3 w-40" />
        </Panel>
      ))}
    </div>
  );
}

/**
 * One configured Integration: its display name, the Git Provider it reads
 * from, and its description, with a trailing "..." menu for the actions
 * available on it.
 *
 * @remarks
 * Editing opens the same dialog `AddIntegration` uses, prefilled — there is
 * no separate inline form. The app slug that actually tells two apps for the
 * same Git Provider apart (ADR-0025) still lives in that dialog; it is
 * Admin-facing detail rather than something every tile needs to surface.
 */
function IntegrationTile({
  integration,
  onEdit,
  onDelete,
}: {
  integration: Integration;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const providerName = GIT_PROVIDERS[integration.provider]?.display_name ?? integration.provider;
  const ProviderIcon = GIT_PROVIDER_ICONS[integration.provider];

  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="truncate text-sm font-medium">{integration.display_name}</span>
          <div className="flex items-center gap-1.5">
            {ProviderIcon && <ProviderIcon className="size-[26px] shrink-0" aria-hidden />}
            <span className="truncate text-sm text-muted-foreground">{providerName}</span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm">
              <EllipsisIcon />
              <span className="sr-only">Actions for {integration.display_name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <PencilIcon />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {integration.description && <p className="mt-3 text-sm text-muted-foreground">{integration.description}</p>}
    </Panel>
  );
}

/**
 * An Admin's view of Skillset's registrations with Git Providers
 * (ADR-0024, ADR-0025).
 *
 * @remarks
 * Deliberately its own section rather than a card under Login, and the copy
 * says why in as many words: this is **not** a way to sign in. Signing in with
 * GitHub and importing from GitHub are two separate registrations that share
 * nothing but a vendor, and an Admin led to believe otherwise will turn off the
 * wrong one.
 *
 * An Integration's existence is the only switch importing has — there is no
 * enable flag — so an operator who wants Skillset to hold no repository
 * credentials for anybody simply registers nothing. More than one Integration
 * may exist for the same provider, each its own tile.
 */
export function IntegrationsCard() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Integration | null>(null);
  const [deleting, setDeleting] = useState<Integration | null>(null);

  const integrations = useIntegrations();
  const configured = integrations.data?.items ?? [];

  function openDialog(integration: Integration | null) {
    setEditing(integration);
    setDialogOpen(true);
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Integrations</h2>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Apps that let Skillset read content from repositories.
          </p>
        </div>
        <Button size="sm" onClick={() => openDialog(null)}>
          <PlusIcon />
          Add Integration
        </Button>
      </div>

      {integrations.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(integrations.error)}</p>
      )}

      {integrations.isPending && <IntegrationTilesSkeleton />}

      {integrations.isSuccess && configured.length === 0 && (
        <Panel>
          <p className="text-sm text-muted-foreground">
            No Integrations configured. Importing is not available until you add one.
          </p>
        </Panel>
      )}

      {configured.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {configured.map((integration) => (
            <IntegrationTile
              key={integration.id}
              integration={integration}
              onEdit={() => openDialog(integration)}
              onDelete={() => setDeleting(integration)}
            />
          ))}
        </div>
      )}

      {/* Keyed so switching between "add" and editing a particular Integration
          remounts the form rather than leaving the previous one's values in
          its state. */}
      <IntegrationDialog key={editing?.id ?? "new"} open={dialogOpen} onOpenChange={setDialogOpen} integration={editing} />

      {deleting && (
        <DeleteIntegrationDialog
          integrationId={deleting.id}
          name={deleting.display_name}
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
        />
      )}
    </div>
  );
}
