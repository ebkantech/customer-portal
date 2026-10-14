"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, checkSession, getInviteToken } from "@/lib/api";
import { AuthShell, StateAlert } from "./AuthShell";

type GateState = "checking" | "no_invite" | "unavailable";
type Ended = null | "session" | "rental";

/**
 * Entry point for "/portal" ("/" is the public welcome page). Never shows protected data itself:
 *  - a session Django confirms via /portal/me/ goes to the dashboard;
 *  - otherwise a remembered invitation goes to its OTP form (/portal/<token>);
 *  - otherwise the customer is asked to open their CRM invitation link.
 * Each step re-checks with the server, so no route can loop back into another.
 */
export function PortalGate() {
  const router = useRouter();
  const [state, setState] = useState<GateState>("checking");
  const [ended, setEnded] = useState<Ended>(null);

  const run = useCallback(async () => {
    setState("checking");
    const session = await checkSession();
    if (session.state === "valid") {
      router.replace("/portal/dashboard");
      return;
    }
    if (session.state === "unavailable") {
      // can't confirm either way: show neither the dashboard nor a false "signed out"
      setState("unavailable");
      return;
    }
    if (session.state === "ended")
      setEnded(
        session.error instanceof ApiError &&
          session.error.code === "rental_access_ended"
          ? "rental"
          : "session",
      );
    const invite = getInviteToken();
    if (invite) {
      router.replace(`/portal/${encodeURIComponent(invite)}`);
      return;
    }
    setState("no_invite");
  }, [router]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <AuthShell>
      {state === "checking" && (
        <>
          <h2>Opening your portal</h2>
          <div className="notice notice-inline" role="status">
            <span className="spinner spinner-dark" aria-hidden="true" />
            Checking your secure session…
          </div>
        </>
      )}

      {state === "unavailable" && (
        <>
          <h2>Opening your portal</h2>
          <StateAlert title="We couldn't confirm your session" tone="warning">
            <span>
              The portal service didn&apos;t respond. Check your connection and
              try again.
            </span>
            <button
              type="button"
              className="button button-outline state-action"
              onClick={() => void run()}
            >
              Try again
            </button>
          </StateAlert>
        </>
      )}

      {state === "no_invite" && (
        <>
          <h2>Open your invitation link</h2>
          <p className="muted">
            For your security, the customer portal opens only from the personal
            invitation link our team sent you. Open that link to receive and
            enter your one-time verification code.
          </p>
          {ended && (
            <div className="alert warn-alert" role="status">
              <strong>
                {ended === "rental"
                  ? "Your rental portal access has ended"
                  : "Your session has ended"}
              </strong>
              <span>
                {ended === "rental"
                  ? "Portal access for rental customers ends when the rental tenure ends."
                  : "Please sign in again from your invitation link."}
              </span>
            </div>
          )}
          <div className="notice gate-help">
            Can&apos;t find your link, or has it expired? Contact our team and
            ask for a new customer portal invitation.
          </div>
        </>
      )}

      <div className="privacy-note">
        <span aria-hidden="true">▣</span>
        <span className="privacy-text">
          Your account is protected with one-time verification.
        </span>
      </div>
    </AuthShell>
  );
}
