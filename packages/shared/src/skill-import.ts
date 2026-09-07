import { z } from "zod";
import { SkillSourceLocationSchema } from "./skill-source.js";

/**
 * One fetched file, on the wire.
 *
 * @remarks
 * Base64 only because bytes have to cross JSON to reach the browser. The
 * service and the shared walk both deal in `SkillFile`, the same shape a
 * dropped folder produces; the encoding belongs at the wire and nowhere else.
 */
export const SkillFileWireSchema = z.object({
  path: z.string(),
  content_base64: z.string(),
});
export type SkillFileWire = z.infer<typeof SkillFileWireSchema>;

/** `POST /imports/\{provider\}/skill-files` response — the folder's files, ready to publish. */
export const SkillFilesSchema = z.object({
  items: z.array(SkillFileWireSchema),
});
export type SkillFiles = z.infer<typeof SkillFilesSchema>;

/**
 * `POST /imports/\{provider\}/skills` response — every Skill folder a
 * discovery walk found under a location, each ready to hand straight back as
 * that same route's next `skill-files` request.
 */
export const SkillSourcesSchema = z.object({
  items: z.array(SkillSourceLocationSchema),
});
export type SkillSources = z.infer<typeof SkillSourcesSchema>;
