import { ResourceSubmissionListSchema, ResourceSubmittedSchema, SkillSchema } from "@in-org-quicko/skillset-shared";
import { createRouter } from "../../lib/factory.js";
import { uuidParam, validate } from "../../lib/validator.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { PublishBodySchema, PublishParamsSchema } from "../resources/resources.schemas.js";
import { SubmissionNotFoundError } from "./submissions.errors.js";

const submissionId = uuidParam("id", () => new SubmissionNotFoundError());

/**
 * `/submissions`: Resources installed from a repository and put forward for
 * the Registry, and an Admin's approval or rejection of them (ADR-0044).
 *
 * @remarks
 * Submitting is open to every signed-in role, reader included, because it
 * publishes nothing. Reviewing is `admin`, the same bar as deleting a Resource:
 * approving puts something in front of the whole team.
 */
export const submissionsRoutes = createRouter()
  .get("/", requireAuth(), requireRole("admin"), async (c) => {
    return c.json(ResourceSubmissionListSchema.parse({ items: await c.var.services.submissions.list() }));
  })
  .put(
    "/:kind/:name",
    requireAuth(),
    validate("param", PublishParamsSchema),
    validate("json", PublishBodySchema),
    async (c) => {
      const result = await c.var.services.submissions.submit(c.var.user, c.req.valid("param").name, c.req.valid("json"));
      return c.json(ResourceSubmittedSchema.parse(result));
    },
  )
  .post("/:id/approve", requireAuth(), requireRole("admin"), submissionId, async (c) => {
    return c.json(SkillSchema.parse(await c.var.services.submissions.approve(c.req.valid("param").id)));
  })
  .delete("/:id", requireAuth(), requireRole("admin"), submissionId, async (c) => {
    await c.var.services.submissions.reject(c.req.valid("param").id);
    return c.body(null, 204);
  });
