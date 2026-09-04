import { GIT_PROVIDERS, type Integration } from "@skill-registry/shared";
import { useState } from "react";
import { IntegrationDialog } from "@/components/integration-dialog";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useIntegrations } from "@/hooks/use-integrations";
import { apiErrorMessage } from "@/lib/api";

/** Placeholder integration tiles while `useIntegrations` is in flight. */
function IntegrationTilesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-1.5 h-3 w-40" />
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

/**
 * One configured Integration, identified by its app slug — what actually
 * tells two apps for the same Git Provider apart (ADR-0025) — with the
 * Admin-chosen display name and provider as secondary detail.
 *
 * @remarks
 * Clicking anywhere on the tile opens it in the same dialog `AddIntegration`
 * uses, prefilled — there is no separate inline form any more.
 */
function IntegrationTile({ integration, onClick }: { integration: Integration; onClick: () => void }) {
  const providerName = GIT_PROVIDERS[integration.provider]?.display_name ?? integration.provider;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className="cursor-pointer transition-shadow hover:ring-2 hover:ring-foreground/20"
    >
      <CardHeader>
        <CardTitle className="truncate">{integration.app_slug ?? integration.display_name}</CardTitle>
        <CardDescription className="truncate">
          {integration.app_slug ? `${integration.display_name} · ${providerName}` : `${providerName} · no app slug set`}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

/**
 * An Admin's view of the Registry's registrations with Git Providers
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
 * enable flag — so an operator who wants this Registry to hold no repository
 * credentials for anybody simply registers nothing. More than one Integration
 * may exist for the same provider, each its own tile.
 */
export function IntegrationsCard() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Integration | null>(null);

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
            Apps this Registry uses to read Skills out of private repositories. This is not a way to sign
            in — that is configured under Login, separately, and either can be turned off without
            affecting the other.
          </p>
        </div>
        <Button size="sm" onClick={() => openDialog(null)}>
          Add integration
        </Button>
      </div>

      {integrations.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(integrations.error)}</p>
      )}

      {integrations.isPending && <IntegrationTilesSkeleton />}

      {integrations.isSuccess && configured.length === 0 && (
        <Panel>
          <p className="text-sm text-muted-foreground">
            No integrations configured. Importing is not available until you add one.
          </p>
        </Panel>
      )}

      {configured.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {configured.map((integration) => (
            <IntegrationTile
              key={integration.id}
              integration={integration}
              onClick={() => openDialog(integration)}
            />
          ))}
        </div>
      )}

      {/* Keyed so switching between "add" and editing a particular Integration
          remounts the form rather than leaving the previous one's values in
          its state. */}
      <IntegrationDialog key={editing?.id ?? "new"} open={dialogOpen} onOpenChange={setDialogOpen} integration={editing} />
    </div>
  );
}
