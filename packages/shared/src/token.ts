import { z } from "zod";
import { timestamp } from "./timestamp.js";

/**
 * The Token shape carried on the wire (docs/openapi.json's `Token` schema).
 * `token_hash` and the secret are never part of it — a Token is listed by
 * its display name and usage times only.
 */
export const TokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: timestamp,
  last_used_at: timestamp.nullable(),
});
export type Token = z.infer<typeof TokenSchema>;

/** POST /users/me/tokens response. `secret` is shown exactly once and never appears again. */
export const TokenCreatedSchema = TokenSchema.extend({
  secret: z.string(),
});
export type TokenCreated = z.infer<typeof TokenCreatedSchema>;

/** POST /users/me/tokens request body. */
export const TokenMintSchema = z.object({
  name: z.string().trim().min(1),
});
export type TokenMint = z.infer<typeof TokenMintSchema>;
