"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { LoadingState, StateCard } from "@/app/components/approval/shared";

/*
 * Staff password setup, opened from the one-time link an administrator
 * creates in the CRM (Staff management > Reset password, or a new account's
 * setup link): /set-password/<uidb64>/<token>, built by
 * accounts.staff.setup_link.
 *
 * GET  /api/auth/password-setup/<uid>/<token>/ -> {valid, username, first_name}
 * POST same URL {new_password, confirm_password} -> {detail}
 *
 * Django (accounts.views.PasswordSetupView) does all the real checking: the
 * account comes only from the verified link, the token is single-use (bound to
 * the password hash) and expires after 24 hours, and the password goes
 * through AUTH_PASSWORD_VALIDATORS. Invalid, expired and already-used links
 * all get the same 400 {valid: false}, deliberately indistinguishable.
 * Passwords are only ever sent in a POST body and never stored or logged here.
 */

type State =
  | { kind: "checking" }
  | { kind: "ready"; username: string; firstName: string }
  | { kind: "invalid"; detail: string }
  | { kind: "error"; message: string }
  | { kind: "done" };

type FieldErrors = { new_password?: string[]; confirm_password?: string; form?: string };

/** Django's settings.AUTH_PASSWORD_VALIDATORS MinimumLengthValidator. Only a hint: Django decides. */
const MIN_LENGTH = 10;
const INVALID_LINK = "This link is invalid, has already been used, or has expired. Ask your administrator for a new one.";
const CRM_URL = (process.env.NEXT_PUBLIC_CRM_APP_URL || "").replace(/\/+$/, "");

/** urlsafe_base64_encode(pk) and PasswordResetTokenGenerator's "<ts36>-<hash>"; anything else is never sent. */
function looksValid(uid: string, token: string) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(uid) && /^[0-9a-z]{1,13}-[0-9a-f]{10,128}$/.test(token);
}

function asList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === "string" && !!v);
}

function throttledMessage(e: ApiError) {
  const wait = e.retryAfter ? ` Please wait ${e.retryAfter < 90 ? `${e.retryAfter} seconds` : `${Math.ceil(e.retryAfter / 60)} minutes`}` : " Please wait a minute";
  return `Too many attempts from this connection.${wait} and try again.`;
}

