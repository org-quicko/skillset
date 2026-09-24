import type { ArtifactFileUpload, ArtifactUpload, ResourceSubmission, SkillPayload } from "@in-org-quicko/skillset-shared";
import type { Database } from "../../db/client.js";
import type { ResourceSubmissionRow, UserRow } from "../../db/tables.js";
import type { Logger } from "../../lib/logger.js";
import {
  ARTIFACT_UPLOAD_CONTENT_TYPE,
  ARTIFACT_UPLOAD_EXPIRY_SECONDS,
  artifactFileKey,
  submissionFileKey,
  submissionPathFromKey,
  submissionPrefix,
} from "../../storage/keys.js";
import type { StorageAdapter } from "../../storage/types.js";
import type { PublishBody } from "../resources/resources.schemas.js";
import { namespaceForSource, type ResourcesService, type SkillDetail } from "../resources/resources.service.js";
import {
  ResourceAlreadyPublishedError,
  SubmissionIncompleteError,
  SubmissionNotFoundError,
  SubmissionSourceRequiredError,
} from "./submissions.errors.js";

function toSubmission(row: ResourceSubmissionRow): ResourceSubmission {
  return {
    id: row.id,
    kind: row.kind,
    namespace: row.namespace,
    name: row.name,
    description: row.description,
    body: row.body ?? "",
    source: row.source,
    allowed_tools: (row.payload as SkillPayload).allowed_tools ?? null,
    submitted_by_email: row.submitted_by_email,
    submitted_by_name: row.submitted_by_name,
    submitted_at: row.updated_at.toISOString(),
  };
}

/**
 * Resource Submissions: Resources installed straight from a repository and put
 * forward for the Registry, which an Admin approves into Resources or rejects
 * (ADR-0044).
 */
export class SubmissionsService {
  constructor(
    private readonly db: Database,
    private readonly storage: StorageAdapter,
    private readonly logger: Logger,
    private readonly resources: ResourcesService,
    private readonly publicUrl: string,
  ) {}

  /**
   * Records a Submission, then returns a presigned URL per declared file to
   * upload its files to.
   *
   * @remarks
   * Open to any signed-in role, a reader included: submitting publishes
   * nothing, and the Admin who approves it is the one vouching for it.
   *
   * Idempotent by `(kind, namespace, name)`, like publishing: submitting the
   * same Resource again replaces the pending Submission and its files, so the
   * latest copy is the one an Admin reviews. The Namespace is derived from
   * `source` exactly as a publish derives it, so an approved Submission lands
   * where a publish of the same Source would have.
   *
   * @param submitter - The authenticated User submitting.
   * @param name - The Skill's name, already held to `validateSkillName`.
   * @param input - The same body a publish takes, already held to the shared
   * Skill rules. `source` is required here.
   * @returns The Submission as stored, and where to upload each file.
   * @throws SubmissionSourceRequiredError if `input.source` is absent.
   * @throws ResourceAlreadyPublishedError if a Resource already exists under
   * the same `(kind, namespace, name)`.
   * @example
   * ```ts
   * const { submission, upload } = await submissions.submit(user, "pdf", {
   *   description: "Reads PDFs.", body: "# pdf\n", source: "https://github.com/acme/skills",
   *   files: [{ path: "SKILL.md", size: 42 }],
   * });
   * ```
   */
  async submit(
    submitter: UserRow,
    name: string,
    input: PublishBody,
  ): Promise<{ submission: ResourceSubmission; upload: ArtifactUpload }> {
    const kind = "skill";
    if (!input.source) throw new SubmissionSourceRequiredError();
    const source = input.source;
    const namespace = namespaceForSource(source, this.publicUrl);

    if (await this.isPublished(kind, namespace, name)) {
      throw new ResourceAlreadyPublishedError(namespace, name);
    }

    const payload: SkillPayload = {
      kind,
      license: input.license ?? null,
      compatibility: input.compatibility ?? null,
      metadata: input.metadata ?? null,
      allowed_tools: input.allowed_tools ?? null,
    };
    const fields = {
      description: input.description,
      body: input.body,
      payload,
      source,
      submitted_by: submitter.id,
      submitted_by_email: submitter.email,
      submitted_by_name: `${submitter.first_name} ${submitter.last_name}`,
    };
    const row = await this.db
      .insertInto("resource_submissions")
      .values({ kind, namespace, name, ...fields })
      .onConflict((oc) => oc.columns(["kind", "namespace", "name"]).doUpdateSet({ ...fields, updated_at: new Date() }))
      .returningAll()
      .executeTakeFirstOrThrow();

    // A resubmission's manifest replaces the last one whole, so nothing the
    // earlier copy uploaded survives to be approved alongside it.
    await this.deleteFiles(row.id);
    const files = await Promise.all(
      input.files.map(async (file): Promise<ArtifactFileUpload> => ({
        path: file.path,
        url: await this.storage.presignUpload(submissionFileKey(row.id, file.path), {
          expiresInSeconds: ARTIFACT_UPLOAD_EXPIRY_SECONDS,
          contentType: ARTIFACT_UPLOAD_CONTENT_TYPE,
        }),
        method: "PUT",
        headers: { "content-type": ARTIFACT_UPLOAD_CONTENT_TYPE },
      })),
    );

    this.logger.info({ submission_id: row.id, user_id: submitter.id, namespace, name }, "resource submitted");
    return {
      submission: toSubmission(row),
      upload: { files, expires_in_seconds: ARTIFACT_UPLOAD_EXPIRY_SECONDS },
    };
  }

