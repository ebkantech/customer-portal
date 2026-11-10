import type { Metadata } from "next";
// Same customer-review design system as the rental agreement page (ra- prefix).
import "../rental-approval/rental-approval.css";
import "@/app/components/approval/approval.css";

// The URL carries the approval token (a bearer credential): keep it out of
// search indexes and out of Referer headers (e.g. the web-font request).
export const metadata: Metadata = {
  title: "Repair Estimate Review | Vantage Computers",
  description: "Review and respond to your repair estimate.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function RepairApprovalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
