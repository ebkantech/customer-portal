"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

/*
 * Shared building blocks for the token-based customer approval pages
 * (repair, repair order, on-site service bill). Same behaviour and markup as
 * the rental agreement page (app/rental-approval), which they were modelled
 * on: the token only ever goes to Django, every decision is shown as done
 * only once Django returns the matching status, and one decision can be in
 * flight at a time.
 *
 * Django's public approval endpoints all answer the same way: 404 for a token
 * it never issued, 410 for a link that expired (24 hours) or was replaced by a
 * newer one, 409 when a different decision is already recorded, and repeating
 * the same decision returns the recorded result.
 */

export type ApprovalView<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "expired" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

/** What a decision attempt ended with; anything but "error" closes an open dialog. */
export type DecideResult = "ok" | "gone" | "conflict" | "error";

/** secrets.token_urlsafe(32) -- anything else can't be a real link, so it is never sent. */
export function isApprovalToken(token: string) {
  return /^[A-Za-z0-9_-]{20,200}$/.test(token);
}

export function fmtDateTime(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

/** First human-readable message in a DRF error body ({"reason": ["..."]}, {"detail": "..."}, ...). */
export function firstMessage(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    const text = Array.isArray(value) ? value[0] : value;
    if (typeof text === "string" && text) return text;
  }
  return "";
}

const NETWORK_LOAD = "We couldn't reach our server. Check your internet connection and try again.";
const THROTTLED = "Too many requests from this connection. Please wait a few minutes and try again.";

/**
 * Loads the snapshot behind `token` and POSTs decisions to the same URL.
 * `expected` maps each decision to the status Django must return for it.
 */
export function useTokenApproval<T extends { status: string }, D extends string>({
  token,
  basePath,
  isPayload,
  expected,
  noun,
}: {
  token: string;
  /** e.g. "/public/repair-approvals/" */
  basePath: string;
  isPayload: (data: unknown) => data is T;
  expected: Record<D, string>;
  /** e.g. "repair estimate" -- used in error messages */
  noun: string;
}) {
  const [view, setView] = useState<ApprovalView<T>>({ kind: "loading" });
  const [submitting, setSubmitting] = useState<D | null>(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  const path = `${basePath}${encodeURIComponent(token)}/`;

  const load = useCallback(async () => {
    if (!isApprovalToken(token)) {
      setView({ kind: "unavailable" });
      return;
    }
    setView({ kind: "loading" });
    try {
      const data = await api<unknown>(path, {}, false);
      if (!isPayload(data)) throw new Error("unexpected response");
      setView(data.status === "expired" || data.status === "revoked" ? { kind: "expired" } : { kind: "ready", data });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setView({ kind: "unavailable" });
      else if (e instanceof ApiError && e.status === 410) setView({ kind: "expired" });
      else if (e instanceof ApiError && e.status === 429) setView({ kind: "error", message: THROTTLED });
      else if (e instanceof ApiError && e.status === 0) setView({ kind: "error", message: NETWORK_LOAD });
      else setView({ kind: "error", message: `We couldn't load your ${noun} right now. Please try again in a moment.` });
    }
  }, [token, path, isPayload, noun]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * POST one decision. `onBadRequest` may claim a 400 body (e.g. to show a
   * field error) by returning true; otherwise its first message is shown.
   */
  async function decide(
    decision: D,
    body: Record<string, unknown>,
    onBadRequest?: (data: Record<string, unknown>) => boolean,
  ): Promise<DecideResult> {
    if (inFlight.current) return "error";
    inFlight.current = true;
    setSubmitting(decision);
    setActionError("");
    setNotice("");
    try {
      const data = await api<unknown>(path, { method: "POST", body: JSON.stringify({ decision, ...body }) }, false);
      if (!isPayload(data) || data.status !== expected[decision])
        throw new ApiError(`We couldn't confirm that your response was recorded. Please reload the page to see the ${noun}'s current status.`, 200, {
          code: "unexpected_response",
        });
      setView({ kind: "ready", data });
      window.setTimeout(() => {
        bannerRef.current?.focus();
        bannerRef.current?.scrollIntoView({ block: "start" });
      }, 0);
      return "ok";
    } catch (e) {
      if (!(e instanceof ApiError)) {
        setActionError("Something went wrong. Your response was not recorded.");
        return "error";
      }
      if (e.status === 410) {
        setView({ kind: "expired" });
        return "gone";
      }
      if (e.status === 404) {
        setView({ kind: "unavailable" });
        return "gone";
      }
      if (e.status === 409) {
        // a different decision is already recorded: show the backend's current state
        await load();
        setNotice(e.message || `A decision has already been recorded for this ${noun}.`);
        return "conflict";
      }
      if (e.status === 400) {
        if (!onBadRequest?.(e.data))
          setActionError(firstMessage(e.data, ["reason", "consent", "decision", "detail", "non_field_errors"]) || e.message);
        return "error";
      }
      if (e.status === 429) setActionError("Too many attempts from this connection. Please wait a few minutes and try again.");
      else if (e.status === 0)
        setActionError(
          "We couldn't reach our server, so we can't confirm your response was recorded. Check your connection, then reload the page to see the current status.",
        );
      else setActionError(e.message || "Something went wrong. Your response was not recorded.");
      return "error";
    } finally {
      inFlight.current = false;
      setSubmitting(null);
    }
  }

  return { view, load, decide, submitting, actionError, setActionError, notice, bannerRef };
}

/* ------------------------------------------------------------------ layout */

export function ApprovalShell({
  section,
  title,
  refLabel,
  refValue,
  footerNote,
  children,
  after,
}: {
  /** Small line under the brand, e.g. "Repair estimates" */
  section: string;
  title: string;
  refLabel?: string;
  refValue?: string;
  footerNote: string;
  children: React.ReactNode;
  /** Rendered outside <main> (dialogs) */
  after?: React.ReactNode;
}) {
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
              <small>{section}</small>
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
            <h1>{title}</h1>
          </div>
          {refValue && (
            <p className="ra-ref">
              <span>{refLabel}</span>
              <strong>{refValue}</strong>
            </p>
          )}
        </div>
        {children}
      </main>

      <footer className="ra-footer">
        <span>© {new Date().getFullYear()} Vantage Computers</span>
        <span>{footerNote}</span>
      </footer>
      {after}
    </div>
  );
}

/** The loading / expired / unavailable / error screens every approval page shows. */
export function ApprovalStates<T>({
  view,
  noun,
  onRetry,
}: {
  view: ApprovalView<T>;
  /** e.g. "repair estimate" */
  noun: string;
  onRetry: () => void;
}) {
  if (view.kind === "loading") return <LoadingState label={`Loading your ${noun}`} />;
  if (view.kind === "expired")
    return (
      <StateCard tone="warning" title="This approval link has expired">
        <p>
          For your security, approval links work for 24 hours, and sending a new or revised {noun} replaces the previous link. Please
          contact our team and we&apos;ll send you a new link.
        </p>
      </StateCard>
    );
  if (view.kind === "unavailable")
    return (
      <StateCard tone="neutral" title="This link isn't available">
        <p>
          We couldn&apos;t open a {noun} with this link. Please use the most recent link we sent you, or contact our team for a new one.
        </p>
      </StateCard>
    );
  if (view.kind === "error")
    return (
      <StateCard tone="error" title={`We couldn't load your ${noun}`}>
        <p>{view.message}</p>
        <button type="button" className="ra-btn ra-btn-secondary" onClick={onRetry}>
          Try again
        </button>
      </StateCard>
    );
  return null;
}

/* ------------------------------------------------------------------ pieces */

export type BannerTone = "success" | "neutral" | "info" | "pending";

export function StatusBanner({
  tone,
  icon,
  title,
  body,
  live,
  bannerRef,
  children,
}: {
  tone: BannerTone;
  icon: string;
  title: string;
  body: string;
  /** announce to screen readers (a recorded outcome, not the initial pending state) */
  live: boolean;
  bannerRef: React.RefObject<HTMLDivElement | null>;
  children?: React.ReactNode;
}) {
  return (
    <div ref={bannerRef} tabIndex={-1} className={`ra-banner ra-banner-${tone}`} role={live ? "status" : undefined}>
      <span className="ra-banner-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <h2>{title}</h2>
        <p>{body}</p>
        {children}
      </div>
    </div>
  );
}

export function Fact({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "ra-mono" : undefined}>{value}</dd>
    </div>
  );
}

