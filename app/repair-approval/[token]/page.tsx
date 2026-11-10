"use client";
import { useRef, useState } from "react";
import { useParams } from "next/navigation";
import { formatMoney } from "@/lib/api";
import {
  DECISION_RESULT,
  deviceName,
  hasAmount,
  isRepairApprovalPayload,
  REASON_MAX,
  RepairApproval,
  RepairDecision,
} from "@/lib/repairApproval";
import { Modal } from "@/app/components/rental/Modal";
import {
  ApprovalShell,
  ApprovalStates,
  BusyLabel,
  ConsentCheckbox,
  Fact,
  fmtDateTime,
  ReasonField,
  StatusBanner,
  useTokenApproval,
} from "@/app/components/approval/shared";

/*
 * Customer review page for ONE repair estimate: the immutable estimate
 * snapshot behind the token in the URL, from
 * GET /api/public/repair-approvals/<token>/ (repairs.views.RepairApprovalPublicView).
 * Decisions are "approve" (consent required) and "reject" (optional reason);
 * repair estimates have no request-changes step.
 */

const NOUN = "repair estimate";

export default function RepairApprovalPage() {
  const params = useParams<{ token: string }>();
  const token = decodeURIComponent(params.token || "");
  const { view, load, decide, submitting, actionError, setActionError, notice, bannerRef } = useTokenApproval<
    RepairApproval,
    RepairDecision
  >({ token, basePath: "/public/repair-approvals/", isPayload: isRepairApprovalPayload, expected: DECISION_RESULT, noun: NOUN });
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [dialog, setDialog] = useState<null | "reject">(null);
  const [rejectReason, setRejectReason] = useState("");
  const consentRef = useRef<HTMLInputElement>(null);

  const data = view.kind === "ready" ? view.data : null;
  const pending = data?.status === "pending";
  const busy = submitting !== null;
  const currency = data?.currency || undefined;

  async function approve() {
    if (!consent) {
      setConsentError("Please confirm that you have reviewed the repair work and cost before approving.");
      consentRef.current?.focus();
      return;
    }
    setConsentError("");
    await decide("approve", { consent: true }, (err) => {
      if (!err.consent) return false;
      setConsentError(String([err.consent].flat()[0]));
      return true;
    });
  }

  async function reject() {
    if ((await decide("reject", { reason: rejectReason.trim() })) !== "error") setDialog(null);
  }

  return (
    <ApprovalShell
      section="Repair estimates"
      title="Repair Estimate Review"
      refLabel="Repair ticket"
      refValue={data?.ticket_code}
      footerNote="This page shows only the repair estimate linked to your secure link."
      after={
        dialog === "reject" &&
        pending && (
          <Modal
            title="Reject this estimate?"
            description="Rejecting is a final decision for this estimate, and we won't start the repair. If you'd like the work or price adjusted, contact our team instead."
            onClose={() => setDialog(null)}
            locked={busy}
            footer={
              <>
                <button type="button" className="ra-btn ra-btn-secondary" onClick={() => setDialog(null)} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="ra-btn ra-btn-danger-solid"
                  onClick={() => void reject()}
                  disabled={busy}
                  aria-busy={submitting === "reject"}
                >
                  <BusyLabel busy={submitting === "reject"} busyText="Rejecting…">
                    Reject estimate
                  </BusyLabel>
                </button>
              </>
            }
          >
            <ReasonField
              id="ra-reject-reason"
              label="Reason"
              required={false}
              max={REASON_MAX}
              value={rejectReason}
              disabled={busy}
              onChange={setRejectReason}
            />
            {actionError && (
              <p className="ra-alert ra-alert-error" role="alert">
                {actionError}
              </p>
            )}
          </Modal>
        )
      }
    >
      <ApprovalStates view={view} noun={NOUN} onRetry={() => void load()} />

      {data && (
        <>
          <RepairBanner data={data} bannerRef={bannerRef} />
          {notice && (
            <p className="ra-alert ra-alert-info" role="status">
              {notice}
            </p>
          )}

          <div className="ra-layout">
            <section className="ra-card ra-area-info" aria-labelledby="ra-info-title">
              <h2 id="ra-info-title">Repair details</h2>
              <dl className="ra-facts">
                <Fact label="Customer" value={data.customer_name} />
                <Fact label="Repair ticket" value={data.ticket_code} mono />
                <Fact label="Device" value={deviceName(data.device)} />
                <Fact label="Serial number" value={data.device?.serial} mono />
                {data.estimate_version && data.estimate_version > 1 ? (
                  <Fact label="Estimate version" value={`Revision ${data.estimate_version}`} />
                ) : null}
              </dl>
              {data.reported_issue?.trim() && (
                <p className="ra-note">
                  <span>Reported issue</span>
                  {data.reported_issue}
                </p>
              )}
            </section>

            <section className="ra-card ra-area-devices" aria-labelledby="ra-work-title">
              <div className="ap-card-head">
                <h2 id="ra-work-title">Work and parts</h2>
                <span className="ra-count">{data.lines.length}</span>
              </div>
              {data.lines.length ? (
                <ul className="ra-charges">
                  {data.lines.map((line, i) => (
                    <li key={line.id ?? i}>
                      <span>
                        <span className="ra-charge-name">{line.description || "Repair work"}</span>
                        <span className="ap-line-sub">
                          {line.quantity ?? 1} × {formatMoney(line.unit_price, currency)}
                        </span>
                      </span>
                      <span className="ra-charge-amount">{formatMoney(line.line_total, currency)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ra-muted">No work or parts are listed on this estimate.</p>
              )}
            </section>

            <section className="ra-card ra-area-terms" aria-labelledby="ra-terms-title">
              <h2 id="ra-terms-title">Terms and conditions</h2>
              {data.terms?.trim() ? (
                <div className="ra-terms" tabIndex={0} aria-label="Repair terms and conditions">
                  {data.terms}
                </div>
              ) : (
                <p className="ra-muted">No additional terms were included with this estimate.</p>
              )}
            </section>

            {/* right-hand column on desktop; on mobile its cards rejoin the single column */}
            <div className="ra-aside">
              <section className="ra-card ra-area-finance" aria-labelledby="ra-finance-title">
                <h2 id="ra-finance-title">Estimate summary</h2>
                <ul className="ra-charges">
                  <li>
                    <span className="ra-charge-name">Estimated repair cost</span>
                    <span className="ra-charge-amount">{formatMoney(data.total_amount, currency)}</span>
                  </li>
                  {hasAmount(data.advance_paid) && Number(data.advance_paid) > 0 && (
                    <li>
                      <span className="ra-charge-name">Advance paid</span>
                      <span className="ra-charge-amount">− {formatMoney(data.advance_paid, currency)}</span>
                    </li>
                  )}
                </ul>
                <div className="ra-total">
                  <span>{Number(data.advance_paid) > 0 ? "Balance due" : "Total"}</span>
                  <strong>{formatMoney(hasAmount(data.balance_due) ? data.balance_due : data.total_amount, currency)}</strong>
                </div>
              </section>

              {pending && (
                <section className="ra-card ra-area-decision" aria-labelledby="ra-decision-title">
                  <h2 id="ra-decision-title">Your decision</h2>
                  <p className="ra-muted">Review the work, parts, cost and terms, then choose how you&apos;d like to proceed.</p>
                  <ConsentCheckbox
                    checked={consent}
                    disabled={busy}
                    error={consentError}
                    inputRef={consentRef}
                    onChange={(checked) => {
                      setConsent(checked);
                      if (checked) setConsentError("");
                    }}
                  >
                    I reviewed the final repair work and cost and authorise the service centre to proceed.
                  </ConsentCheckbox>
                  {actionError && !dialog && (
                    <p className="ra-alert ra-alert-error" role="alert">
                      {actionError}
                    </p>
                  )}
                  <div className="ra-actions ap-actions-2">
                    <button
                      type="button"
                      className="ra-btn ra-btn-primary"
                      onClick={() => void approve()}
                      disabled={busy}
                      aria-busy={submitting === "approve"}
                    >
                      <BusyLabel busy={submitting === "approve"} busyText="Approving…">
                        Approve estimate
                      </BusyLabel>
                    </button>
                    <button
                      type="button"
                      className="ra-btn ra-btn-danger"
                      onClick={() => {
                        setActionError("");
                        setDialog("reject");
                      }}
                      disabled={busy}
                    >
                      Reject estimate
                    </button>
                  </div>
                  {data.expires_at && <p className="ra-fine">This secure link is valid until {fmtDateTime(data.expires_at)}.</p>}
                </section>
              )}
            </div>
          </div>
        </>
      )}
    </ApprovalShell>
  );
}

function RepairBanner({ data, bannerRef }: { data: RepairApproval; bannerRef: React.RefObject<HTMLDivElement | null> }) {
  const when = fmtDateTime(data.decided_at);
  const on = when ? ` on ${when}` : "";
  const byStaff = !!data.source && data.source !== "customer";
  if (data.status === "approved")
    return (
      <StatusBanner
        tone="success"
        icon="✓"
        live
        bannerRef={bannerRef}
        title="Estimate approved"
        body={
          byStaff
            ? `This estimate was approved by our team on your behalf${on}. No further action is needed on this link.`
            : `Thank you. Your approval was recorded${on}. We'll go ahead with the repair and keep you updated.`
        }
      />
    );
  if (data.status === "rejected")
    return (
      <StatusBanner
        tone="neutral"
        icon="✕"
        live
        bannerRef={bannerRef}
        title="Estimate rejected"
        body={`Your decision was recorded${on}. We won't proceed with this repair. If this wasn't intended, please contact our team.`}
      />
    );
  if (data.status === "pending")
    return (
      <StatusBanner
        tone="pending"
        icon="◷"
        live={false}
        bannerRef={bannerRef}
        title="Awaiting your approval"
        body="Please review the repair estimate below before you respond."
      />
    );
  return (
    <StatusBanner
      tone="neutral"
      icon="◷"
      live
      bannerRef={bannerRef}
      title="Status unavailable"
      body="This estimate can't be responded to from this link."
    />
  );
}
