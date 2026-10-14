"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  api,
  ApiError,
  checkSession,
  clearSession,
  forgetInviteToken,
  getSession,
  isInviteToken,
  rememberInviteToken,
  saveSession,
  sessionInviteToken,
} from "@/lib/api";
import { AuthShell, StateAlert } from "@/app/components/AuthShell";

/**
 * Invite-status / resend-otp response. Every expiry value comes from Django;
 * this page never decides on its own whether an invitation or code is valid.
 */
type InviteInfo = {
  masked_email?: string;
  /** Invitation link expiry (rental tenure end, or 24h for dealer/retail). */
  expires_at?: string;
  invite_expires_at?: string;
  /** OTP expiry: relative seconds (preferred) or absolute ISO timestamp. */
  otp_expires_in?: number | string;
  otp_expires_at?: string;
  /** Server clock at response time; used to correct client clock skew. */
  server_time?: string;
  /** Seconds before another resend is allowed. */
  resend_available_in?: number | string;
  /** Server-reported state of the current code: "active" | "expired" | "locked" | "none". */
  otp_status?: string;
  status?: string;
  valid?: boolean;
  [key: string]: unknown;
};
type OtpStatus = "active" | "expired" | "locked" | "none" | null;
type VerifyResult = {
  portal_token: string;
  party: { id?: number | string; name?: string };
  access_log_id?: number | string;
};
type PageState =
  | "checking"
  | "signed_in"
  | "ready"
  | "verified"
  | "invalid"
  | "expired"
  | "revoked"
  | "rate_limited"
  | "unavailable";

const OTP_LENGTH = 6;
const LINK_EXPIRED_ON_VERIFY =
  "Your invitation link has expired. Please resend the OTP to continue.";
// Django never re-opens an expired link (resend returns 410 invite_expired too),
// so a refused resend says exactly that instead of pretending a code was sent.
const LINK_EXPIRED_ON_RESEND =
  "This invitation link has expired, so a new code can't be sent from it. Please contact our team for a new invitation link.";
// UI-only guard against rapid repeat clicks when the server gives no cooldown.
// Real throttling is enforced by the backend.
const FALLBACK_RESEND_COOLDOWN = 30;
const FALLBACK_RATE_LIMIT_WAIT = 60;

