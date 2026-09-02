import type { Connection } from "@skill-registry/shared";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { connectHref, useConnections, useDisconnect } from "@/hooks/use-connections";
import { apiErrorMessage } from "@/lib/api";
import { formatMoment } from "@/lib/utils";

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

function ConnectedRow({
  connection,
  displayName,
  manageAccessUrl,
  onDisconnect,
  isPending,
}: {
  connection: Connection;
  displayName: string;
  manageAccessUrl: string | null;
  onDisconnect: () => void;
  isPending: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-medium">
            {displayName} · {connection.external_account_login}
          </span>
          <span className="text-xs text-muted-foreground">
            Connected {formatMoment(connection.created_at)}
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          {/* A trip to the provider, not through our callback: choosing
              repositories grants no credential, so nothing here waits on a
              return. It is the fix for "the app cannot see that project", and
              so is offered while connected. */}
          {manageAccessUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={manageAccessUrl} target="_blank" rel="noreferrer">
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
      {!manageAccessUrl && (
        <p className="text-xs text-muted-foreground">
          Choosing repositories needs an app slug on the {displayName} integration, which is not set. An
          administrator configures it under Integrations.
        </p>
      )}
      <p className="text-xs text-muted-foreground">{DISCONNECT_COPY}</p>
    </div>
  );
}

function ConnectRow({ provider, displayName }: { provider: string; displayName: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{displayName}</span>
          <span className="text-xs text-muted-foreground">Not connected.</span>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <a href={connectHref(provider)}>Connect {displayName}</a>
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

  const byProvider = new Map(connections.data?.items.map((item) => [item.provider, item]));
  const connectable = connections.data?.connectable ?? [];

  return (
    <div className="flex max-w-xl flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Connections</h2>
        <p className="text-xs text-muted-foreground">
          A connection lets this Registry read a Skill out of a private repository, as you.
        </p>
      </div>

      {connections.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
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

      {connectable.map(({ provider, display_name, manage_access_url }) => {
        const connection = byProvider.get(provider);
        return (
          <Panel key={provider}>
            {connection ? (
              <ConnectedRow
                connection={connection}
                displayName={display_name}
                manageAccessUrl={manage_access_url}
                isPending={disconnect.isPending && disconnect.variables === provider}
                onDisconnect={() => disconnect.mutate(provider)}
              />
            ) : (
              <ConnectRow provider={provider} displayName={display_name} />
            )}
          </Panel>
        );
      })}
    </div>
  );
}
