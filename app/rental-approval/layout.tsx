import type { Metadata } from "next";
import "./rental-approval.css";

// The URL carries the approval token (a bearer credential): keep it out of
// search indexes and out of Referer headers (e.g. the web-font request).
export const metadata: Metadata = {
  title: "Rental Agreement Review | Vantage Computers",
  description: "Review and respond to your rental agreement.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function RentalApprovalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
