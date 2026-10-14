import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Customer Portal | Vantage Computers",
  description: "Secure customer portal for purchases, rentals, invoices, repairs and warranties.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
