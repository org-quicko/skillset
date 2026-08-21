import { z } from "zod";

/** reader: browse/search/read/retrieve. writer: also publish. admin: also delete Skills and manage Users. */
export const RoleSchema = z.enum(["reader", "writer", "admin"]);
export type Role = z.infer<typeof RoleSchema>;
