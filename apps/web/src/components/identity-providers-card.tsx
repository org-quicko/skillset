import { IDENTITY_PROVIDER_GUIDANCE, isUngated, type IdentityProvider } from "@skill-registry/shared";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { IdentityProviderDialog } from "@/components/identity-provider-dialog";
import { Panel } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIdentityProviders, useUpdateIdentityProvider } from "@/hooks/use-identity-providers";
import { apiErrorMessage } from "@/lib/api";

const HEAD_CLASS = "text-xs font-normal tracking-[0.08em] text-muted-foreground";

/** Placeholder provider table while `useIdentityProviders` is in flight. */
function ProvidersTableSkeleton() {
  return (
    <Panel contentClassName="p-0">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD_CLASS}>Provider</TableHead>
            <TableHead className={HEAD_CLASS}>Kind</TableHead>
            <TableHead className={HEAD_CLASS}>Permitted organisations</TableHead>
            <TableHead className={HEAD_CLASS}>Status</TableHead>
            <TableHead className={HEAD_CLASS} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 3 }).map((_, index) => (
            <TableRow key={index} className="hover:bg-transparent">
              <TableCell>
                <Skeleton className="h-3.5 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-3.5 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-28 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-24 rounded-full" />
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
          <h2 className="text-sm font-medium">External login</h2>
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
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={HEAD_CLASS}>Provider</TableHead>
                <TableHead className={HEAD_CLASS}>Kind</TableHead>
                <TableHead className={HEAD_CLASS}>Permitted organisations</TableHead>
                <TableHead className={HEAD_CLASS}>Status</TableHead>
                <TableHead className={HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.data.items.map((provider) => {
                const isRowPending = update.isPending && update.variables?.id === provider.id;
                return (
                  <TableRow key={provider.id} className="hover:bg-transparent">
                    <TableCell className="font-medium">{provider.display_name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {IDENTITY_PROVIDER_GUIDANCE[provider.kind].label}
                    </TableCell>
                    <TableCell>
                      {isUngated(provider.permitted_organisations) ? (
                        // An enabled Provider with no gate is the one row state
                        // worth an alarm: it admits everyone, and it looks
                        // identical to a half-finished one unless it says so.
                        <span
                          className={
                            provider.enabled ? "font-medium text-destructive" : "text-muted-foreground"
                          }
                        >
                          {provider.enabled ? "Anyone — no check" : "None set"}
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
                      <Badge variant={provider.enabled ? "default" : "secondary"}>
                        {provider.enabled ? "On the login page" : "Disabled"}
                      </Badge>
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
