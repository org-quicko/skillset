import { z } from "zod";

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