export default function SetPasswordPage() {
  const params = useParams<{ uid: string; token: string }>();
  const uid = decodeURIComponent(params.uid || "");
  const token = decodeURIComponent(params.token || "");
  const path = `/auth/password-setup/${encodeURIComponent(uid)}/${encodeURIComponent(token)}/`;
  const [state, setState] = useState<State>({ kind: "checking" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const ids = useId();

  const check = useCallback(async () => {
    if (!looksValid(uid, token)) {
      setState({ kind: "invalid", detail: INVALID_LINK });
      return;
    }
    setState({ kind: "checking" });
    try {
      const data = await api<{ valid?: boolean; username?: string; first_name?: string }>(path, {}, false);
      if (data.valid !== true) setState({ kind: "invalid", detail: INVALID_LINK });
      else setState({ kind: "ready", username: data.username || "", firstName: data.first_name || "" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setState({ kind: "invalid", detail: asList(e.data.detail)[0] || INVALID_LINK });
      else if (e instanceof ApiError && e.status === 429) setState({ kind: "error", message: throttledMessage(e) });
      else if (e instanceof ApiError && e.status === 0)
        setState({ kind: "error", message: "We couldn't reach our server. Check your internet connection and try again." });
      else setState({ kind: "error", message: "We couldn't check your link right now. Please try again in a moment." });
    }
  }, [uid, token, path]);

  useEffect(() => {
    void check();
  }, [check]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    // quick checks so obvious mistakes don't cost a round trip; Django re-validates everything
    if (!password) {
      setErrors({ new_password: ["Enter a new password."] });
      newRef.current?.focus();
      return;
    }
    if (password.length < MIN_LENGTH) {
      setErrors({ new_password: [`Use at least ${MIN_LENGTH} characters.`] });
      newRef.current?.focus();
      return;
    }
    if (password !== confirm) {
      setErrors({ confirm_password: "The two passwords don't match." });
      confirmRef.current?.focus();
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setErrors({});
    try {
      await api<{ detail?: string }>(
        path,
        { method: "POST", body: JSON.stringify({ new_password: password, confirm_password: confirm }) },
        false,
      );
      setPassword("");
      setConfirm("");
      setState({ kind: "done" });
      window.setTimeout(() => doneRef.current?.focus(), 0);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        if (err.data.valid === false) {
          setState({ kind: "invalid", detail: asList(err.data.detail)[0] || INVALID_LINK });
        } else {
          const next: FieldErrors = {
            new_password: asList(err.data.new_password),
            confirm_password: asList(err.data.confirm_password)[0],
            form: asList(err.data.detail)[0] || asList(err.data.non_field_errors)[0],
          };
          if (!next.new_password?.length && !next.confirm_password && !next.form) next.form = err.message;
          setErrors(next);
          if (next.new_password?.length) newRef.current?.focus();
          else if (next.confirm_password) confirmRef.current?.focus();
        }
      } else if (err instanceof ApiError && err.status === 429) {
        setErrors({ form: throttledMessage(err) });
      } else if (err instanceof ApiError && err.status === 0) {
        setErrors({ form: "We couldn't reach our server, so your password was not changed. Check your connection and try again." });
      } else {
        setErrors({ form: "Something went wrong, so your password was not changed. Please try again." });
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const newErrId = `${ids}-new-error`;
  const confirmErrId = `${ids}-confirm-error`;
  const hintId = `${ids}-hint`;

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
              <small>Staff account</small>
            </span>
          </div>
          <span className="ra-secure">
            <span className="ra-secure-dot" aria-hidden="true" />
            Secure one-time link
          </span>
        </div>
      </header>

      <main className="ra-main" id="main">
        <div className="ap-narrow">
          <div className="ra-title-row">
            <div>
              <p className="ra-eyebrow">CRM account</p>
              <h1>Set your password</h1>
            </div>
          </div>

          {state.kind === "checking" && <LoadingState label="Checking your link" />}

          {state.kind === "invalid" && (
            <StateCard tone="warning" title="This link can't be used">
              <p>{state.detail}</p>
            </StateCard>
          )}

          {state.kind === "error" && (
            <StateCard tone="error" title="We couldn't check your link">
              <p>{state.message}</p>
              <button type="button" className="ra-btn ra-btn-secondary" onClick={() => void check()}>
                Try again
              </button>
            </StateCard>
          )}

          {state.kind === "done" && (
            <div ref={doneRef} tabIndex={-1} className="ra-banner ra-banner-success" role="status">
              <span className="ra-banner-icon" aria-hidden="true">
                ✓
              </span>
              <div>
                <h2>Password set</h2>
                <p>Your password has been set. You can now sign in with it. This link can&apos;t be used again.</p>
                {CRM_URL && (
                  <div className="ap-success-actions" style={{ marginTop: 14 }}>
                    <a className="ra-btn ra-btn-primary" href={`${CRM_URL}/`}>
                      Go to sign in
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {state.kind === "ready" && (
            <section className="ra-card" aria-labelledby={`${ids}-title`}>
              <h2 id={`${ids}-title`}>Choose a new password</h2>
              <p className="ap-account">
                {state.firstName ? `Hi ${state.firstName}, this` : "This"} is for the account <strong>{state.username}</strong>. The link works
                once and expires 24 hours after it was created.
              </p>
              {/* method="post": without JavaScript the browser must never put passwords in the URL */}
              <form className="ap-form" method="post" onSubmit={submit} noValidate>
                {/* lets password managers save the new password against the right account */}
                <input
                  className="ap-visually-hidden-input"
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={state.username}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                />
                {errors.form && (
                  <p className="ra-alert ra-alert-error" role="alert" style={{ margin: 0 }}>
                    {errors.form}
                  </p>
                )}
                <div className="ap-field">
                  <label className="ra-label" htmlFor={`${ids}-new`} style={{ margin: 0 }}>
                    New password
                  </label>
                  <div className="ap-input-wrap">
                    <input
                      ref={newRef}
                      id={`${ids}-new`}
                      className="ap-input"
                      type={show ? "text" : "password"}
                      name="new_password"
                      autoComplete="new-password"
                      autoFocus
                      value={password}
                      disabled={saving}
                      aria-invalid={errors.new_password?.length ? true : undefined}
                      aria-describedby={`${hintId}${errors.new_password?.length ? ` ${newErrId}` : ""}`}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (errors.new_password || errors.form) setErrors((x) => ({ ...x, new_password: undefined, form: undefined }));
                      }}
                    />
                    <button
                      type="button"
                      className="ap-toggle"
                      onClick={() => setShow((s) => !s)}
                      aria-pressed={show}
                      aria-label={show ? "Hide passwords" : "Show passwords"}
                    >
                      {show ? "Hide" : "Show"}
                    </button>
                  </div>
                  <p id={hintId} className="ap-hint">
                    At least {MIN_LENGTH} characters. Avoid common passwords, all-number passwords and anything close to your username.
                  </p>
                  {!!errors.new_password?.length && (
                    <div id={newErrId} role="alert">
                      {errors.new_password.map((m) => (
                        <p key={m} className="ra-field-error" style={{ margin: "2px 0 0" }}>
                          {m}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="ap-field">
                  <label className="ra-label" htmlFor={`${ids}-confirm`} style={{ margin: 0 }}>
                    Confirm new password
                  </label>
                  <div className="ap-input-wrap">
                    <input
                      ref={confirmRef}
                      id={`${ids}-confirm`}
                      className="ap-input"
                      type={show ? "text" : "password"}
                      name="confirm_password"
                      autoComplete="new-password"
                      value={confirm}
                      disabled={saving}
                      aria-invalid={errors.confirm_password ? true : undefined}
                      aria-describedby={errors.confirm_password ? confirmErrId : undefined}
                      onChange={(e) => {
                        setConfirm(e.target.value);
                        if (errors.confirm_password || errors.form) setErrors((x) => ({ ...x, confirm_password: undefined, form: undefined }));
                      }}
                    />
                  </div>
                  {errors.confirm_password && (
                    <p id={confirmErrId} className="ra-field-error" role="alert" style={{ margin: "2px 0 0" }}>
                      {errors.confirm_password}
                    </p>
                  )}
                </div>

                <button type="submit" className="ra-btn ra-btn-primary" disabled={saving} aria-busy={saving}>
                  {saving ? (
                    <>
                      <span className="ra-spinner" aria-hidden="true" /> Saving…
                    </>
                  ) : (
                    "Set password"
                  )}
                </button>
              </form>
            </section>
          )}
        </div>
      </main>

      <footer className="ra-footer">
        <span>© {new Date().getFullYear()} Vantage Computers</span>
        <span>Never share this link or your password with anyone.</span>
      </footer>
    </div>
  );
}
