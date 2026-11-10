import type { Metadata } from "next";
// Same design system as the customer approval pages (ra- prefix).
import "../rental-approval/rental-approval.css";
import "@/app/components/approval/approval.css";

// The URL carries a one-time password-setup token: keep it out of search
// indexes and out of Referer headers (e.g. the web-font request).
export const metadata: Metadata = {
  title: "Set Your Password | Vantage Computers",
  description: "Choose a password for your Vantage Computers CRM account.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function SetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
