import type { ResourceSubmission } from "@in-org-quicko/skillset-shared";
import { CheckIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApproveSubmission, useRejectSubmission, useSubmissions } from "@/hooks/use-submissions";
import { apiErrorMessage } from "@/lib/api";
import { formatDate } from "@/lib/utils";

/**
 * One pending Submission: what it is, where it came from, who put it forward,
 * and the two decisions an Admin can make on it.
 *
 * @remarks
 * Rejecting asks once more before it acts, because it discards the files with
 * no way back; approving does not, because an approved Resource can still be
 * deleted like any other.
 */
function SubmissionTile({ submission }: { submission: ResourceSubmission }) {
  const approve = useApproveSubmission();
  const reject = useRejectSubmission();
  const [confirmingReject, setConfirmingReject] = useState(false);
  const busy = approve.isPending || reject.isPending;

  function handleApprove() {
    approve.mutate(submission.id, {
      onSuccess: () => toast.success(`Approved "${submission.name}" into the Registry.`),
      onError: (error) => toast.error(`Couldn't approve "${submission.name}": ${apiErrorMessage(error)}`),
    });
  }

  function handleReject() {
    reject.mutate(submission.id, {
      onSuccess: () => toast.success(`Rejected "${submission.name}".`),
      onError: (error) => toast.error(`Couldn't reject "${submission.name}": ${apiErrorMessage(error)}`),
    });
  }

  return (
    <Panel className="bg-transparent">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-medium">
            {submission.name} <span className="font-normal text-muted-foreground">{submission.namespace}</span>
          </span>
          <a
            href={submission.source}
            target="_blank"
            rel="noreferrer noopener"
            className="truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {submission.source}
          </a>
          <span className="text-xs text-muted-foreground">
            Submitted by {submission.submitted_by_name} ({submission.submitted_by_email}) on{" "}
            {formatDate(submission.submitted_at)}
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          {confirmingReject ? (
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmingReject(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={handleReject}>
                Discard it
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmingReject(true)}>
                <XIcon />
                Reject
              </Button>
              <Button size="sm" disabled={busy} onClick={handleApprove}>
                <CheckIcon />
                Approve
              </Button>
            </>
          )}
        </div>
      </div>

      <p className="mt-3 text-sm">{submission.description}</p>
      {submission.allowed_tools && (
        <p className="mt-2 text-xs">
          <span className="text-amber-600 dark:text-amber-400">Tool access</span>{" "}
          <span className="text-muted-foreground">{submission.allowed_tools}</span>
        </p>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground">SKILL.md</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
          {submission.body}
        </pre>
      </details>
    </Panel>
  );
}

/**
 * An Admin's queue of Resources installed straight from a repository and put
 * forward for the Registry (ADR-0044). Approving one makes it a Resource,
 * credited to whoever submitted it; rejecting discards it.
 */
export function SubmissionsCard() {
  const submissions = useSubmissions();
  const pending = submissions.data?.items ?? [];

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Submissions</h2>
        <p className="max-w-2xl text-xs text-muted-foreground">
          Skills your team installed from a repository with <code>skillset install &lt;url&gt;</code>, waiting for
          you to add them to the Registry.
        </p>
      </div>

      {submissions.isError && <p className="text-sm text-destructive">{apiErrorMessage(submissions.error)}</p>}

      {submissions.isPending && (
        <Panel className="bg-transparent">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-1.5 h-3 w-64" />
        </Panel>
      )}

      {submissions.isSuccess && pending.length === 0 && (
        <Panel className="bg-transparent">
          <p className="text-sm text-muted-foreground">Nothing waiting for approval.</p>
        </Panel>
      )}

      {pending.map((submission) => (
        <SubmissionTile key={submission.id} submission={submission} />
      ))}
    </div>
  );
}
