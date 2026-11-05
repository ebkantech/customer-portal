"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  api,
  downloadFile,
  formatDate,
  formatMoney,
  HeldPayment,
  isAuthError,
  LaptopStatus,
  PaymentDue,
  Rental,
  RentalIssue,
} from "@/lib/api";
import { Section, SectionError, SkeletonRows, Status } from "./ui";

const LAPTOP_STEPS = [
  { key: "preparing", label: "Being prepared" },
  { key: "ready", label: "Ready for handover" },
  { key: "with_you", label: "With you" },
  { key: "returned", label: "Returned" },
];

/** Where the laptop is. Django decides the step; the bar only draws it. */
export function LaptopStatusBar({ status }: { status: LaptopStatus }) {
  const current = LAPTOP_STEPS.findIndex((step) => step.key === status.key);
  return (
    <div className="laptop-status">
      <div className="laptop-status-head">
        <span>Laptop status</span>
        <strong>{status.label}</strong>
      </div>
      {current >= 0 && (
        <ol className="laptop-steps" aria-hidden="true">
          {LAPTOP_STEPS.map((step, i) => (
            <li key={step.key} className={i <= current ? "done" : ""} title={step.label} />
          ))}
        </ol>
      )}
      <p>
        {status.detail}
        {status.handed_over_on ? ` Handed over on ${formatDate(status.handed_over_on)}.` : ""}
      </p>
    </div>
  );
}

function PayLink({ url, label }: { url?: string | null; label: string }) {
  if (!url?.startsWith("https://")) return <small className="pay-waiting">Payment link not sent yet</small>;
  return (
    <a className="pay-button" href={url} target="_blank" rel="noopener noreferrer" aria-label={label}>
      Pay now
    </a>
  );
}

function heldNote(held: HeldPayment, paidText: string) {
  const refunded = Number(held.refunded) || 0;
  if (/^refunded$/i.test(held.status || "")) return `Refunded ${formatMoney(refunded || held.amount)}`;
  if (/^paid$/i.test(held.status || "")) {
    const paid = held.paid_on ? `Paid on ${formatDate(held.paid_on)}. ` : "Paid. ";
    return `${paid}${paidText}${refunded ? ` ${formatMoney(refunded)} refunded so far.` : ""}`;
  }
  return "Not paid yet.";
}

function HeldRow({ title, held, paidText }: { title: string; held: HeldPayment; paidText: string }) {
  const owed = !/^(paid|refunded)$/i.test(held.status || "");
  return (
    <li>
      <div>
        <strong>{title}</strong>
        <small>{heldNote(held, paidText)}</small>
      </div>
      <div className="money-end">
        <span className="amount">{formatMoney(held.amount)}</span>
        {owed && <PayLink url={held.payment_url} label={`Pay ${title} ${held.code || ""}`} />}
      </div>
    </li>
  );
}

function DueRow({ due }: { due: PaymentDue }) {
  return (
    <li>
      <div>
        <strong>{due.code || "Payment due"}</strong>
        <small>{due.due_date ? `Due ${formatDate(due.due_date)}` : "Due now"}</small>
      </div>
      <div className="money-end">
        <span className="amount">{formatMoney(due.amount)}</span>
        <PayLink url={due.payment_url} label={`Pay invoice ${due.code || ""}`} />
      </div>
    </li>
  );
}

/** Security deposit, advance rent, and anything still to pay on one agreement. */
export function RentalMoney({ rental }: { rental: Rental }) {
  const deposit = rental.security_deposit;
  const advance = rental.advance;
  const heldCodes = [deposit?.code, advance?.code];
  const due = (rental.payments_due || []).filter((row) => !heldCodes.includes(row.code));
  if (!deposit && !advance && !due.length) return null;
  return (
    <ul className="rental-money" aria-label="Deposit, advance and payments">
      {deposit && <HeldRow title="Security deposit" held={deposit} paidText="Held by us, refundable when the laptop is returned." />}
      {advance && <HeldRow title="Advance rent" held={advance} paidText="Covers your first month." />}
      {due.map((row) => (
        <DueRow key={row.id} due={row} />
      ))}
    </ul>
  );
}

/** Where a repair job has reached. Django sends the stages and the status. */
export function RepairProgress({ stages, current }: { stages: string[]; current?: string }) {
  const reached = stages.indexOf(current || "");
  return (
    <ol className="repair-steps" aria-label={`Repair progress: ${current || "not started"}`}>
      {stages.map((stage, i) => (
        <li key={stage} className={i < reached ? "done" : i === reached ? "current" : ""}>
          <span aria-hidden="true" />
          {stage}
        </li>
      ))}
    </ol>
  );
}

