import { ASSIGNABLE_ROLES, type AssignableRole, type User } from "@skill-registry/shared";
import { useEffect, useState } from "react";
import { CreateUserDialog } from "@/components/create-user-dialog";
import { RemoveUserDialog } from "@/components/remove-user-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useUpdateUserRole, useUsers } from "@/hooks/use-users";
import { apiErrorMessage } from "@/lib/api";

/**
 * An Admin's view of every User (ticket 11): create, promote, demote, and
 * remove. The Superadmin's row has no controls — their role is permanent
 * and their account can never be changed or removed (docs/data-model.md).
 * The caller's own row has no controls either — the API refuses a User
 * changing their own role or removing themselves through this route, so
 * there is nothing here for it to do but confuse them with a 400.
 */
export function UsersCard({ currentUserId }: { currentUserId: string }) {
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<User | null>(null);

  const users = useUsers(page);
  const updateRole = useUpdateUserRole();
  const totalPages = users.data ? Math.max(1, Math.ceil(users.data.total / users.data.page_size)) : 1;

  // Removing the last User on a page shrinks `total` out from under the
  // page the admin is still viewing — without this, they'd be stranded on
  // an empty page with the Previous/Next controls gone (both gated on
  // totalPages > 1).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>Create, promote, demote, and remove Users.</CardDescription>
        <CardAction>
          <Button onClick={() => setCreateOpen(true)}>Add User</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {users.isError && <p className="text-sm text-destructive">{apiErrorMessage(users.error)}</p>}
        {users.isSuccess && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.items.map((user) => {
                const isProtected = user.role === "superadmin" || user.id === currentUserId;
                const isRowPending = updateRole.isPending && updateRole.variables?.userId === user.id;
                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.first_name} {user.last_name}
                      {user.id === currentUserId && <span className="text-muted-foreground"> (you)</span>}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      {isProtected ? (
                        <span className="text-sm text-muted-foreground capitalize">{user.role}</span>
                      ) : (
                        <Select
                          value={user.role}
                          onValueChange={(role) =>
                            updateRole.mutate({ userId: user.id, role: role as AssignableRole })
                          }
                          disabled={isRowPending}
                        >
                          <SelectTrigger size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ASSIGNABLE_ROLES.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      {!isProtected && (
                        <Button variant="outline" size="sm" onClick={() => setRemoveTarget(user)}>
                          Remove
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {updateRole.isError && <p className="text-sm text-destructive">{apiErrorMessage(updateRole.error)}</p>}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </CardContent>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      {removeTarget && (
        <RemoveUserDialog
          userId={removeTarget.id}
          name={`${removeTarget.first_name} ${removeTarget.last_name}`}
          open
          onOpenChange={(next) => {
            if (!next) setRemoveTarget(null);
          }}
        />
      )}
    </Card>
  );
}
