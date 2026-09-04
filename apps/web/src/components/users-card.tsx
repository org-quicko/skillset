import {
  ASSIGNABLE_ROLES,
  type AssignableRole,
  type User,
  type UserListItem,
} from "@skill-registry/shared";
import { PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { CreateUserDialog } from "@/components/create-user-dialog";
import { Panel } from "@/components/panel";
import { RemoveUserDialog } from "@/components/remove-user-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useUpdateUserRole, useUsers } from "@/hooks/use-users";
import { apiErrorMessage } from "@/lib/api";

const HEAD_CLASS = "text-xs font-normal tracking-[0.08em] text-muted-foreground";

/** Placeholder user table while `useUsers` is in flight. */
function UsersTableSkeleton() {
  return (
    <Panel contentClassName="p-0">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD_CLASS}>Name</TableHead>
            <TableHead className={HEAD_CLASS}>Email</TableHead>
            <TableHead className={HEAD_CLASS}>Role</TableHead>
            <TableHead className={HEAD_CLASS}>Connections</TableHead>
            <TableHead className={HEAD_CLASS} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 4 }).map((_, index) => (
            <TableRow key={index} className="hover:bg-transparent">
              <TableCell>
                <div className="flex items-center gap-2">
                  <Skeleton className="size-[26px] rounded-full" />
                  <Skeleton className="h-3.5 w-28" />
                </div>
              </TableCell>
              <TableCell>
                <Skeleton className="h-3.5 w-40" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-7 w-24 rounded-md" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-3.5 w-10" />
              </TableCell>
              <TableCell />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

function initials(user: User): string {
  return `${user.first_name[0] ?? ""}${user.last_name[0] ?? ""}`.toUpperCase();
}

/**
 * Which Git Providers this User has granted repository access to.
 *
 * @remarks
 * Here so an Admin can answer "who has granted this Registry access to our
 * repositories" without opening a database client (ADR-0024). The provider
 * name and nothing else — not the connected account, and certainly not a
 * token: an Admin needs to know a grant exists so they can ask about it.
 *
 * A reader can hold none, so an em dash is the common and correct answer.
 */
function ConnectionCell({ user }: { user: UserListItem }) {
  if (user.connected_providers.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {user.connected_providers.map((provider) => (
        <span
          key={provider}
          className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground capitalize"
        >
          {provider}
        </span>
      ))}
    </div>
  );
}

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
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Users</h2>
          <p className="max-w-xl text-xs text-muted-foreground">Create, promote, demote, and remove Users.</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon />
          Add User
        </Button>
      </div>

      {users.isError && <p className="text-sm text-destructive">{apiErrorMessage(users.error)}</p>}
      {updateRole.isError && <p className="text-sm text-destructive">{apiErrorMessage(updateRole.error)}</p>}

      {users.isPending && <UsersTableSkeleton />}

      {users.isSuccess && (
        <Panel contentClassName="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={HEAD_CLASS}>Name</TableHead>
                <TableHead className={HEAD_CLASS}>Email</TableHead>
                <TableHead className={HEAD_CLASS}>Role</TableHead>
                <TableHead className={HEAD_CLASS}>Connections</TableHead>
                <TableHead className={HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.items.map((user) => {
                const isProtected = user.role === "superadmin" || user.id === currentUserId;
                const isRowPending = updateRole.isPending && updateRole.variables?.userId === user.id;
                return (
                  <TableRow key={user.id} className="hover:bg-transparent">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Avatar className="size-[26px]">
                          <AvatarFallback className="text-[11px]">{initials(user)}</AvatarFallback>
                        </Avatar>
                        <span>
                          {user.first_name} {user.last_name}
                          {user.id === currentUserId && (
                            <span className="font-normal text-muted-foreground"> (you)</span>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
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
                          <SelectTrigger size="sm" className="capitalize">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ASSIGNABLE_ROLES.map((option) => (
                              <SelectItem key={option} value={option} className="capitalize">
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      <ConnectionCell user={user} />
                    </TableCell>
                    <TableCell className="text-right">
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
        </Panel>
      )}

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
    </div>
  );
}
