import { z } from "zod";
import { ArtifactUploadSchema, SkillNameSchema } from "./skill.js";
import { SKILL_DESCRIPTION_MAX_LENGTH } from "./skill-rules.js";
import { timestamp } from "./timestamp.js";

/**
 * A Resource someone installed straight from a repository and put forward for
 * the Registry, waiting on an Admin to approve or reject it (ADR-0044).
 *
 * @remarks
 * Not a Resource: nothing reads, searches, or installs a Submission through the
 * catalog. Approving one is what turns it into a Resource, under the same
 * `(kind, namespace, name)` it was submitted as.
 */
export const ResourceSubmissionSchema = z.object({
  id: z.string(),
  kind: z.string(),
  namespace: z.string(),
  name: SkillNameSchema,
  description: z.string().max(SKILL_DESCRIPTION_MAX_LENGTH),
  body: z.string(),
  // Always a repository URL: a Submission exists because the bytes came from
  // somewhere other than this Registry.
  source: z.string(),
  allowed_tools: z.string().nullable(),
  submitted_by_email: z.email(),
  submitted_by_name: z.string(),
  submitted_at: timestamp,
});
export type ResourceSubmission = z.infer<typeof ResourceSubmissionSchema>;

/** `GET /submissions`: every pending Submission, newest first. */
export const ResourceSubmissionListSchema = z.object({
  items: z.array(ResourceSubmissionSchema),
});
export type ResourceSubmissionList = z.infer<typeof ResourceSubmissionListSchema>;

/** `PUT /submissions/{kind}/{name}`'s response: the Submission as stored, and where to write its files. */
export const ResourceSubmittedSchema = z.object({
  submission: ResourceSubmissionSchema,
  upload: ArtifactUploadSchema,
});
export type ResourceSubmitted = z.infer<typeof ResourceSubmittedSchema>;
