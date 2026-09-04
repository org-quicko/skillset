import { GIT_PROVIDERS, type ConnectableProvider, type Connection } from "@skill-registry/shared";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { connectHref, useConnections, useDisconnect } from "@/hooks/use-connections";
import { apiErrorMessage } from "@/lib/api";
import { formatMoment } from "@/lib/utils";

/** Placeholder connection panels while `useConnections` is in flight. */
function ConnectionsSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }).map((_, index) => (
        <Panel key={index}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-7 w-24 rounded-md" />
          </div>
        </Panel>
      ))}
    </>
  );
}

/**
 * What disconnecting actually does, said in full.
 *
 * @remarks
 * This sentence is load-bearing, not padding. Disconnecting is
 * **Registry-local**: it stops this Registry using the grant and does not
 * withdraw it at the provider, which only the writer can do in their own
 * provider settings. If this card ever says "revoked" without that
 * qualification, the product and ADR-0024 disagree, and the ADR is right.
 */
const DISCONNECT_COPY =
  "Disconnecting stops this Registry using the grant. It does not withdraw it at the provider — " +
  "to do that, remove this app from your account there.";

/** What an entry calls itself: the app slug — what actually tells two apps for the same provider apart (ADR-0025) — falling back to its display name when there is none set yet. */
function entryLabel(entry: ConnectableProvider): string {
  return entry.app_slug ?? entry.display_name;
}

function ConnectedRow({
  connection,
  entry,
  onDisconnect,
  isPending,
}: {
  connection: Connection;
  entry: ConnectableProvider;
  onDisconnect: () => void;
  isPending: boolean;
}) {
  const label = entryLabel(entry);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-medium">
            {label} · {connection.external_account_login}
          </span>
          <span className="text-xs text-muted-foreground">
            {entry.display_name} · {GIT_PROVIDERS[entry.provider]?.display_name ?? entry.provider} · Connected{" "}
            {formatMoment(connection.created_at)}
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          {/* A trip to the provider, not through our callback: choosing
              repositories grants no credential, so nothing here waits on a
              return. It is the fix for "the app cannot see that project", and
              so is offered while connected. */}
          {entry.manage_access_url && (
            <Button asChild variant="outline" size="sm">
              <a href={entry.manage_access_url} target="_blank" rel="noreferrer">
                Change repositories
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={isPending} onClick={onDisconnect}>
            Disconnect
          </Button>
        </div>
      </div>
      {/* Shown only when there is no link to offer, so the writer is told why
          the action is missing rather than left to wonder. */}
      {!entry.manage_access_url && (
        <p className="text-xs text-muted-foreground">
          Choosing repositories needs an app slug on the {label} integration, which is not set. An
          administrator configures it under Integrations.
        </p>
      )}
      <p className="text-xs text-muted-foreground">{DISCONNECT_COPY}</p>
    </div>
  );
}

function ConnectRow({ entry }: { entry: ConnectableProvider }) {
  const label = entryLabel(entry);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">
            {entry.display_name} · {GIT_PROVIDERS[entry.provider]?.display_name ?? entry.provider} · Not connected.
          </span>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <a href={connectHref(entry.provider, entry.id)}>Connect</a>
        </Button>
      </div>
      {/* Told before connecting, not after: handing over repository access
          should be a decision, and the repository choice is the part people
          do not expect to have. It now says "then" because the two are
          separate trips — promising one pass would be a lie the provider
          cannot keep. */}
      <p className="text-xs text-muted-foreground">
        You authorize this Registry first, then choose which repositories it may read. It can only read
        them — never write. Connecting is separate from how you sign in, and the account need not be the
        same one.
      </p>
    </div>
  );
}

/**
 * A writer's own Connections: what is connected, as which account, and how to
 * connect or withdraw one (ADR-0024).
 *
 * @remarks
 * One entry per Integration (app), not per Git Provider (ADR-0025), labeled
 * by its app slug — the thing that actually tells two apps for the same
 * provider apart, unlike a display name an Admin need not have kept unique.
 *
 * Not offered to a reader at all — the settings page hides the whole section
 * below `writer`, and the API refuses them anyway. Inviting a reader to grant
 * a credential they could never use would be worse than useless.
 *
 * The card is also absent when nothing is connectable, which is the state of a
 * Registry whose Admin has configured no Integration. There is nothing to
 * connect to, so a Connect button could only fail when pressed.
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
        <h2 className="text-sm font-medium">Connections</h2>
        <p className="text-xs text-muted-foreground">
          A connection lets this Registry read a Skill out of a private repository, as you.
        </p>
      </div>

      {connections.isPending && <ConnectionsSkeleton />}
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

      {connectable.map((entry) => {
        const connection = byIntegrationId.get(entry.id);
        return (
          <Panel key={entry.id}>
            {connection ? (
              <ConnectedRow
                connection={connection}
                entry={entry}
                isPending={disconnect.isPending && disconnect.variables === entry.provider}
                onDisconnect={() => disconnect.mutate(entry.provider)}
              />
            ) : (
              <ConnectRow entry={entry} />
            )}
          </Panel>
        );
      })}
    </div>
  );
}
