import { isUngated, type IdentityProvider } from "@skillset/shared";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { IdentityProviderDialog } from "@/components/identity-provider-dialog";
import { Panel } from "@/components/panel";
import { PROVIDER_ICONS } from "@/components/provider-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TABLE_HEAD_LABEL_CLASS,
} from "@/components/ui/table";
import { useIdentityProviders, useUpdateIdentityProvider } from "@/hooks/use-identity-providers";
import { apiErrorMessage } from "@/lib/api";

// Fixed column widths (with `table-fixed`) so a long provider name or list of
// permitted organisations truncates/wraps within the row instead of
// stretching the table past the Panel and clipping the actions off the edge.
const PROVIDER_COL = `${TABLE_HEAD_LABEL_CLASS} w-[38%]`;
const ORGS_COL = `${TABLE_HEAD_LABEL_CLASS} w-[36%]`;
const ACTIONS_COL = `${TABLE_HEAD_LABEL_CLASS} w-[190px]`;

/** Placeholder provider table while `useIdentityProviders` is in flight. */
function ProvidersTableSkeleton() {
  return (
    <Panel contentClassName="p-0">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={PROVIDER_COL}>Provider</TableHead>
            <TableHead className={ORGS_COL}>Organisations</TableHead>
            <TableHead className={ACTIONS_COL} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 3 }).map((_, index) => (
            <TableRow key={index} className="hover:bg-transparent">
              <TableCell>
                <div className="flex items-center gap-2">
                  <Skeleton className="size-[26px] shrink-0" />
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-28 rounded-full" />
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <Skeleton className="h-7 w-14 rounded-md" />
                  <Skeleton className="h-7 w-16 rounded-md" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

/**
 * An Admin's view of external login: which Identity Providers are configured,
 * and which of them the login page currently offers.
 *
 * @remarks
 * There is no Remove control, and that is deliberate rather than missing.
 * Disabling is how a Provider is taken out of service — deleting one would
 * lock out everyone who signs in through it over a mistyped click, so the API
 * has no delete route to call.
 */
export function IdentityProvidersCard() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IdentityProvider | null>(null);

  const providers = useIdentityProviders();
  const update = useUpdateIdentityProvider();

  function openDialog(provider: IdentityProvider | null) {
    setEditing(provider);
    setDialogOpen(true);
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">OIDC</h2>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Anyone whose account is in one of a Provider&apos;s permitted organisations can sign in, and gets a
            reader account on their first login. Promote them from Users. A Provider with no organisations listed
            admits everyone that provider will authenticate.
          </p>
        </div>
        <Button size="sm" onClick={() => openDialog(null)}>
          <PlusIcon />
          Add Provider
        </Button>
      </div>

      {providers.isError && <p className="text-sm text-destructive">{apiErrorMessage(providers.error)}</p>}
      {update.isError && <p className="text-sm text-destructive">{apiErrorMessage(update.error)}</p>}

      {providers.isPending && <ProvidersTableSkeleton />}

      {providers.isSuccess && providers.data.items.length === 0 && (
        <Panel>
          <p className="text-sm text-muted-foreground">
            No Identity Providers configured. The login page asks for a password only.
          </p>
        </Panel>
      )}

      {providers.isSuccess && providers.data.items.length > 0 && (
        <Panel contentClassName="p-0">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={PROVIDER_COL}>Provider</TableHead>
                <TableHead className={ORGS_COL}>Organisations</TableHead>
                <TableHead className={ACTIONS_COL} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.data.items.map((provider) => {
                const isRowPending = update.isPending && update.variables?.id === provider.id;
                const Icon = PROVIDER_ICONS[provider.kind];
                return (
                  <TableRow key={provider.id} className="hover:bg-transparent">
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className="size-[26px] shrink-0" />
                        <span className="truncate font-medium">{provider.display_name}</span>
                        <Badge variant={provider.enabled ? "default" : "secondary"} className="shrink-0">
                          {provider.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isUngated(provider.permitted_organisations) ? (
                        <span className="text-muted-foreground">
                          {provider.enabled ? "Any" : "None set"}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {provider.permitted_organisations.map((organisation) => (
                            <Badge key={organisation.toLowerCase()} variant="secondary">
                              {organisation}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openDialog(provider)}>
                          Edit
                        </Button>
                        <Button
                          variant={provider.enabled ? "outline" : "default"}
                          size="sm"
                          disabled={isRowPending}
                          onClick={() => update.mutate({ id: provider.id, body: { enabled: !provider.enabled } })}
                        >
                          {provider.enabled ? "Disable" : "Enable"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      )}

      {/* Keyed so switching between "add" and editing a particular Provider
          remounts the form rather than leaving the previous one's values in
          its state. */}
      <IdentityProviderDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        provider={editing}
      />
    </div>
  );
}