/** The signed agreement on file, and everything paid on this agreement. */
export function RentalRecords({ rental, onAuthError }: { rental: Rental; onAuthError: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const history = rental.payment_history || [];

  async function download() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await downloadFile(
        `/portal/rentals/${encodeURIComponent(String(rental.id))}/signed-agreement/`,
        `${rental.agreement_code || "Agreement"}-signed`,
      );
    } catch (e) {
      if (isAuthError(e)) {
        onAuthError(e);
        return;
      }
      setError("The signed agreement couldn't be downloaded. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!rental.signed_agreement_uploaded_at && !history.length) return null;
  return (
    <div className="rental-records">
      {rental.signed_agreement_uploaded_at && (
        <button type="button" className="details-button" onClick={() => void download()} disabled={busy}>
          {busy ? "Downloading…" : "Download signed agreement"}
        </button>
      )}
      {error && <p className="download-message error" role="alert">{error}</p>}
      {history.length > 0 && (
        <details>
          <summary>Payment history ({history.length})</summary>
          <ul className="rental-money">
            {history.map((payment) => (
              <li key={payment.id}>
                <div>
                  <strong>{payment.label || "Payment"}</strong>
                  <small>
                    {[payment.code, payment.paid_on ? `Paid ${formatDate(payment.paid_on)}` : "", payment.pay_method]
                      .filter(Boolean)
                      .join(" · ")}
                    {Number(payment.refunded) > 0 ? ` · ${formatMoney(payment.refunded)} refunded` : ""}
                  </small>
                </div>
                <span className="amount">{formatMoney(payment.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const RUNNING = new Set(["approved", "active"]);
const MAX_TITLE = 140;
const MAX_DETAILS = 2000;

/** Raise an issue about a rented laptop and follow what happened to it. */
export function RentalIssues({ rentals, onAuthError }: { rentals: Rental[]; onAuthError: (e: unknown) => void }) {
  const running = rentals.filter((r) => RUNNING.has(r.status || ""));
  const [issues, setIssues] = useState<Section<RentalIssue[]>>({ state: "loading" });
  const [rentalId, setRentalId] = useState("");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setIssues({ state: "loading" });
    try {
      setIssues({ state: "ready", data: await api<RentalIssue[]>("/portal/issues/") });
    } catch (e) {
      if (isAuthError(e)) onAuthError(e);
      else setIssues({ state: "error", error: e instanceof Error ? e.message : "Couldn't load your issues." });
    }
  }, [onAuthError]);

  useEffect(() => {
    void load();
  }, [load]);

  const chosen = rentalId || String(running[0]?.id ?? "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const issue = await api<RentalIssue>("/portal/issues/", {
        method: "POST",
        body: JSON.stringify({ rental: chosen, title: title.trim(), description: details.trim() }),
      });
      setIssues((list) => (list.state === "ready" ? { state: "ready", data: [issue, ...list.data] } : list));
      setTitle("");
      setDetails("");
      setMessage({ ok: true, text: "Thanks. Our team has your issue and will contact you." });
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError(err);
        return;
      }
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Couldn't send your issue. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rental-issues">
      <h3>Need help with your laptop?</h3>
      {running.length > 0 ? (
        <form onSubmit={submit}>
          {running.length > 1 && (
            <>
              <label className="form-label" htmlFor="issue-rental">
                Which rental?
              </label>
              <select id="issue-rental" value={chosen} onChange={(e) => setRentalId(e.target.value)}>
                {running.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {[r.agreement_code, r.product_label].filter(Boolean).join(" · ") || `Rental ${r.id}`}
                  </option>
                ))}
              </select>
            </>
          )}
          <label className="form-label" htmlFor="issue-title">
            What is the problem?
          </label>
          <input
            id="issue-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE}
            required
            placeholder="For example: battery drains quickly"
          />
          <label className="form-label" htmlFor="issue-details">
            Details <span>(optional)</span>
          </label>
          <textarea
            id="issue-details"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={3}
            maxLength={MAX_DETAILS}
          />
          <div className="form-bottom">
            <span />
            <button type="submit" className="button button-primary" disabled={busy || !title.trim()}>
              {busy ? "Sending…" : "Raise issue →"}
            </button>
          </div>
          {message && (
            <div className={`notice ${message.ok ? "success-notice" : "error-alert"}`} role={message.ok ? "status" : "alert"}>
              {message.text}
            </div>
          )}
        </form>
      ) : (
        <p className="muted">You can raise an issue here while a rental is running.</p>
      )}
      {issues.state === "loading" && <SkeletonRows rows={2} label="Loading your issues" />}
      {issues.state === "error" && <SectionError message={issues.error} onRetry={() => void load()} />}
      {issues.state === "ready" && issues.data.length > 0 && (
        <ul className="issue-list" aria-label="Issues you raised">
          {issues.data.map((issue) => (
            <li key={issue.id}>
              <div>
                <strong>{issue.title}</strong>
                <small>
                  {[issue.agreement_code, issue.raised_at ? `Raised ${formatDate(issue.raised_at)}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </div>
              <Status value={issue.status || "Open"} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