function nonNegativeSeconds(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Converts backend OTP expiry data into a local deadline (epoch ms), or null if absent. */
function otpDeadlineFrom(info: InviteInfo): number | null {
  const now = Date.now();
  const remaining = nonNegativeSeconds(info.otp_expires_in);
  if (remaining != null) return now + remaining * 1000;
  if (typeof info.otp_expires_at !== "string") return null;
  const expires = Date.parse(info.otp_expires_at);
  if (Number.isNaN(expires)) return null;
  const server =
    typeof info.server_time === "string" ? Date.parse(info.server_time) : NaN;
  return Number.isNaN(server) ? expires : now + (expires - server);
}

type ClosedState = "expired" | "revoked" | "invalid";

/**
 * Invitation-level closure from Django's machine-readable codes:
 * invite_expired (link or rental tenure ended), invite_revoked (replaced by a
 * newer link or access withdrawn), invite_invalid (unknown link).
 */
function closedByCode(code?: string): ClosedState | null {
  if (!code || !/^(invite|invitation|link)_/i.test(code)) return null;
  if (/revoked|inactive|used|consumed/i.test(code)) return "revoked";
  if (/expired/i.test(code)) return "expired";
  if (/invalid|not_found/i.test(code)) return "invalid";
  return null;
}

/** Invite-status only describes the invitation, so its message text is also a safe signal. */
function closedBySignal(signal: string): ClosedState | null {
  if (/revoked|no longer active|consumed/i.test(signal)) return "revoked";
  if (/expired/i.test(signal)) return "expired";
  return null;
}

function otpStatusFrom(value: unknown): OtpStatus {
  return value === "active" ||
    value === "expired" ||
    value === "locked" ||
    value === "none"
    ? value
    : null;
}

function inviteStateFromError(e: unknown): PageState {
  if (!(e instanceof ApiError)) return "invalid";
  if (e.status === 0 || e.status >= 500) return "unavailable";
  if (e.status === 429) return "rate_limited";
  return (
    closedByCode(e.code) ||
    closedBySignal(`${e.code || ""} ${e.message}`) ||
    (e.status === 410 ? "expired" : "invalid")
  );
}

function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatDateTime(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(d);
}

export default function PortalLoginPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = decodeURIComponent(params.token || "");
  const [status, setStatus] = useState<PageState>("checking");
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [otpDeadline, setOtpDeadline] = useState<number | null>(null);
  const [otpStatus, setOtpStatus] = useState<OtpStatus>(null);
  // Django reported the invitation link expired. The form stays usable: the
  // backend rejects verify/resend on it, and the page explains that on click.
  const [linkExpired, setLinkExpired] = useState(false);
  const [resendReadyAt, setResendReadyAt] = useState<number | null>(null);
  const [verifyReadyAt, setVerifyReadyAt] = useState<number | null>(null);
  const [retryReadyAt, setRetryReadyAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // One shared 1s tick while any countdown is running; stops when all have elapsed.
  useEffect(() => {
    const deadlines = [
      otpDeadline,
      resendReadyAt,
      verifyReadyAt,
      retryReadyAt,
    ].filter((d): d is number => d != null);
    setNow(Date.now());
    if (!deadlines.some((d) => d > Date.now())) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (!deadlines.some((d) => d > t)) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [otpDeadline, resendReadyAt, verifyReadyAt, retryReadyAt]);

  const secondsUntil = (deadline: number | null) =>
    deadline == null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
  const otpRemaining = secondsUntil(otpDeadline);
  const resendWait = secondsUntil(resendReadyAt);
  const verifyWait = secondsUntil(verifyReadyAt);
  const retryWait = secondsUntil(retryReadyAt);

  const checkInvite = useCallback(async () => {
    setStatus("checking");
    setError("");
    setNotice("");
    if (!isInviteToken(token)) {
      // a mistyped or truncated link: no request can make it valid
      setError(
        "This invitation link is not valid. Please open the full link from your message.",
      );
      setStatus("invalid");
      return;
    }
    try {
      const d = await api<InviteInfo>(
        `/portal/invite-status/${encodeURIComponent(token)}/`,
        {},
        false,
      );
      if (!mounted.current) return;
      const closed =
        d.valid === false
          ? closedBySignal(String(d.status || "")) || "invalid"
          : closedBySignal(String(d.status || ""));
      if (closed) {
        forgetInviteToken(token);
        setStatus(closed);
        return;
      }
      // Reading the status never issues a code or resets its expiry (backend rule);
      // the page just reflects whatever code is currently outstanding.
      setInfo(d);
      setLinkExpired(false);
      setOtpStatus(otpStatusFrom(d.otp_status));
      setOtpDeadline(otpDeadlineFrom(d));
      const cooldown = nonNegativeSeconds(d.resend_available_in);
      setResendReadyAt(cooldown ? Date.now() + cooldown * 1000 : null);
      setStatus("ready");
    } catch (e) {
      if (!mounted.current) return;
      const next = inviteStateFromError(e);
      if (next === "expired" || next === "revoked" || next === "invalid")
        forgetInviteToken(token);
      if (next === "expired") {
        // keep the OTP form usable; verify/resend get Django's verdict on click
        setLinkExpired(true);
        setOtpStatus(null);
        setOtpDeadline(null);
        setStatus("ready");
        return;
      }
      setError(e instanceof Error ? e.message : "");
      if (next === "rate_limited") {
        const wait =
          (e instanceof ApiError ? e.retryAfter : null) ??
          FALLBACK_RATE_LIMIT_WAIT;
        setRetryReadyAt(Date.now() + wait * 1000);
      }
      setStatus(next);
    }
  }, [token]);

  // Only a session that was verified through THIS invitation may skip the
  // OTP (and only while Django still accepts it). Opening a different
  // invitation -- possibly another customer's -- drops the previous local
  // session so its data can't be reached from here without that link's own
  // OTP. Nothing is revoked server-side; the previous customer can sign in
  // again from their own link.
  useEffect(() => {
    let alive = true;
    rememberInviteToken(token);
    const sameInvitation =
      isInviteToken(token) && sessionInviteToken() === token;
    if (isInviteToken(token) && !sameInvitation && getSession()) clearSession();
    void (async () => {
      if (sameInvitation) {
        const session = await checkSession();
        if (!alive) return;
        if (session.state === "valid") {
          setStatus("signed_in");
          router.replace("/portal/dashboard");
          return;
        }
      }
      void checkInvite();
    })();
    return () => {
      alive = false;
    };
  }, [token, checkInvite, router]);

  /** Shared error handling for verify and resend. Never echoes the OTP. */
  function handleActionError(e: unknown, action: "verify" | "resend") {
    const fallback =
      action === "verify"
        ? "Unable to verify the code. Please try again."
        : "Unable to send a new code. Please try again.";
    if (!(e instanceof ApiError)) {
      setError(e instanceof Error && e.message ? e.message : fallback);
      return;
    }
    // Django refuses both verify and resend on an expired link (no login, no
    // new code). Say so specifically -- never as a generic "invalid OTP" -- and
    // keep the form and its buttons usable.
    const closed =
      closedByCode(e.code) || (e.status === 410 ? "expired" : null);
    if (closed === "expired") {
      forgetInviteToken(token);
      setLinkExpired(true);
      setOtpStatus(null);
      setOtpDeadline(null);
      setError(
        action === "verify" ? LINK_EXPIRED_ON_VERIFY : LINK_EXPIRED_ON_RESEND,
      );
      return;
    }
    // A revoked or unknown invitation is final.
    if (closed) {
      forgetInviteToken(token);
      setOtp("");
      setOtpDeadline(null);
      setError(e.message);
      setStatus(closed);
      return;
    }
    if (e.status === 429) {
      const wait =
        e.retryAfter ??
        (action === "resend"
          ? FALLBACK_RESEND_COOLDOWN
          : FALLBACK_RATE_LIMIT_WAIT);
      const until = Date.now() + wait * 1000;
      if (action === "resend") setResendReadyAt(until);
      else setVerifyReadyAt(until);
      setError(
        `Too many ${action === "resend" ? "code requests" : "attempts"}. Please wait ${formatClock(wait)} before trying again.`,
      );
      return;
    }
    if (e.code === "otp_attempts_exceeded") setOtpStatus("locked");
    else if (e.code === "otp_expired") {
      setOtpStatus("expired");
      setOtpDeadline(Date.now());
    } else if (e.code === "otp_invalid" && e.data.attempts_remaining == null)
      setOtpStatus("none");
    if (e.status === 0) {
      setError(
        "We couldn't reach the verification service. Check your connection and try again.",
      );
      return;
    }
    if (e.status >= 500 && !e.code) {
      setError(
        "The verification service is temporarily unavailable. Please try again in a few minutes.",
      );
      return;
    }
    if (
      action === "resend" &&
      (e.status === 404 || e.status === 405 || e.status === 501)
    ) {
      setError(
        "Requesting a new code isn't available right now. Please contact our team for a new code or portal link.",
      );
      return;
    }
    const attempts = nonNegativeSeconds(e.data.attempts_remaining);
    setError(
      `${e.message || fallback}${attempts != null ? ` ${attempts} attempt${attempts === 1 ? "" : "s"} remaining.` : ""}`,
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current || verifyWait > 0) return;
    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(otp)) {
      setError(`Enter the complete ${OTP_LENGTH}-digit code.`);
      inputRef.current?.focus();
      return;
    }
    inFlight.current = true;
    setVerifying(true);
    setError("");
    setNotice("");
    try {
      const result = await api<VerifyResult>(
        "/portal/verify/",
        { method: "POST", body: JSON.stringify({ token, otp }) },
        false,
      );
      if (!result?.portal_token)
        throw new Error(
          "Verification could not be completed. Please try again or contact our team.",
        );
      saveSession(result.portal_token, result.access_log_id, token);
      setOtp("");
      setStatus("verified");
      router.replace("/portal/dashboard");
    } catch (err) {
      if (!mounted.current) return;
      handleActionError(err, "verify");
      inputRef.current?.focus();
      inputRef.current?.select();
    } finally {
      inFlight.current = false;
      if (mounted.current) setVerifying(false);
    }
  }

  async function resend() {
    if (inFlight.current || resendWait > 0) return;
    inFlight.current = true;
    setResending(true);
    setError("");
    setNotice("");
    try {
      const d = await api<InviteInfo>(
        "/portal/resend-otp/",
        { method: "POST", body: JSON.stringify({ token }) },
        false,
      );
      if (!mounted.current) return;
      setOtp("");
      // Only the link's display data is refreshed; resending never extends the link.
      setInfo((prev) => ({
        ...prev,
        ...(d.masked_email ? { masked_email: d.masked_email } : {}),
        ...(d.invite_expires_at
          ? { invite_expires_at: d.invite_expires_at }
          : {}),
      }));
      setLinkExpired(false);
      setOtpStatus("active");
      setOtpDeadline(otpDeadlineFrom(d));
      const cooldown =
        nonNegativeSeconds(d.resend_available_in) ?? FALLBACK_RESEND_COOLDOWN;
      setResendReadyAt(Date.now() + cooldown * 1000);
      setNotice(
        `A new code has been sent to ${d.masked_email || info?.masked_email || "your registered email"}. Please use the most recent code you receive.`,
      );
      inputRef.current?.focus();
    } catch (err) {
      if (mounted.current) handleActionError(err, "resend");
    } finally {
      inFlight.current = false;
      if (mounted.current) setResending(false);
    }
  }

  const maskedEmail = info?.masked_email || "your registered email";
  const linkValidUntil = formatDateTime(
    info?.invite_expires_at || info?.expires_at,
  );
  const otpExpired =
    otpStatus === "expired" || (otpDeadline != null && otpRemaining === 0);
  const busy = verifying || resending;

  return (
    <AuthShell>
      <h2>Verify your identity</h2>
      <p className="muted">
        Enter the one-time code we emailed you to open your personal customer
        portal.
      </p>

      {status === "checking" && (
        <div className="notice notice-inline" role="status">
          <span className="spinner spinner-dark" aria-hidden="true" />
          Checking your secure link…
        </div>
      )}

      {status === "signed_in" && (
        <div className="alert success-alert notice-inline" role="status">
          <span className="spinner spinner-dark" aria-hidden="true" />
          <span>
            <strong>You&apos;re already signed in</strong>
            <span>Opening your portal…</span>
          </span>
        </div>
      )}

      {status === "verified" && (
        <div className="alert success-alert notice-inline" role="status">
          <span className="spinner spinner-dark" aria-hidden="true" />
          <span>
            <strong>Verified</strong>
            <span>Opening your portal…</span>
          </span>
        </div>
      )}

      {status === "expired" && (
        <StateAlert title="This link has expired">
          <span>
            Rental links stay valid for your rental tenure; dealer and retail
            links for 24 hours. Requesting a new code can&apos;t reopen an
            expired link.
          </span>
          <span>Please contact our team to request a new invitation.</span>
        </StateAlert>
      )}

      {status === "revoked" && (
        <StateAlert title="This link is no longer active">
          <span>
            A newer link may have been sent to you, or portal access was
            withdrawn. Please use your most recent invitation, or contact our
            team.
          </span>
        </StateAlert>
      )}

      {status === "invalid" && (
        <StateAlert title="This link cannot be used">
          <span>{error || "This invitation link is not valid."}</span>
          <span>Contact our team and request a fresh portal link.</span>
        </StateAlert>
      )}

      {status === "rate_limited" && (
        <StateAlert title="Too many attempts" tone="warning">
          <span>
            Please wait a moment before trying again.
            {retryWait > 0 && ` You can retry in ${formatClock(retryWait)}.`}
          </span>
          <button
            type="button"
            className="button button-outline state-action"
            onClick={() => void checkInvite()}
            disabled={retryWait > 0}
          >
            Try again
          </button>
        </StateAlert>
      )}

      {status === "unavailable" && (
        <StateAlert title="Service temporarily unavailable" tone="warning">
          <span>
            We couldn&apos;t reach the verification service. Check your
            connection and try again shortly.
          </span>
          <button
            type="button"
            className="button button-outline state-action"
            onClick={() => void checkInvite()}
          >
            Try again
          </button>
        </StateAlert>
      )}

      {status === "ready" && (
        <form
          onSubmit={submit}
          className="otp-form"
          noValidate
          aria-busy={busy}
        >
          <label htmlFor="otp">Verification code</label>
          <p id="otp-instructions" className="muted small">
            Enter the {OTP_LENGTH}-digit code sent to{" "}
            <strong>{maskedEmail}</strong>.
          </p>
          <input
            id="otp"
            name="otp"
            ref={inputRef}
            className="otp-input"
            value={otp}
            onChange={(e) => {
              // No maxLength attribute: browsers truncate pasted text before
              // onChange, which would cut "123 456" to "123 45".
              setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH));
              if (error) setError("");
            }}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            placeholder="• • • • • •"
            spellCheck={false}
            readOnly={verifying}
            aria-invalid={error ? true : undefined}
            aria-describedby={`otp-instructions otp-expiry${error ? " otp-error" : ""}`}
            autoFocus
          />

          {otpStatus === "locked" ? (
            <p id="otp-expiry" className="otp-meta otp-expired" role="status">
              Too many incorrect codes. Request a new code to try again.
            </p>
          ) : otpStatus === "none" ? (
            <p id="otp-expiry" className="otp-meta" role="status">
              There is no active code for this link (it may already have been
              used). Request a new code to sign in.
            </p>
          ) : otpExpired ? (
            <p id="otp-expiry" className="otp-meta otp-expired" role="status">
              This code has expired. Request a new code below.
            </p>
          ) : otpDeadline == null ? (
            <p id="otp-expiry" className="otp-meta">
              For your security, codes expire 30 minutes after they are sent.
            </p>
          ) : (
            <p
              id="otp-expiry"
              className={`otp-meta${otpRemaining <= 60 ? " otp-warn" : ""}`}
            >
              Code expires in{" "}
              <span className="otp-timer">{formatClock(otpRemaining)}</span>
            </p>
          )}

          {error && (
            <div id="otp-error" className="alert error-alert" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="alert success-alert" role="status">
              {notice}
            </div>
          )}

          <button
            type="submit"
            className="button button-primary full-button otp-submit"
            disabled={busy || verifyWait > 0}
          >
            {verifying ? (
              <>
                <span className="spinner" aria-hidden="true" /> Verifying…
              </>
            ) : verifyWait > 0 ? (
              `Try again in ${formatClock(verifyWait)}`
            ) : (
              "Verify OTP"
            )}
          </button>

          <div className="resend-row">
            <span>Didn&apos;t receive the code?</span>
            <button
              type="button"
              className="button button-outline"
              onClick={() => void resend()}
              disabled={busy || resendWait > 0}
              aria-describedby={resendWait > 0 ? "resend-wait" : undefined}
            >
              {resending ? (
                <>
                  <span className="spinner spinner-dark" aria-hidden="true" />{" "}
                  Sending…
                </>
              ) : (
                "Resend OTP"
              )}
            </button>
          </div>
          {resendWait > 0 && (
            <p id="resend-wait" className="field-hint resend-wait">
              You can request another code in {formatClock(resendWait)}.
            </p>
          )}
        </form>
      )}

      <div className="privacy-note">
        <span aria-hidden="true">▣</span>
        <span className="privacy-text">
          Your account is protected with one-time verification.
          {status === "ready" && !linkExpired && linkValidUntil && (
            <> This invitation link is valid until {linkValidUntil}.</>
          )}
        </span>
      </div>
    </AuthShell>
  );
}
