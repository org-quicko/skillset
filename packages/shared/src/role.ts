import { z } from "zod";

/**
 * reader: browse/search/read/retrieve. writer: also publish. admin: also
 * delete Skills and manage readers and writers. superadmin: also manage
 * Admins and other Superadmins.
 */
export const RoleSchema = z.enum(["reader", "writer", "admin", "superadmin"]);
export type Role = z.infer<typeof RoleSchema>;

/**
 * The roles a request body may assign to a User. `superadmin` is excluded on
 * purpose: it is set exactly once, by `/setup`, and no route ever grants,
 * changes, or removes it afterwards.
 */
export const AssignableRoleSchema = RoleSchema.exclude(["superadmin"]);
export type AssignableRole = z.infer<typeof AssignableRoleSchema>;

/** The roles a role picker offers, in the order they should list — the single source both the create-User and role-change UI iterate. */
export const ASSIGNABLE_ROLES = AssignableRoleSchema.options;

// Roles are cumulative: writer can do everything a reader can, admin
// everything a writer can, and so on. Rank order, not an allowlist, so a new
// top role is automatically included by every check against a minimum
// without having to be added to each one.
const ROLE_RANK: Record<Role, number> = { reader: 0, writer: 1, admin: 2, superadmin: 3 };

/** Whether `role` meets or exceeds `minimum` in the cumulative rank above. */
export function roleMeets(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