  /** Every pending Submission, newest first. */
  async list(): Promise<ResourceSubmission[]> {
    const rows = await this.db.selectFrom("resource_submissions").selectAll().orderBy("updated_at", "desc").execute();
    return rows.map(toSubmission);
  }

  /**
   * Turns a Submission into a Resource, crediting whoever submitted it as the
   * publisher.
   *
   * @remarks
   * Files are copied into the new Resource's own prefix before the
   * Submission's are deleted, and the Submission row goes last — so a failure
   * part-way leaves the Submission in place to approve again, never a
   * Resource with no Submission to explain it and no files either.
   *
   * Refuses rather than overwrites when a Resource of the same identity was
   * published since the Submission was made.
   *
   * @param id - The Submission's id.
   * @returns The Resource as it now reads.
   * @throws SubmissionNotFoundError if no Submission exists by `id`.
   * @throws ResourceAlreadyPublishedError if the Resource is already in the
   * Registry.
   * @throws SubmissionIncompleteError if none of its files were uploaded.
   * @example
   * ```ts
   * const skill = await submissions.approve(id);
   * ```
   */
  async approve(id: string): Promise<SkillDetail> {
    const submission = await this.getRow(id);
    if (await this.isPublished(submission.kind, submission.namespace, submission.name)) {
      throw new ResourceAlreadyPublishedError(submission.namespace, submission.name);
    }

    const objects = await this.storage.list(submissionPrefix(id));
    if (objects.length === 0) throw new SubmissionIncompleteError();

    const { id: resourceId } = await this.db
      .insertInto("resources")
      .values({
        kind: submission.kind,
        namespace: submission.namespace,
        name: submission.name,
        description: submission.description,
        body: submission.body,
        payload: submission.payload,
        source: submission.source,
        published_by: submission.submitted_by,
        published_by_email: submission.submitted_by_email,
        published_by_name: submission.submitted_by_name,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    for (const object of objects) {
      const path = submissionPathFromKey(id, object.key);
      const bytes = await this.storage.get(object.key);
      if (path === null || bytes === null) continue;
      await this.storage.put(artifactFileKey(resourceId, path), bytes, ARTIFACT_UPLOAD_CONTENT_TYPE);
    }
    await this.deleteFiles(id);
    await this.db.deleteFrom("resource_submissions").where("id", "=", id).execute();

    this.logger.info({ submission_id: id, resource_id: resourceId }, "submission approved");
    return this.resources.get(resourceId);
  }

  /**
   * Discards a Submission and its files.
   *
   * @param id - The Submission's id.
   * @throws SubmissionNotFoundError if no Submission exists by `id`.
   */
  async reject(id: string): Promise<void> {
    await this.getRow(id);
    await this.deleteFiles(id);
    await this.db.deleteFrom("resource_submissions").where("id", "=", id).execute();
    this.logger.info({ submission_id: id }, "submission rejected");
  }

  private async getRow(id: string): Promise<ResourceSubmissionRow> {
    const row = await this.db.selectFrom("resource_submissions").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw new SubmissionNotFoundError();
    return row;
  }

  private async isPublished(kind: string, namespace: string, name: string): Promise<boolean> {
    const row = await this.db
      .selectFrom("resources")
      .select("id")
      .where("kind", "=", kind)
      .where("namespace", "=", namespace)
      .where("name", "=", name)
      .executeTakeFirst();
    return row !== undefined;
  }

  private async deleteFiles(id: string): Promise<void> {
    const objects = await this.storage.list(submissionPrefix(id));
    await Promise.all(objects.map((object) => this.storage.delete(object.key)));
  }
}
