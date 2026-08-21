import { z } from "zod";

/** POST /auth/login. Unknown email and wrong password must fail identically — see the API's timing padding. */
export const LoginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1),
});
export type Login = z.infer<typeof LoginSchema>;
