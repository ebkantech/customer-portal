"use client";
import { useRef, useState } from "react";
import { useParams } from "next/navigation";
import { formatMoney } from "@/lib/api";
import { classificationLabel } from "@/lib/rentalApproval";
import {
  isRepairOrderPayload,
  ORDER_DECISION_RESULT,
  ORDER_REASON_MAX,
  orderDeviceName,
  RepairOrderApproval,
  RepairOrderDecision,
} from "@/lib/repairOrderApproval";
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
 * Customer review page for a bulk repair order: one combined decision for
 * every device, from GET /api/public/repair-order-approvals/<token>/
 * (repairs.views.RepairOrderApprovalPublicView). Approving or rejecting here
 * records the same decision on every device's estimate.
 */

const NOUN = "repair order";

export default function RepairOrderApprovalPage() {
  const params = useParams<{ token: string }>();
  const token = decodeURIComponent(params.token || "");
  const { view, load, decide, submitting, actionError, setActionError, notice, bannerRef } = useTokenApproval<
    RepairOrderApproval,
    RepairOrderDecision
  >({
    token,
    basePath: "/public/repair-order-approvals/",
    isPayload: isRepairOrderPayload,
    expected: ORDER_DECISION_RESULT,
    noun: NOUN,
  });
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [dialog, setDialog] = useState<null | "reject">(null);
  const [rejectReason, setRejectReason] = useState("");
  const consentRef = useRef<HTMLInputElement>(null);

  const data = view.kind === "ready" ? view.data : null;
  const pending = data?.status === "pending";
  const busy = submitting !== null;
  const currency = data?.currency || undefined;
  const count = data?.devices.length ?? 0;

  async function approve() {
    if (!consent) {
      setConsentError("Please confirm that you have reviewed every device, repair line and cost before approving.");
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
      section="Repair orders"
      title="Repair Order Review"
      refLabel="Repair order"
      refValue={data?.order_code}
      footerNote="This page shows only the repair order linked to your secure link."
      after={
        dialog === "reject" &&
        pending && (
          <Modal
            title="Reject this repair order?"
            description={`Rejecting is a final decision for all ${count} devices in this order, and we won't start any of the repairs. If you'd like something adjusted, contact our team instead.`}
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
                    Reject order
                  </BusyLabel>
                </button>
              </>
            }
          >
            <ReasonField
              id="ap-order-reject-reason"
              label="Reason"
              required={false}
              max={ORDER_REASON_MAX}
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
          <OrderBanner data={data} bannerRef={bannerRef} />
          {notice && (
            <p className="ra-alert ra-alert-info" role="status">
              {notice}
            </p>
          )}

          <div className="ra-layout">
            <section className="ra-card ra-area-info" aria-labelledby="ap-info-title">
              <h2 id="ap-info-title">Order details</h2>
              <dl className="ra-facts">
                <Fact label="Customer" value={data.customer?.name} />
                <Fact label="Customer type" value={classificationLabel(data.customer?.classification)} />
                <Fact label="Repair order" value={data.order_code} mono />
                <Fact label="Devices" value={count === 1 ? "1 device" : `${count} devices`} />
                {data.version && data.version > 1 ? <Fact label="Estimate version" value={`Revision ${data.version}`} /> : null}
              </dl>
            </section>

            <section className="ra-area-devices" aria-labelledby="ap-devices-title">
              <div className="ra-section-head">
                <h2 id="ap-devices-title">Devices in this order</h2>
                <span className="ra-count">{count}</span>
              </div>
              {count ? (
                <ol className="ra-devices">
                  {data.devices.map((device, i) => (
                    <li key={device.ticket_code || i} className="ra-card ra-device">
                      <div className="ra-device-head">
                        <div>
                          <p className="ra-eyebrow">
                            Device {i + 1} of {count}
                          </p>
                          <h3>{orderDeviceName(device)}</h3>
                        </div>
                        <p className="ra-device-fee">
                          <strong>{formatMoney(device.total_amount, currency)}</strong>
                          <span>estimate</span>
                        </p>
                      </div>
                      <dl className="ra-facts ra-facts-compact">
                        <Fact label="Repair ticket" value={device.ticket_code} mono />
                        <Fact label="Serial number" value={device.serial} mono />
                      </dl>
                      {device.reported_issue?.trim() && (
                        <p className="ra-note">
                          <span>Reported issue</span>
                          {device.reported_issue}
                        </p>
                      )}
                      <div className="ra-block">
                        <h4>Work and parts</h4>
                        {device.lines?.length ? (
                          <ul className="ra-charges">
                            {device.lines.map((line, j) => (
                              <li key={j}>
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
                          <p className="ra-muted">No work or parts are listed for this device.</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="ra-card ra-muted">No devices are listed on this order.</p>
              )}
            </section>

            <section className="ra-card ra-area-terms" aria-labelledby="ap-terms-title">
              <h2 id="ap-terms-title">Terms and conditions</h2>
              {data.terms?.trim() ? (
                <div className="ra-terms" tabIndex={0} aria-label="Repair terms and conditions">
                  {data.terms}
                </div>
              ) : (
                <p className="ra-muted">No additional terms were included with this order.</p>
              )}
            </section>

            <div className="ra-aside">
              <section className="ra-card ra-area-finance" aria-labelledby="ap-finance-title">
                <h2 id="ap-finance-title">Combined estimate</h2>
                <ul className="ra-charges">
                  {data.devices.map((device, i) => (
                    <li key={device.ticket_code || i}>
                      <span>
                        <span className="ra-charge-name">{orderDeviceName(device)}</span>
                        {device.ticket_code && <span className="ra-charge-tag">{device.ticket_code}</span>}
                      </span>
                      <span className="ra-charge-amount">{formatMoney(device.total_amount, currency)}</span>
                    </li>
                  ))}
                </ul>
                <div className="ra-total">
                  <span>Combined total</span>
                  <strong>{formatMoney(data.grand_total, currency)}</strong>
                </div>
              </section>

              {pending && (
                <section className="ra-card ra-area-decision" aria-labelledby="ap-decision-title">
                  <h2 id="ap-decision-title">Your decision</h2>
                  <p className="ra-muted">One decision applies to every device in this order.</p>
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
                    I reviewed every device, repair line and final cost and authorise the service centre to proceed.
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
                        Approve all devices
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
                      Reject order
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

function OrderBanner({ data, bannerRef }: { data: RepairOrderApproval; bannerRef: React.RefObject<HTMLDivElement | null> }) {
  const when = fmtDateTime(data.decided_at);
  const on = when ? ` on ${when}` : "";
  if (data.status === "approved")
    return (
      <StatusBanner
        tone="success"
        icon="✓"
        live
        bannerRef={bannerRef}
        title="Repair order approved"
        body={
          data.source && data.source !== "customer"
            ? `This order was approved by our team on your behalf${on}. No further action is needed on this link.`
            : `Thank you. Your approval for every device was recorded${on}. We'll go ahead with the repairs and keep you updated.`
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
        title="Repair order rejected"
        body={`Your decision was recorded${on}. We won't proceed with these repairs. If this wasn't intended, please contact our team.`}
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
        body="Please review every device and the combined estimate below before you respond."
      />
    );
  return (
    <StatusBanner tone="neutral" icon="◷" live bannerRef={bannerRef} title="Status unavailable" body="This order can't be responded to from this link." />
  );
}
