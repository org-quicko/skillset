import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "./user.js";

/** GET /setup — whether the bootstrap screen or the login screen should show. */
export const SetupStateSchema = z.object({
  initialized: z.boolean(),
});
export type SetupState = z.infer<typeof SetupStateSchema>;

/** POST /setup — creates the first (Superadmin) User. Available only while none exist. */
export const SetupInitSchema = z.object({
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  email: z.email().toLowerCase(),
  password: z.string().min(PASSWORD_MIN_LENGTH),
});
export type SetupInit = z.infer<typeof SetupInitSchema>;
