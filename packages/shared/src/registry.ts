import { z } from "zod";

/** GET /registry — whether the bootstrap screen or the login screen should show. */
export const RegistryStateSchema = z.object({
  initialized: z.boolean(),
});
export type RegistryState = z.infer<typeof RegistryStateSchema>;

/** POST /registry — creates the first (Admin) User. Available only while none exist. */
export const RegistryInitSchema = z.object({
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  email: z.email().toLowerCase(),
  password: z.string().min(12),
});
export type RegistryInit = z.infer<typeof RegistryInitSchema>;
