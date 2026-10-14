"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "/" -- the public welcome page. It always renders, whatever session or
 * invitation is stored in this browser, and never redirects on its own: a
 * customer gets in only by continuing with an invitation link, which then
 * runs that invitation's own OTP flow.
 */
export default function HomePage() {
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  function openInvite(e: FormEvent) {
    e.preventDefault();
    const value = invite.trim();
    if (!value) {
      setError("Paste the portal invite link or its token.");
      return;
    }
    let token = value;
    try {
      if (/^https?:\/\//i.test(value)) {
        const url = new URL(value);
        const parts = url.pathname.split("/").filter(Boolean);
        const portalIndex = parts.lastIndexOf("portal");
        if (portalIndex >= 0 && parts[portalIndex + 1])
          token = parts[portalIndex + 1];
        else token = parts[parts.length - 1] || value;
      } else if (value.includes("/")) {
        const parts = value.split("/").filter(Boolean);
        const portalIndex = parts.lastIndexOf("portal");
        token =
          portalIndex >= 0 && parts[portalIndex + 1]
            ? parts[portalIndex + 1]
            : parts[parts.length - 1];
      }
    } catch {
      /* Treat input as the raw token. */
    }
    if (!token || token === "portal") {
      setError("That link does not look valid. Please check it and try again.");
      return;
    }
    router.push(`/portal/${encodeURIComponent(token)}`);
  }
  return (
    <main className="welcome-page">
      <div className="welcome-card">
        <div className="brand-mark">
          V<span>+</span>
        </div>
        <p className="eyebrow">VANTAGE COMPUTERS · CUSTOMER SERVICES</p>
        <h1>
          Your account.
          <br />
          <em>All in one place.</em>
        </h1>
        <p className="welcome-copy">
          View your purchases, rental details, invoices, repairs and warranty
          information through your secure customer portal.
        </p>
        <div className="welcome-note">
          <span className="secure-dot" /> Secure access is available through the
          personal portal link sent by our team.
        </div>
        <form onSubmit={openInvite} className="invite-entry">
          <label htmlFor="invite-link">Have a portal invitation?</label>
          <input
            id="invite-link"
            value={invite}
            onChange={(e) => {
              setInvite(e.target.value);
              setError("");
            }}
            placeholder="Paste your portal link or token"
            autoComplete="url"
          />
          {error && <p className="invite-error">{error}</p>}
          <button className="button button-primary full-button" type="submit">
            Continue to secure login →
          </button>
        </form>
        <p className="fine-print">
          For your privacy, portal access requires a one-time code sent to your
          registered email.
        </p>
      </div>
      <div className="welcome-side">
        <div className="side-orbit orbit-one" />
        <div className="side-orbit orbit-two" />
        <div className="side-copy">
          <span className="side-label">CUSTOMER PORTAL</span>
          <h2>
            Better visibility.
            <br />
            Less back and forth.
          </h2>
          <p>Your customer information, whenever you need it.</p>
        </div>
        <div className="side-footer">
          SECURE ACCESS <span>•</span> CUSTOMER FIRST
        </div>
      </div>
    </main>
  );
}
