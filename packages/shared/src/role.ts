import { z } from "zod";

/**
 * reader: browse/search/read/retrieve. writer: also publish. admin: also
 * delete Skills and manage readers and writers. superadmin: also manage
 * Admins and other Superadmins.
 */
export const RoleSchema = z.enum(["reader", "writer", "admin", "superadmin"]);
export type Role = z.infer<typeof RoleSchema>;

// Roles are cumulative: writer can do everything a reader can, admin
// everything a writer can, and so on. Rank order, not an allowlist, so a new
// top role is automatically included by every check against a minimum
// without having to be added to each one.
const ROLE_RANK: Record<Role, number> = { reader: 0, writer: 1, admin: 2, superadmin: 3 };

/** Whether `role` meets or exceeds `minimum` in the cumulative rank above. */
export function roleMeets(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
