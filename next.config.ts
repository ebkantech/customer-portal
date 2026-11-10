import type { NextConfig } from "next";

/*
 * Django builds every customer and staff link on PUBLIC_FRONTEND_URL, which is
 * this portal, and every one of those pages is now served here:
 *   /portal/[token]                    customer portal invitation
 *   /rental-approval/[token]           rental agreement
 *   /repair-approval/[token]           single-device repair estimate
 *   /repair-order-approval/[token]     bulk repair order
 *   /lead-approval/[token]             on-site service bill
 *   /set-password/[uid]/[token]        staff password setup / reset
 * so nothing is redirected to the CRM app any more.
 *
 * NEXT_PUBLIC_CRM_APP_URL is the staff CRM frontend (the Vite app, which shows
 * its sign-in screen at "/"). It is only used for the "Go to sign in" button
 * after a staff member sets their password, and is inlined into the browser
 * bundle at build time -- restart `next dev` / rebuild after changing it.
 * Local default: the Vite dev server on http://localhost:5173. In production it
 * must be set explicitly; without it the button is hidden rather than pointing
 * at a local address. It is never the Django API: a value on the same origin as
 * NEXT_PUBLIC_API_BASE_URL is ignored.
 */
function origin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function crmAppUrl() {
  const configured = (
    process.env.NEXT_PUBLIC_CRM_APP_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:5173")
  ).replace(/\/+$/, "");
  const apiOrigin = origin(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000/api");
  if (!configured || !origin(configured)) return "";
  if (origin(configured) === apiOrigin) {
    console.warn(`NEXT_PUBLIC_CRM_APP_URL (${configured}) is the Django API origin, not the CRM frontend; "Go to sign in" is hidden.`);
    return "";
  }
  return configured;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_CRM_APP_URL: crmAppUrl(),
  },
};

export default nextConfig;
