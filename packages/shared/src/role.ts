import { z } from "zod";

/**
 * reader: browse/search/read/retrieve. writer: also publish. admin: also
 * delete Skills and manage readers and writers. superadmin: also manage
 * Admins and other Superadmins.
 */
export const RoleSchema = z.enum(["reader", "writer", "admin", "superadmin"]);
export type Role = z.infer<typeof RoleSchema>;
