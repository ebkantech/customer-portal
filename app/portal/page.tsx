import { PortalGate } from "@/app/components/PortalGate";

/** "/portal" -- dashboard for a verified session, otherwise the remembered invitation's OTP form. */
export default function PortalIndexPage() {
  return <PortalGate />;
}
