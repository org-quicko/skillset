import { z } from "zod";

/** The shape every non-2xx response takes (docs/openapi.json's `Error` schema). */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    field: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
