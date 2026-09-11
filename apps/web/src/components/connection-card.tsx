import type { ConnectableProvider, Connection } from "@skillset/shared";
import { EllipsisIcon, ExternalLinkIcon, Link2OffIcon } from "lucide-react";
import { GIT_PROVIDER_ICONS } from "@/components/provider-icons";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { connectHref, useConnections, useDisconnect } from "@/hooks/use-connections";
import { apiErrorMessage } from "@/lib/api";
import { formatDate } from "@/lib/utils";

/** Placeholder rows, shaped like `ConnectedAccountRow`, while `useConnections` is in flight. */
function ConnectionsListSkeleton() {
  return (
    <Panel title="Apps" contentClassName="p-0">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex items-center justify-between gap-4 border-b px-5 py-3 last:border-b-0">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="size-[26px] shrink-0" />
            <div className="flex min-w-0 flex-col gap-1">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <Skeleton className="h-7 w-16 shrink-0 rounded-md" />
        </div>
      ))}
    </Panel>
  );
}

/**
 * One Integration a writer could connect through, and whether they already
 * have — one row per Integration (ADR-0025), so a provider with two
 * configured apps is two rows.
 *
 * @remarks
 * Connecting is a full trip to the provider, so it stays a visible primary
 * button rather than a menu item; a live Connection's actions (changing
 * repositories, disconnecting) sit behind the "..." menu instead, since
 * neither is the thing this row exists to invite.
 */
function ConnectedAccountRow({
  entry,
  connection,
  onDisconnect,
  isPending,
}: {
  entry: ConnectableProvider;
  connection: Connection | undefined;
  onDisconnect: () => void;
  isPending: boolean;
}) {
  const ProviderIcon = GIT_PROVIDER_ICONS[entry.provider];

  return (
    <div className="flex items-center justify-between gap-4 border-b px-5 py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        {ProviderIcon && <ProviderIcon className="size-[26px] shrink-0" aria-hidden />}
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{entry.display_name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {connection
              ? `Connected as ${connection.external_account_login} on ${formatDate(connection.created_at)}`
              : "Not connected"}
          </span>
        </div>
      </div>
      {connection ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" className="shrink-0">
              <EllipsisIcon />
              <span className="sr-only">Actions for {entry.display_name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {/* A trip to the provider, not through our callback: choosing
                repositories grants no credential, so nothing here waits on
                a return. */}
            {entry.manage_access_url && (
              <DropdownMenuItem asChild>
                <a href={entry.manage_access_url} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon />
                  Change repositories
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" disabled={isPending} onClick={onDisconnect}>
              <Link2OffIcon />
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button asChild size="sm" className="shrink-0">
          <a href={connectHref(entry.provider, entry.id)}>Connect</a>
        </Button>
      )}
    </div>
  );
}

/**
 * A writer's own Connected Accounts: what is connected, as which account, and
 * how to connect or withdraw one (ADR-0024).
 *
 * @remarks
 * One row per Integration (app), not per Git Provider (ADR-0025) — a
 * provider with two configured apps offers two rows.
 *
 * Not offered to a reader at all — the settings page hides the whole section
 * below `writer`, and the API refuses them anyway. Inviting a reader to grant
 * a credential they could never use would be worse than useless.
 *
 * The card is also absent when nothing is connectable, which is the state of
 * a Registry whose Admin has configured no Integration. There is nothing to
 * connect to, so a Connect button could only fail when pressed.
 *
 * Disconnecting is Registry-local: it stops this Registry using the grant and
 * does not withdraw it at the provider — that is done from the provider's own
 * account settings.
 */
export function ConnectionCard() {
  const connections = useConnections();
  const disconnect = useDisconnect();

  // One Connection per provider (ADR-0025) — which of a provider's several
  // Integrations it runs through is `integration_id`.
  const byIntegrationId = new Map(connections.data?.items.map((item) => [item.integration_id, item]));
  const connectable = connections.data?.connectable ?? [];

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Connected Accounts</h2>
        <p className="max-w-2xl text-xs text-muted-foreground">
          Accounts you&apos;ve connected so this Registry can read Skills out of a private repository, as
          you. Disconnecting only stops this Registry using the grant — revoke it at the provider
          separately.
        </p>
      </div>

      {connections.isPending && <ConnectionsListSkeleton />}
      {connections.isError && <p className="text-sm text-destructive">{apiErrorMessage(connections.error)}</p>}
      {disconnect.isError && <p className="text-sm text-destructive">{apiErrorMessage(disconnect.error)}</p>}

      {connections.isSuccess && connectable.length === 0 && (
        <Panel>
          <p className="text-sm text-muted-foreground">
            No Git Provider is set up for importing on this Registry. An administrator configures one
            under Integrations.
          </p>
        </Panel>
      )}

      {connectable.length > 0 && (
        <Panel title="Apps" contentClassName="p-0">
          {connectable.map((entry) => (
            <ConnectedAccountRow
              key={entry.id}
              entry={entry}
              connection={byIntegrationId.get(entry.id)}
              isPending={disconnect.isPending && disconnect.variables === entry.provider}
              onDisconnect={() => disconnect.mutate(entry.provider)}
            />
          ))}
        </Panel>
      )}
    </div>
  );
}
