import type { NextConfig } from "next";

/*
 * Repair and lead approvals and staff password setup are pages of the CRM
 * app, but Django builds every customer link on PUBLIC_FRONTEND_URL, which is
 * this portal. Send those links on to the CRM. Production must set
 * CRM_APP_URL; without it the routes stay unhandled rather than pointing at
 * a local address.
 */
const CRM_APP_URL = (
  process.env.CRM_APP_URL || (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:8000")
).replace(/\/+$/, "");

const CRM_ROUTES = [
  "/repair-approval/:token",
  "/repair-order-approval/:token",
  "/lead-approval/:token",
  "/set-password/:uid/:token",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    if (!CRM_APP_URL) return [];
    return CRM_ROUTES.map((source) => ({ source, destination: `${CRM_APP_URL}${source}`, permanent: false }));
  },
};

export default nextConfig;
