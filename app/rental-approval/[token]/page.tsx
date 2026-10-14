"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError, formatDate, formatMoney } from "@/lib/api";
import {
  ApprovalItem,
  classificationLabel,
  CHANGE_REQUEST_MAX,
  Decision,
  DECISION_RESULT,
  deviceName,
  isApprovalPayload,
  isApprovalToken,
  REASON_MAX,
  RentalApproval,
  rentalTypeLabel,
  tenureLabel,
} from "@/lib/rentalApproval";
import { Modal } from "@/app/components/rental/Modal";
import { PhotoGallery } from "@/app/components/rental/PhotoGallery";

/*
 * Customer review page for ONE rental agreement: the immutable approval
 * snapshot behind the token in the URL. Everything shown comes from
 * GET /api/public/rental-approvals/<token>/; every decision is POSTed to the
 * same URL and only shown as done once Django returns the matching status.
 * The token is never stored, logged or sent anywhere but the backend.
 */

type View =
  | { kind: "loading" }
  | { kind: "ready"; data: RentalApproval }
  | { kind: "expired" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

type Dialog = null | "reject" | "request_changes";

function fmtDateTime(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

/** First human-readable message in a DRF error body ({"reason": ["..."]}, {"detail": "..."}, ...). */
function firstMessage(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    const text = Array.isArray(value) ? value[0] : value;
    if (typeof text === "string" && text) return text;
  }
  return "";
}

function viewFromLoadError(e: unknown): View {
  if (e instanceof ApiError) {
    if (e.status === 404) return { kind: "unavailable" };
    if (e.status === 410) return /revoked|replaced/i.test(e.code || "") ? { kind: "unavailable" } : { kind: "expired" };
    if (e.status === 429)
      return { kind: "error", message: "Too many requests from this connection. Please wait a few minutes and try again." };
    if (e.status === 0) return { kind: "error", message: "We couldn't reach our server. Check your internet connection and try again." };
  }
  return { kind: "error", message: "We couldn't load your agreement right now. Please try again in a moment." };
}

function viewFromData(data: RentalApproval): View {
  if (data.status === "expired") return { kind: "expired" };
  if (data.status === "revoked") return { kind: "unavailable" };
  return { kind: "ready", data };
}

export default function RentalApprovalPage() {
  const params = useParams<{ token: string }>();
  const token = decodeURIComponent(params.token || "");
  const [view, setView] = useState<View>({ kind: "loading" });
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [submitting, setSubmitting] = useState<Decision | null>(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [changeText, setChangeText] = useState("");
  const [changeError, setChangeError] = useState("");
  const inFlight = useRef(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const path = `/public/rental-approvals/${encodeURIComponent(token)}/`;

  const load = useCallback(async () => {
    if (!isApprovalToken(token)) {
      setView({ kind: "unavailable" });
      return;
    }
    setView({ kind: "loading" });
    try {
      const data = await api<unknown>(path, {}, false);
      if (!isApprovalPayload(data)) throw new Error("unexpected response");
      setView(viewFromData(data));
    } catch (e) {
      setView(viewFromLoadError(e));
    }
  }, [token, path]);

  useEffect(() => {
    void load();
  }, [load]);

  /** POST one decision. Resolves true only when Django confirms the expected status. */
  async function decide(decision: Decision, body: Record<string, unknown>) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSubmitting(decision);
    setActionError("");
    setNotice("");
    try {
      const data = await api<unknown>(path, { method: "POST", body: JSON.stringify({ decision, ...body }) }, false);
      if (!isApprovalPayload(data) || data.status !== DECISION_RESULT[decision])
        throw new ApiError(
          "We couldn't confirm that your response was recorded. Please reload the page to see the agreement's current status.",
          200,
          {
            code: "unexpected_response",
          },
        );
      setDialog(null);
      setView({ kind: "ready", data });
      window.setTimeout(() => {
        bannerRef.current?.focus();
        bannerRef.current?.scrollIntoView({ block: "start" });
      }, 0);
      return true;
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 410) {
          setDialog(null);
          setView(/revoked|replaced/i.test(e.code || "") ? { kind: "unavailable" } : { kind: "expired" });
          return false;
        }
        if (e.status === 404) {
          setDialog(null);
          setView({ kind: "unavailable" });
          return false;
        }
        if (e.status === 409) {
          // someone/something already decided this link: show the backend's current state
          setDialog(null);
          await load();
          setNotice(e.message || "A response has already been recorded for this agreement.");
          return false;
        }
        if (e.status === 400) {
          const field = firstMessage(e.data, ["reason", "consent", "decision", "detail", "non_field_errors"]);
          if (decision === "approve" && e.data.consent) setConsentError(field);
          else if (decision === "request_changes" && e.data.reason) setChangeError(field);
          else setActionError(field || e.message);
          return false;
        }
        if (e.status === 429) {
          setActionError("Too many attempts from this connection. Please wait a few minutes and try again.");
          return false;
        }
        if (e.status === 0) {
          setActionError(
            "We couldn't reach our server, so we can't confirm your response was recorded. Check your connection, then reload the page to see the current status.",
          );
          return false;
        }
        setActionError(e.message || "Something went wrong. Your response was not recorded.");
        return false;
      }
      setActionError("Something went wrong. Your response was not recorded.");
      return false;
    } finally {
      inFlight.current = false;
      setSubmitting(null);
    }
  }

  function approve() {
    if (!consent) {
      setConsentError("Please confirm that you have reviewed the agreement before approving it.");
      consentRef.current?.focus();
      return;
    }
    setConsentError("");
    void decide("approve", { consent: true });
  }

  function submitChanges() {
    const message = changeText.trim();
    if (!message) {
      setChangeError("Please describe the changes you would like us to make.");
      return;
    }
    if (message.length > CHANGE_REQUEST_MAX) {
      setChangeError(`Please keep your message within ${CHANGE_REQUEST_MAX} characters.`);
      return;
    }
    setChangeError("");
    void decide("request_changes", { reason: message });
  }

  const data = view.kind === "ready" ? view.data : null;
  const pending = data?.status === "pending";
  const busy = submitting !== null;

  return (
    <div className="ra-page">
      <header className="ra-header">
        <div className="ra-header-inner">
          <div className="ra-brand">
            <div className="brand-mark small-mark" aria-hidden="true">
              V<span>+</span>
            </div>
            <span className="ra-brand-name">
              <strong>Vantage Computers</strong>
              <small>Rental agreements</small>
            </span>
          </div>
          <span className="ra-secure">
            <span className="ra-secure-dot" aria-hidden="true" />
            Secure review link
          </span>
        </div>
      </header>

      <main className="ra-main" id="main">
        <div className="ra-title-row">
          <div>
            <p className="ra-eyebrow">Customer review</p>
            <h1>Rental Agreement Review</h1>
          </div>
          {data?.agreement_code && (
            <p className="ra-ref">
              <span>Agreement</span>
              <strong>{data.agreement_code}</strong>
            </p>
          )}
        </div>

        {view.kind === "loading" && <LoadingState />}

        {view.kind === "expired" && (
          <StateCard tone="warning" title="This review link has expired">
            <p>
              For your security, rental agreement links work for 24 hours, and sending a revised agreement replaces the previous link.
              Please contact our team and we&apos;ll send you a new link.
            </p>
          </StateCard>
        )}

        {view.kind === "unavailable" && (
          <StateCard tone="neutral" title="This link isn't available">
            <p>
              We couldn&apos;t open an agreement with this link. Please use the most recent link we sent you, or contact our team for a new
              one.
            </p>
          </StateCard>
        )}

        {view.kind === "error" && (
          <StateCard tone="error" title="We couldn't load your agreement">
            <p>{view.message}</p>
            <button type="button" className="ra-btn ra-btn-secondary" onClick={() => void load()}>
              Try again
            </button>
          </StateCard>
        )}

        {data && (
          <>
            <StatusBanner data={data} bannerRef={bannerRef} />
            {notice && (
              <p className="ra-alert ra-alert-info" role="status">
                {notice}
              </p>
            )}

            <div className="ra-layout">
              <section className="ra-card ra-area-info" aria-labelledby="ra-info-title">
                <h2 id="ra-info-title">Agreement details</h2>
                <dl className="ra-facts">
                  <Fact label="Customer" value={data.customer?.name} />
                  <Fact label="Customer type" value={classificationLabel(data.customer?.classification)} />
                  <Fact label="Agreement reference" value={data.agreement_code} mono />
                  <Fact label="Rental start" value={data.start ? formatDate(data.start) : ""} />
                  <Fact label="Duration" value={tenureLabel(data.tenure_months)} />
                  <Fact label="Rental type" value={rentalTypeLabel(data.rental_type, data.items.length)} />
                  {data.version && data.version > 1 ? <Fact label="Agreement version" value={`Revision ${data.version}`} /> : null}
                </dl>
              </section>

              <section className="ra-area-devices" aria-labelledby="ra-devices-title">
                <div className="ra-section-head">
                  <h2 id="ra-devices-title">Devices in this agreement</h2>
                  <span className="ra-count">{data.items.length}</span>
                </div>
                {data.items.length ? (
                  <ol className="ra-devices">
                    {data.items.map((item, i) => (
                      <DeviceCard
                        key={`${item.asset_tag || ""}-${i}`}
                        item={item}
                        index={i}
                        total={data.items.length}
                        currency={data.currency}
                        token={token}
                      />
                    ))}
                  </ol>
                ) : (
                  <p className="ra-card ra-muted">No devices are listed on this agreement.</p>
                )}
              </section>

              <section className="ra-card ra-area-terms" aria-labelledby="ra-terms-title">
                <h2 id="ra-terms-title">Terms and conditions</h2>
                {data.terms?.trim() ? (
                  <div className="ra-terms" tabIndex={0} aria-label="Agreement terms and conditions">
                    {data.terms}
                  </div>
                ) : (
                  <p className="ra-muted">No additional terms were included with this agreement.</p>
                )}
              </section>

              {/* right-hand column on desktop; on mobile its cards rejoin the single column */}
              <div className="ra-aside">
                <section className="ra-card ra-area-finance" aria-labelledby="ra-finance-title">
                  <h2 id="ra-finance-title">Monthly charges</h2>
                  <ul className="ra-charges">
                    {data.items.map((item, i) => (
                      <li key={`${item.asset_tag || ""}-${i}`}>
                        <span>
                          <span className="ra-charge-name">{deviceName(item)}</span>
                          {item.asset_tag && <span className="ra-charge-tag">{item.asset_tag}</span>}
                        </span>
                        <span className="ra-charge-amount">{formatMoney(item.monthly_fee, data.currency || undefined)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="ra-total">
                    <span>Total per month</span>
                    <strong>{formatMoney(data.total_monthly_fee, data.currency || undefined)}</strong>
                  </div>
                  {data.tenure_months ? (
                    <p className="ra-finance-note">
                      Billed monthly for {tenureLabel(data.tenure_months)}
                      {data.start ? `, starting ${formatDate(data.start)}` : ""}.
                    </p>
                  ) : null}
                </section>

                {pending && (
                  <section className="ra-card ra-area-decision" aria-labelledby="ra-decision-title">
                    <h2 id="ra-decision-title">Your decision</h2>
                    <p className="ra-muted">
                      Review the devices, photos, charges and terms above, then choose how you&apos;d like to proceed.
                    </p>
                    <label className={`ra-consent ${consentError ? "ra-consent-error" : ""}`}>
                      <input
                        ref={consentRef}
                        type="checkbox"
                        checked={consent}
                        disabled={busy}
                        aria-describedby={consentError ? "ra-consent-error" : undefined}
                        aria-invalid={consentError ? true : undefined}
                        onChange={(e) => {
                          setConsent(e.target.checked);
                          if (e.target.checked) setConsentError("");
                        }}
                      />
                      <span>
                        I have reviewed the devices, their condition and photos, the accessories, the warranty terms, the rental duration
                        and the monthly charges, and I authorise this agreement.
                      </span>
                    </label>
                    {consentError && (
                      <p id="ra-consent-error" className="ra-field-error" role="alert">
                        {consentError}
                      </p>
                    )}
                    {actionError && !dialog && (
                      <p className="ra-alert ra-alert-error" role="alert">
                        {actionError}
                      </p>
                    )}
                    <div className="ra-actions">
                      <button
                        type="button"
                        className="ra-btn ra-btn-primary"
                        onClick={approve}
                        disabled={busy}
                        aria-busy={submitting === "approve"}
                      >
                        {submitting === "approve" ? (
                          <>
                            <span className="ra-spinner" aria-hidden="true" /> Approving…
                          </>
                        ) : (
                          "Approve agreement"
                        )}
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
                        Request changes
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
                        Reject agreement
                      </button>
                    </div>
                    {data.expires_at && <p className="ra-fine">This secure link is valid until {fmtDateTime(data.expires_at)}.</p>}
                  </section>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="ra-footer">
        <span>© {new Date().getFullYear()} Vantage Computers</span>
        <span>This page shows only the agreement linked to your secure link.</span>
      </footer>

      {dialog === "reject" && pending && (
        <Modal
          title="Reject this agreement?"
          description="Rejecting is a final decision for this agreement. If you only need something adjusted, choose Request changes instead."
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
                onClick={() => void decide("reject", { reason: rejectReason.trim() })}
                disabled={busy}
                aria-busy={submitting === "reject"}
              >
                {submitting === "reject" ? (
                  <>
                    <span className="ra-spinner" aria-hidden="true" /> Rejecting…
                  </>
                ) : (
                  "Reject agreement"
                )}
              </button>
            </>
          }
        >
          <label className="ra-label" htmlFor="ra-reject-reason">
            Reason <span>(optional)</span>
          </label>
          <textarea
            id="ra-reject-reason"
            className="ra-textarea"
            rows={4}
            maxLength={REASON_MAX}
            value={rejectReason}
            disabled={busy}
            onChange={(e) => setRejectReason(e.target.value)}
            aria-describedby="ra-reject-count"
            data-autofocus
          />
          <p id="ra-reject-count" className="ra-counter">
            {rejectReason.length}/{REASON_MAX}
          </p>
          {actionError && (
            <p className="ra-alert ra-alert-error" role="alert">
              {actionError}
            </p>
          )}
        </Modal>
      )}

      {dialog === "request_changes" && pending && (
        <Modal
          title="Request changes"
          description="Tell us what you'd like changed. This doesn't approve or reject the agreement: our team will review your request and send you a revised agreement on a new link."
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
                onClick={submitChanges}
                disabled={busy}
                aria-busy={submitting === "request_changes"}
              >
                {submitting === "request_changes" ? (
                  <>
                    <span className="ra-spinner" aria-hidden="true" /> Sending…
                  </>
                ) : (
                  "Send request"
                )}
              </button>
            </>
          }
        >
          <label className="ra-label" htmlFor="ra-change-text">
            What would you like changed? <span>(required)</span>
          </label>
          <textarea
            id="ra-change-text"
            className="ra-textarea"
            rows={5}
            maxLength={CHANGE_REQUEST_MAX}
            value={changeText}
            disabled={busy}
            required
            aria-invalid={changeError ? true : undefined}
            aria-describedby={`ra-change-count${changeError ? " ra-change-error" : ""}`}
            onChange={(e) => {
              setChangeText(e.target.value);
              if (changeError) setChangeError("");
            }}
            data-autofocus
          />
          <p id="ra-change-count" className={`ra-counter ${changeText.length >= CHANGE_REQUEST_MAX ? "ra-counter-max" : ""}`}>
            {changeText.length}/{CHANGE_REQUEST_MAX}
          </p>
          {changeError && (
            <p id="ra-change-error" className="ra-field-error" role="alert">
              {changeError}
            </p>
          )}
          {actionError && (
            <p className="ra-alert ra-alert-error" role="alert">
              {actionError}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

function StatusBanner({ data, bannerRef }: { data: RentalApproval; bannerRef: React.RefObject<HTMLDivElement | null> }) {
  const when = fmtDateTime(data.decided_at);
  const content =
    data.status === "approved"
      ? {
          tone: "success",
          title: "Agreement approved",
          body: `Thank you. Your approval was recorded${when ? ` on ${when}` : ""}. No further action is needed on this link.`,
        }
      : data.status === "rejected"
        ? {
            tone: "neutral",
            title: "Agreement rejected",
            body: `Your decision was recorded${when ? ` on ${when}` : ""}. If this wasn't intended, please contact our team.`,
          }
        : data.status === "changes_requested"
          ? {
              tone: "info",
              title: "Change request received",
              body: `We received your request${when ? ` on ${when}` : ""}. Our team will review the changes and send you a revised agreement on a new link. This agreement has not been approved or rejected.`,
            }
          : data.status === "pending"
            ? { tone: "pending", title: "Awaiting your review", body: "Please review the agreement below before you respond." }
            : { tone: "neutral", title: "Status unavailable", body: "This agreement can't be responded to from this link." };
  return (
    <div
      ref={bannerRef}
      tabIndex={-1}
      className={`ra-banner ra-banner-${content.tone}`}
      role={data.status === "pending" ? undefined : "status"}
    >
      <span className="ra-banner-icon" aria-hidden="true">
        {data.status === "approved" ? "✓" : data.status === "rejected" ? "✕" : data.status === "changes_requested" ? "✎" : "◷"}
      </span>
      <div>
        <h2>{content.title}</h2>
        <p>{content.body}</p>
        {data.status === "changes_requested" && data.change_request && (
          <blockquote className="ra-quote">
            <span>Your message</span>
            {data.change_request}
          </blockquote>
        )}
      </div>
    </div>
  );
}

function DeviceCard({
  item,
  index,
  total,
  currency,
  token,
}: {
  item: ApprovalItem;
  index: number;
  total: number;
  currency?: string;
  token: string;
}) {
  const name = deviceName(item);
  const checks = item.checks || [];
  const hasCondition = checks.length > 0 || typeof item.working_confirmed === "boolean" || !!item.condition_notes;
  return (
    <li className="ra-card ra-device">
      <div className="ra-device-head">
        <div>
          <p className="ra-eyebrow">
            Device {index + 1} of {total}
          </p>
          <h3>{name}</h3>
        </div>
        {item.monthly_fee != null && (
          <p className="ra-device-fee">
            <strong>{formatMoney(item.monthly_fee, currency || undefined)}</strong>
            <span>per month</span>
          </p>
        )}
      </div>

      <dl className="ra-facts ra-facts-compact">
        <Fact label="Asset tag" value={item.asset_tag} mono />
        <Fact label="Serial number" value={item.serial_number} mono />
      </dl>

      {hasCondition && (
        <div className="ra-block">
          <h4>Condition at handover</h4>
          {typeof item.working_confirmed === "boolean" && (
            <p className={`ra-pill ${item.working_confirmed ? "ra-pill-ok" : "ra-pill-warn"}`}>
              {item.working_confirmed ? "Tested and confirmed in working condition" : "Working condition not confirmed"}
            </p>
          )}
          {checks.length > 0 && (
            <ul className="ra-checks">
              {checks.map((check, i) => (
                <li key={i} className={check.ok ? "ra-check-ok" : "ra-check-fail"}>
                  <span aria-hidden="true">{check.ok ? "✓" : "✕"}</span>
                  <span>
                    {check.label || "Check"}
                    <span className="visually-hidden">{check.ok ? ": passed" : ": not passed"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {item.condition_notes && (
            <p className="ra-note">
              <span>Condition notes</span>
              {item.condition_notes}
            </p>
          )}
        </div>
      )}

      {item.accessories && (
        <div className="ra-block">
          <h4>Accessories</h4>
          {item.accessories.length ? (
            <ul className="ra-accessories">
              {item.accessories.map((a, i) => (
                <li key={i}>
                  <span>{a.name || "Accessory"}</span>
                  {a.serial && <span className="ra-mono">{a.serial}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ra-muted">No accessories are included with this device.</p>
          )}
        </div>
      )}

      {item.warranty && (
        <div className="ra-block">
          <h4>Warranty</h4>
          {item.warranty.included ? (
            <>
              <p className="ra-pill ra-pill-ok">
                Included
                {item.warranty.months
                  ? ` · ${item.warranty.months} month${item.warranty.months === 1 ? "" : "s"}`
                  : " for the rental tenure"}
              </p>
              {item.warranty.terms && <p className="ra-warranty-terms">{item.warranty.terms}</p>}
            </>
          ) : (
            <p className="ra-muted">No warranty is included with this device.</p>
          )}
        </div>
      )}

      {item.photos && item.photos.length > 0 && (
        <div className="ra-block">
          <h4>Handover photos</h4>
          <PhotoGallery token={token} photos={item.photos} deviceLabel={name} />
        </div>
      )}

      {(item.tested_by || item.tested_at) && (
        <p className="ra-fine">
          Handover check recorded{item.tested_by ? ` by ${item.tested_by}` : ""}
          {item.tested_at ? ` on ${fmtDateTime(item.tested_at)}` : ""}.
        </p>
      )}
    </li>
  );
}

function Fact({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "ra-mono" : undefined}>{value}</dd>
    </div>
  );
}

function StateCard({ tone, title, children }: { tone: "warning" | "neutral" | "error"; title: string; children: React.ReactNode }) {
  return (
    <section className={`ra-card ra-state ra-state-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="ra-state-icon" aria-hidden="true">
        {tone === "warning" ? "◷" : tone === "error" ? "!" : "⦸"}
      </span>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function LoadingState() {
  return (
    <div className="ra-loading" role="status" aria-label="Loading your agreement">
      <span className="skeleton ra-sk-banner" />
      <span className="skeleton ra-sk-card" />
      <span className="skeleton ra-sk-card" />
    </div>
  );
}