export function StateCard({ tone, title, children }: { tone: "warning" | "neutral" | "error"; title: string; children: React.ReactNode }) {
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

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="ra-loading" role="status" aria-label={label}>
      <span className="skeleton ra-sk-banner" />
      <span className="skeleton ra-sk-card" />
      <span className="skeleton ra-sk-card" />
    </div>
  );
}

/** Button label that swaps to a spinner while its decision is being sent. */
export function BusyLabel({ busy, busyText, children }: { busy: boolean; busyText: string; children: React.ReactNode }) {
  return busy ? (
    <>
      <span className="ra-spinner" aria-hidden="true" /> {busyText}
    </>
  ) : (
    <>{children}</>
  );
}

/** Consent checkbox shown above the approve button. */
export function ConsentCheckbox({
  checked,
  disabled,
  error,
  inputRef,
  onChange,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  error: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <label className={`ra-consent ${error ? "ra-consent-error" : ""}`}>
        <input
          ref={inputRef}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={error ? "ap-consent-error" : undefined}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{children}</span>
      </label>
      {error && (
        <p id="ap-consent-error" className="ra-field-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Textarea + counter used in reject / request-changes dialogs. */
export function ReasonField({
  id,
  label,
  required,
  max,
  value,
  disabled,
  error,
  onChange,
}: {
  id: string;
  label: string;
  required: boolean;
  max: number;
  value: string;
  disabled: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <label className="ra-label" htmlFor={id}>
        {label} <span>({required ? "required" : "optional"})</span>
      </label>
      <textarea
        id={id}
        className="ra-textarea"
        rows={required ? 5 : 4}
        maxLength={max}
        value={value}
        disabled={disabled}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`}
        onChange={(e) => onChange(e.target.value)}
        data-autofocus
      />
      <p id={`${id}-count`} className={`ra-counter ${value.length >= max ? "ra-counter-max" : ""}`}>
        {value.length}/{max}
      </p>
      {error && (
        <p id={`${id}-error`} className="ra-field-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
