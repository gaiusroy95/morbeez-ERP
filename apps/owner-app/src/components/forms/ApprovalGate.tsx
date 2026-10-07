"use client";

import { useState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import type { ApprovalRequestRecord } from "@morbeez/shared-types";
import { apiSend } from "@/lib/api/client";
import { KEYS, useAction } from "@/lib/hooks/use-action";
import { useApprovalRequest } from "@/lib/hooks/use-modules";
import { useSession } from "@/lib/hooks/use-tenant";
import { formatDateTime, formatMoney } from "@/lib/format";
import { ErrorState, SkeletonLines } from "@/components/ui/Panel";
import { ActionBar, Field, FormDialog } from "@/components/ui/Form";
import { useT } from "@/lib/i18n";

/**
 * An order or purchase order over its approval threshold waits here.
 * Anyone may press Approve or Reject; the backend decides whether this
 * person's role limit (or a delegation) covers the amount, and refuses
 * with a clear message if not — so the buttons aren't hidden by guesswork.
 * Once decided, "finalize" applies the decision: confirm if approved,
 * cancel if rejected.
 */
export function ApprovalGate({
  requestId,
  subject,
  currency,
  timeZone,
  canFinalize,
  finalizePath,
  invalidates,
}: {
  requestId: string;
  subject: string;
  currency: string;
  timeZone: string;
  canFinalize: boolean;
  finalizePath: string;
  invalidates: QueryKey[];
}) {
  const t = useT();
  const { data, error, isPending, refetch } = useApprovalRequest(requestId);
  const { data: session } = useSession();
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");

  const all = [...invalidates, KEYS.approvals, KEYS.dashboard];
  const decide = useAction(
    ({
      approve,
      request,
    }: {
      approve: boolean;
      request: ApprovalRequestRecord;
    }) =>
      apiSend<ApprovalRequestRecord>(
        "POST",
        `approval-requests/${request.id}/${approve ? "approve" : "reject"}`,
        {
          version: request.version,
          note: note.trim() || undefined,
        },
      ),
    all,
    () => setDeciding(null),
  );
  const finalize = useAction(() => apiSend("POST", finalizePath), all);

  if (isPending) return <SkeletonLines lines={2} />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const amount = data.amount
    ? formatMoney(data.amount, currency)
    : "this amount";
  return (
    <div
      className="action-note"
      data-tone={
        data.status === "rejected"
          ? "bad"
          : data.status === "approved"
            ? "info"
            : undefined
      }
    >
      {data.status === "pending" && (
        <>
          <strong>{t("Needs approval.")}</strong> {t("This")} {subject} (
          {amount}) is over the approval threshold. Raised{" "}
          {formatDateTime(data.createdAt, timeZone)}.
          {/* Nobody decides their own request — the backend refuses it too. */}
          {session?.userId === data.requestedBy ? (
            <p style={{ margin: "8px 0 0" }}>
              {t("You raised it, so someone else whose approval limit covers")}{" "}
              {amount} has to decide it. Once they have, finalize it here.
            </p>
          ) : (
            <ActionBar>
              <button
                type="button"
                className="button button-primary"
                onClick={() => setDeciding("approve")}
              >
                {t('Approve')}
              </button>
              <button
                type="button"
                className="button button-danger"
                onClick={() => setDeciding("reject")}
              >
                {t('Reject')}
              </button>
            </ActionBar>
          )}
        </>
      )}
      {data.status !== "pending" && (
        <>
          <strong>
            {data.status === "approved"
              ? "Approved"
              : data.status === "rejected"
                ? "Rejected"
                : "Withdrawn"}
          </strong>{" "}
          {formatDateTime(data.decidedAt, timeZone)}
          {data.decisionNote && <> — “{data.decisionNote}”</>}.{" "}
          {data.status === "approved"
            ? `Finalize to confirm the ${subject}.`
            : `Finalize to close the ${subject} as cancelled.`}
          {canFinalize && (
            <ActionBar>
              <button
                type="button"
                className={
                  data.status === "approved"
                    ? "button button-primary"
                    : "button button-danger"
                }
                disabled={finalize.isPending}
                onClick={() => finalize.mutate(undefined)}
              >
                {finalize.isPending
                  ? "Saving…"
                  : data.status === "approved"
                    ? `Confirm ${subject}`
                    : `Cancel ${subject}`}
              </button>
            </ActionBar>
          )}
          {finalize.error ? (
            <p className="form-error" role="alert" style={{ marginTop: 10 }}>
              {(finalize.error as Error).message}
            </p>
          ) : null}
        </>
      )}
      {deciding && (
        <FormDialog
          title={
            deciding === "approve"
              ? `Approve this ${subject}?`
              : `Reject this ${subject}?`
          }
          description={
            <p>
              {t("Amount:")} {amount}. Your decision is recorded with your name.
            </p>
          }
          submitLabel={deciding === "approve" ? "Approve" : "Reject"}
          tone={deciding === "reject" ? "danger" : undefined}
          pending={decide.isPending}
          error={decide.error}
          onClose={() => {
            setDeciding(null);
            decide.reset();
          }}
          onSubmit={() =>
            decide.mutate({ approve: deciding === "approve", request: data })
          }
        >
          <Field label={t("Note (optional)")} wide>
            {(props) => (
              <textarea
                {...props}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
        </FormDialog>
      )}
    </div>
  );
}
