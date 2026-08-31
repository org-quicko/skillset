import { IDENTITY_PROVIDER_GUIDANCE, isUngated, type IdentityProvider } from "@skill-registry/shared";
import { useState } from "react";
import { IdentityProviderDialog } from "@/components/identity-provider-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIdentityProviders, useUpdateIdentityProvider } from "@/hooks/use-identity-providers";
import { apiErrorMessage } from "@/lib/api";

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
    <Card className="w-full max-w-4xl">
      <CardHeader>
        <CardTitle>External login</CardTitle>
        <CardDescription>
          Anyone whose account is in one of a Provider’s permitted organisations can sign in, and gets a reader
          account on their first login. Promote them from Users. A Provider with no organisations listed admits
          everyone that provider will authenticate.
        </CardDescription>
        <CardAction>
          <Button onClick={() => openDialog(null)}>Add Provider</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {providers.isError && <p className="text-sm text-destructive">{apiErrorMessage(providers.error)}</p>}
        {update.isError && <p className="text-sm text-destructive">{apiErrorMessage(update.error)}</p>}

        {providers.isSuccess && providers.data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No Identity Providers configured. The login page asks for a password only.
          </p>
        )}

        {providers.isSuccess && providers.data.items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Permitted organisations</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.data.items.map((provider) => {
                const isRowPending = update.isPending && update.variables?.id === provider.id;
                return (
                  <TableRow key={provider.id}>
                    <TableCell>
                      <span className="font-medium">{provider.display_name}</span>
                    </TableCell>
                    <TableCell>{IDENTITY_PROVIDER_GUIDANCE[provider.kind].label}</TableCell>
                    <TableCell>
                      {isUngated(provider.permitted_organisations) ? (
                        // An enabled Provider with no gate is the one row state
                        // worth an alarm: it admits everyone, and it looks
                        // identical to a half-finished one unless it says so.
                        <span className={provider.enabled ? "font-medium text-destructive" : "text-muted-foreground"}>
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
                    <TableCell className="flex justify-end gap-2">
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
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Keyed so switching between "add" and editing a particular Provider
          remounts the form rather than leaving the previous one's values in
          its state. */}
      <IdentityProviderDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        provider={editing}
      />
    </Card>
  );
}
