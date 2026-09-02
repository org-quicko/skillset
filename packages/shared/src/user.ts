import { z } from "zod";
import { AssignableRoleSchema, RoleSchema } from "./role.js";
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

/** The floor every password — signup's and a replacement's alike — must meet. */
export const PASSWORD_MIN_LENGTH = 12;

/** Users are listed 50 to a page, most recently created first. */
export const USER_PAGE_SIZE = 50;

/**
 * A User as the Admin's list reports them: everything `UserSchema` carries,
 * plus which Git Providers they hold a Connection to.
 *
 * @remarks
 * Deliberately a separate shape rather than a field on `UserSchema`. A
 * Connection is not part of being a User, and `/users/me` has no business
 * carrying one — an empty array there would read as "not connected" for a
 * writer who is, which is worse than not saying.
 *
 * Provider names, not a boolean, because *which* provider is the useful half.
 * Never a token, and never the connected account's login: an Admin needs to
 * know a grant exists so they can ask about it, not to read the credential
 * (ADR-0024).
 */
export const UserListItemSchema = UserSchema.extend({
  connected_providers: z.array(z.string()),
});
export type UserListItem = z.infer<typeof UserListItemSchema>;

/** GET /users response. */
export const UserPageSchema = z.object({
  items: z.array(UserListItemSchema),
  page: z.number().int(),
  page_size: z.literal(USER_PAGE_SIZE),
  total: z.number().int(),
});
export type UserPage = z.infer<typeof UserPageSchema>;

/** POST /users request body. `role` excludes superadmin — set only by `/setup`. */
export const UserCreateSchema = z.object({
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  email: z.email().toLowerCase(),
  role: AssignableRoleSchema,
});
export type UserCreate = z.infer<typeof UserCreateSchema>;

/** POST /users response. `initial_password` is shown once and is not recoverable. */
export const UserCreatedSchema = z.object({
  user: UserSchema,
  initial_password: z.string(),
});
export type UserCreated = z.infer<typeof UserCreatedSchema>;

/** PATCH /users/me request body. */
export const UserUpdateNameSchema = z
  .object({
    first_name: z.string().trim().min(1).optional(),
    last_name: z.string().trim().min(1).optional(),
  })
  .refine((value) => value.first_name !== undefined || value.last_name !== undefined, {
    message: "first_name or last_name is required.",
  });
export type UserUpdateName = z.infer<typeof UserUpdateNameSchema>;

/** PATCH /users/\{user_id\} request body. */
export const UserRoleUpdateSchema = z.object({
  role: AssignableRoleSchema,
});
export type UserRoleUpdate = z.infer<typeof UserRoleUpdateSchema>;

/** PUT /users/me/password request body. */
export const PasswordReplaceSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(PASSWORD_MIN_LENGTH),
});
export type PasswordReplace = z.infer<typeof PasswordReplaceSchema>;
