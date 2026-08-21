import { z } from "zod";
import { RoleSchema } from "./role.js";
import { timestamp } from "./timestamp.js";

/**
 * The User shape carried on the wire (docs/openapi.json's `User` schema).
 * `password_hash` is never part of it — parsing a row through this schema
 * is how a route shapes its response instead of a hand-written serializer.
 */
export const UserSchema = z.object({
  id: z.string(),
  email: z.email(),
  first_name: z.string(),
  last_name: z.string(),
  role: RoleSchema,
  must_change_password: z.boolean(),
  created_at: timestamp,
});
export type User = z.infer<typeof UserSchema>;
