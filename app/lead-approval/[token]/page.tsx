"use client";
import { useRef, useState } from "react";
import { useParams } from "next/navigation";
import { formatMoney } from "@/lib/api";
import {
  isLeadApprovalPayload,
  LEAD_DECISION_RESULT,
  LEAD_MESSAGE_MAX,
  LeadApproval,
  LeadDecision,
  LINE_KIND,
} from "@/lib/leadApproval";
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
 * Customer review page for an on-site service bill (a "lead" job): what the
 * technician found and the charges, from GET /api/public/lead-approvals/<token>/
 * (leads.views.LeadApprovalPublicView). The customer approves (work starts),
 * declines (only the visit charge is billed) or asks for changes (the
 * technician sends a revised bill on a new link).
 */

const NOUN = "service bill";
type Dialog = null | "reject" | "request_changes";

export default function LeadApprovalPage() {
  const params = useParams<{ token: string }>();
  const token = decodeURIComponent(params.token || "");
  const { view, load, decide, submitting, actionError, setActionError, notice, bannerRef } = useTokenApproval<LeadApproval, LeadDecision>({
    token,
    basePath: "/public/lead-approvals/",
    isPayload: isLeadApprovalPayload,
    expected: LEAD_DECISION_RESULT,
    noun: NOUN,
  });
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [changeText, setChangeText] = useState("");
  const [changeError, setChangeError] = useState("");
  const consentRef = useRef<HTMLInputElement>(null);

  const data = view.kind === "ready" ? view.data : null;
  const pending = data?.status === "pending";
  const busy = submitting !== null;

  async function approve() {
    if (!consent) {
      setConsentError("Please confirm that you have reviewed the diagnosis and the charges before approving.");
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

  async function requestChanges() {
    const message = changeText.trim();
    if (!message) {
      setChangeError("Please tell us what you would like changed.");
      return;
    }
    if (message.length > LEAD_MESSAGE_MAX) {
      setChangeError(`Please keep your message within ${LEAD_MESSAGE_MAX} characters.`);
      return;
    }
    setChangeError("");
    const result = await decide("request_changes", { reason: message }, (err) => {
      if (!err.reason) return false;
      setChangeError(String([err.reason].flat()[0]));
      return true;
    });
    if (result !== "error") setDialog(null);
  }

  const dialogs =
    pending && dialog === "reject" ? (
      <Modal
        title="Decline the work?"
        description="Declining is a final decision for this bill: no repair work will be done, and only the visit charge (if any) will be billed. If you only need something adjusted, choose Ask for changes instead."
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
              <BusyLabel busy={submitting === "reject"} busyText="Declining…">
                Decline
              </BusyLabel>
            </button>
          </>
        }
      >
        <ReasonField
          id="ap-lead-reject-reason"
          label="Reason"
          required={false}
          max={LEAD_MESSAGE_MAX}
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
    ) : pending && dialog === "request_changes" ? (
      <Modal
        title="Ask for changes"
        description="Tell the technician what should change. Nothing is approved yet: you'll get a revised bill on a new link."
        onClose={() => setDialog(null)}
        locked={busy}
        footer={
          <>
            <button type="button" className="ra-btn ra-btn-secondary" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="ra-btn ra-btn-primary"
              onClick={() => void requestChanges()}
              disabled={busy}
              aria-busy={submitting === "request_changes"}
            >
              <BusyLabel busy={submitting === "request_changes"} busyText="Sending…">
                Send request
              </BusyLabel>
            </button>
          </>
        }
      >
        <ReasonField
          id="ap-lead-change-text"
          label="What would you like changed?"
          required
          max={LEAD_MESSAGE_MAX}
          value={changeText}
          disabled={busy}
          error={changeError}
          onChange={(v) => {
            setChangeText(v);
            if (changeError) setChangeError("");
          }}
        />
        {actionError && (
          <p className="ra-alert ra-alert-error" role="alert">
            {actionError}
          </p>
        )}
      </Modal>
    ) : null;

  return (
    <ApprovalShell
      section="On-site service"
      title="Service Bill Review"
      refLabel="Service job"
      refValue={data?.lead_code}
      footerNote="This page shows only the service bill linked to your secure link."
      after={dialogs}
    >
      <ApprovalStates view={view} noun={NOUN} onRetry={() => void load()} />

      {data && (
        <>
          <LeadBanner data={data} bannerRef={bannerRef} />
          {notice && (
            <p className="ra-alert ra-alert-info" role="status">
              {notice}
            </p>
          )}

          <div className="ra-layout">
            <section className="ra-card ra-area-info" aria-labelledby="ap-info-title">
              <h2 id="ap-info-title">Service details</h2>
              <dl className="ra-facts">
                <Fact label="Customer" value={data.customer_name} />
                <Fact label="Service job" value={data.lead_code} mono />
                <Fact label="Device" value={data.device} />
                <Fact label="Site" value={data.site_address} />
                {data.version && data.version > 1 ? <Fact label="Bill version" value={`Revision ${data.version}`} /> : null}
              </dl>
              {data.issue?.trim() && (
                <p className="ra-note">
                  <span>Problem reported</span>
                  {data.issue}
                </p>
              )}
              {data.diagnosis?.trim() && (
                <p className="ra-note">
                  <span>What the technician found</span>
                  {data.diagnosis}
                </p>
              )}
            </section>

            <section className="ra-card ra-area-devices" aria-labelledby="ap-charges-title">
              <div className="ap-card-head">
                <h2 id="ap-charges-title">Charges</h2>
                <span className="ra-count">{data.lines.length}</span>
              </div>
              {data.lines.length ? (
                <ul className="ra-charges">
                  {data.lines.map((line, i) => (
                    <li key={i}>
                      <span>
                        <span className="ra-charge-name">{line.description || "Service"}</span>
                        <span className="ap-line-sub">
                          <span className="ap-kind">{LINE_KIND[line.kind || ""] || line.kind || "Item"}</span>
                          {(line.qty ?? 1) > 1 ? `${line.qty} × ${formatMoney(line.price)}` : ""}
                        </span>
                      </span>
                      <span className="ra-charge-amount">{formatMoney(line.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ra-muted">No charges are listed on this bill.</p>
              )}
              {data.note?.trim() && (
                <p className="ra-note">
                  <span>Note from the technician</span>
                  {data.note}
                </p>
              )}
            </section>

            <div className="ra-aside">
              <section className="ra-card ra-area-finance" aria-labelledby="ap-finance-title">
                <h2 id="ap-finance-title">Bill summary</h2>
                <div className="ra-total">
                  <span>Total</span>
                  <strong>{formatMoney(data.total)}</strong>
                </div>
                <p className="ra-finance-note">Work starts only after you approve. If you decline, only the visit charge is billed.</p>
              </section>

              {pending && (
                <section className="ra-card ra-area-decision" aria-labelledby="ap-decision-title">
                  <h2 id="ap-decision-title">Your decision</h2>
                  <p className="ra-muted">Review what the technician found and the charges, then choose how you&apos;d like to proceed.</p>
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
                    I have reviewed the diagnosis and the charges of {formatMoney(data.total)}, and I authorise this work.
                  </ConsentCheckbox>
                  {actionError && !dialog && (
                    <p className="ra-alert ra-alert-error" role="alert">
                      {actionError}
                    </p>
                  )}
                  <div className="ra-actions">
                    <button
                      type="button"
                      className="ra-btn ra-btn-primary"
                      onClick={() => void approve()}
                      disabled={busy}
                      aria-busy={submitting === "approve"}
                    >
                      <BusyLabel busy={submitting === "approve"} busyText="Approving…">
                        Approve bill
                      </BusyLabel>
                    </button>
                    <button
                      type="button"
                      className="ra-btn ra-btn-secondary"
                      onClick={() => {
                        setActionError("");
                        setChangeError("");
                        setDialog("request_changes");
                      }}
                      disabled={busy}
                    >
                      Ask for changes
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
                      Decline
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

function LeadBanner({ data, bannerRef }: { data: LeadApproval; bannerRef: React.RefObject<HTMLDivElement | null> }) {
  const when = fmtDateTime(data.decided_at);
  const on = when ? ` on ${when}` : "";
  if (data.status === "approved")
    return (
      <StatusBanner
        tone="success"
        icon="✓"
        live
        bannerRef={bannerRef}
        title="Bill approved"
        body={`Thank you — your approval was recorded${on}. The technician will now start the work.`}
      />
    );
  if (data.status === "rejected")
    return (
      <StatusBanner
        tone="neutral"
        icon="✕"
        live
        bannerRef={bannerRef}
        title="Work declined"
        body={`Your decision was recorded${on}. No repair work will be done. Only the visit charge (if any) will be billed.`}
      />
    );
  if (data.status === "changes_requested")
    return (
      <StatusBanner
        tone="info"
        icon="✎"
        live
        bannerRef={bannerRef}
        title="Change request sent"
        body={`Your request was sent${on}. Nothing is approved yet — the technician will send a revised bill on a new link.`}
      >
        {data.reason && (
          <blockquote className="ra-quote">
            <span>Your message</span>
            {data.reason}
          </blockquote>
        )}
      </StatusBanner>
    );
  if (data.status === "pending")
    return (
      <StatusBanner
        tone="pending"
        icon="◷"
        live={false}
        bannerRef={bannerRef}
        title="Awaiting your approval"
        body="Please review what the technician found and the charges below before you respond."
      />
    );
  return (
    <StatusBanner tone="neutral" icon="◷" live bannerRef={bannerRef} title="Status unavailable" body="This bill can't be responded to from this link." />
  );
}
