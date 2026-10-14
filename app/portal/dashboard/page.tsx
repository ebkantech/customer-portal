"use client";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ACCOUNT_LABELS,
  AccountType,
  api,
  ApiError,
  clearSession,
  formatDate,
  formatMoney,
  getAccessLogId,
  getAccountType,
  getInviteToken,
  getSession,
  Invoice,
  isAuthError,
  isInvoiceOutstanding,
  Party,
  Rental,
  RepairResponse,
  Warranty,
} from "@/lib/api";
import { InvoiceSection } from "@/app/components/InvoiceSection";
import { Empty, ProfileRow, Section, SectionError, SkeletonRows, StatCard, Status } from "@/app/components/ui";

type Tab = "overview" | "rentals" | "purchases" | "invoices" | "repairs" | "warranties" | "feedback";
type NavItem = { id: Tab; label: string; icon: string };
type SectionKey = "invoices" | "rentals" | "repairs" | "warranties";
type Ended = { title: string; text: string };

/** Navigation per account type. Rentals appear only for Rental accounts (or, neutrally labelled, when the backend returned rental records for an account of unknown type). */
function navFor(type: AccountType, hasRentals: boolean): NavItem[] {
  const tail: NavItem[] = [
    { id: "invoices", label: "Invoices", icon: "▤" },
    { id: "repairs", label: "Repairs", icon: "⚒" },
    { id: "warranties", label: "Warranties", icon: "◇" },
    { id: "feedback", label: "Feedback", icon: "☆" },
  ];
  const overview: NavItem = { id: "overview", label: "Overview", icon: "◫" };
  if (type === "rental") return [overview, { id: "rentals", label: "My rentals", icon: "↻" }, ...tail];
  if (type === "dealer") return [overview, { id: "purchases", label: "Orders & purchases", icon: "▦" }, ...tail];
  if (type === "retail") return [overview, { id: "purchases", label: "Purchases", icon: "▣" }, ...tail];
  return hasRentals ? [overview, { id: "rentals", label: "Rental agreements", icon: "↻" }, ...tail] : [overview, ...tail];
}

const ACCOUNT_COPY: Record<AccountType, { icon: string; intro: string; invoicesEmpty: string }> = {
  rental: {
    icon: "↻",
    intro: "Your rental agreements, payments and invoices in one place.",
    invoicesEmpty: "Rent and other invoices for your account will appear here once they are raised.",
  },
  dealer: {
    icon: "▦",
    intro: "Your dealer orders, invoices and service records.",
    invoicesEmpty: "Invoices for your dealer orders will appear here once they are raised.",
  },
  retail: {
    icon: "▣",
    intro: "Your purchases, invoices, repairs and warranties.",
    invoicesEmpty: "Invoices for your purchases will appear here once they are raised.",
  },
  unknown: {
    icon: "◫",
    intro: "Here's the latest overview of your account and services.",
    invoicesEmpty: "Invoices linked to your account will appear here once they are raised.",
  },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function asList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const results = (data as { results?: unknown } | null)?.results;
  if (Array.isArray(results)) return results as T[];
  throw new Error("The server returned an unexpected response.");
}

function asRepairs(data: unknown): RepairResponse {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("The server returned an unexpected response.");
  const d = data as RepairResponse;
  return { tickets: Array.isArray(d.tickets) ? d.tickets : [], invoices: Array.isArray(d.invoices) ? d.invoices : [] };
}

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Section<Party>>({ state: "loading" });
  const [invoices, setInvoices] = useState<Section<Invoice[]>>({ state: "loading" });
  const [rentals, setRentals] = useState<Section<Rental[]>>({ state: "loading" });
  const [repairs, setRepairs] = useState<Section<RepairResponse>>({ state: "loading" });
  const [warranties, setWarranties] = useState<Section<Warranty[]>>({ state: "loading" });
  const [ended, setEnded] = useState<Ended | null>(null);
  // "checking" until a stored session exists; the dashboard frame never renders without one.
  // The session itself is only trusted once /portal/me/ succeeds (see load()).
  const [gate, setGate] = useState<"checking" | "ok" | "signed_out">("checking");
  const [tab, setTab] = useState<Tab>("overview");
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const accountTypeRef = useRef<AccountType>("unknown");

  /**
   * The backend rejected the session (401/403): expired token, revoked access,
   * or -- for Rental customers -- the qualifying rental tenure has ended.
   * Clear local state and say so instead of silently bouncing.
   */
  const endSession = useCallback((e: unknown) => {
    clearSession();
    const code = e instanceof ApiError ? e.code : undefined;
    if (code === "rental_access_ended")
      setEnded({
        title: "Your rental portal access has ended",
        text: "Portal access for rental customers ends when the rental tenure ends. Please contact our team if you think this is a mistake.",
      });
    else
      setEnded({
        title: "Your session has ended",
        text:
          accountTypeRef.current === "rental"
            ? "Please open your invitation link again and verify with a new code. If your rental tenure has ended, portal access ends with it — contact our team for help."
            : "For your security, please open your invitation link again and verify with a new code.",
      });
  }, []);

  const loadSection = useCallback(
    async (key: SectionKey) => {
      const run = async <T,>(path: string, set: (s: Section<T>) => void, parse: (d: unknown) => T) => {
        set({ state: "loading" });
        try {
          set({ state: "ready", data: parse(await api<unknown>(path)) });
        } catch (e) {
          if (isAuthError(e)) endSession(e);
          else set({ state: "error", error: e instanceof Error && e.message ? e.message : "Could not load this section." });
        }
      };
      if (key === "invoices") return run("/portal/invoices/", setInvoices, asList<Invoice>);
      if (key === "rentals") return run("/portal/rentals/", setRentals, asList<Rental>);
      if (key === "repairs") return run("/portal/repairs/", setRepairs, asRepairs);
      return run("/portal/warranties/", setWarranties, asList<Warranty>);
    },
    [endSession],
  );

  const load = useCallback(async () => {
    if (!getSession()) {
      // "/" sends the customer to their invitation's OTP form (or explains how to get one)
      setGate("signed_out");
      router.replace("/");
      return;
    }
    setGate("ok");
    setMe({ state: "loading" });
    let party: Party;
    try {
      party = await api<Party>("/portal/me/");
    } catch (e) {
      if (isAuthError(e)) endSession(e);
      else setMe({ state: "error", error: e instanceof Error && e.message ? e.message : "Unable to load your portal." });
      return;
    }
    const type = getAccountType(party);
    accountTypeRef.current = type;
    setMe({ state: "ready", data: party });
    const keys: SectionKey[] = ["invoices", "repairs", "warranties"];
    // Dealer/Retail accounts never request or show rental records.
    if (type === "rental" || type === "unknown") keys.push("rentals");
    else setRentals({ state: "ready", data: [] });
    await Promise.all(keys.map((k) => loadSection(k)));
  }, [router, endSession, loadSection]);

  useEffect(() => {
    void load();
  }, [load]);

  const party = me.state === "ready" ? me.data : null;
  const accountType = getAccountType(party);
  const copy = ACCOUNT_COPY[accountType];
  const rentalList = rentals.state === "ready" ? rentals.data : [];
  const invoiceList = invoices.state === "ready" ? invoices.data : [];
  const nav = useMemo(() => navFor(accountType, rentalList.length > 0), [accountType, rentalList.length]);
  const activeTab = nav.some((n) => n.id === tab) ? tab : "overview";
  const activeLabel = nav.find((n) => n.id === activeTab)?.label || "Overview";

  const outstanding = invoiceList.filter((inv) => isInvoiceOutstanding(inv.status));
  const outstandingTotal = outstanding.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);
  const currency = invoiceList.find((inv) => inv.currency)?.currency || undefined;
  const unitsPurchased = invoiceList.reduce(
    (sum, inv) => sum + (inv.items || []).reduce((n, item) => n + (Number(item.qty) || 0), 0),
    0,
  );
  const nextPayment = rentalList
    .filter((r) => r.next_payment_date)
    .sort((a, b) => String(a.next_payment_date).localeCompare(String(b.next_payment_date)))[0];
  const ticketList = repairs.state === "ready" ? repairs.data.tickets || [] : [];
  const repairInvoices = repairs.state === "ready" ? repairs.data.invoices || [] : [];
  const warrantyList = warranties.state === "ready" ? warranties.data : [];

  function logout() {
    clearSession();
    router.replace("/");
  }

  function selectTab(id: Tab) {
    setTab(id);
    setMobileNav(false);
  }

  async function shareLocation() {
    if (!navigator.geolocation) {
      setLocationMessage("Location sharing is not supported by this browser.");
      return;
    }
    setLocationBusy(true);
    setLocationMessage("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await api("/portal/location/", {
            method: "POST",
            body: JSON.stringify({
              access_log_id: getAccessLogId(),
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            }),
          });
          setLocationMessage("Location shared successfully.");
        } catch (e) {
          if (isAuthError(e)) {
            endSession(e);
            return;
          }
          setLocationMessage(e instanceof Error ? e.message : "Could not share location.");
        } finally {
          setLocationBusy(false);
        }
      },
      () => {
        setLocationMessage("Location was not shared. You can continue using your portal normally.");
        setLocationBusy(false);
      },
      { timeout: 10000 },
    );
  }

  async function sendFeedback(e: FormEvent) {
    e.preventDefault();
    if (feedbackBusy) return;
    setFeedbackBusy(true);
    setFeedbackMessage(null);
    try {
      await api("/portal/feedback/", {
        method: "POST",
        body: JSON.stringify({ rating: feedbackRating, comment: feedbackComment.trim() }),
      });
      setFeedbackMessage({ ok: true, text: "Thank you. Your feedback has been submitted." });
      setFeedbackComment("");
    } catch (err) {
      if (isAuthError(err)) {
        endSession(err);
        return;
      }
      setFeedbackMessage({ ok: false, text: err instanceof Error ? err.message : "Could not send feedback." });
    } finally {
      setFeedbackBusy(false);
    }
  }

  if (ended)
    return (
      <main className="ended-page">
        <div className="ended-card" role="alert">
          <div className="brand-mark">
            V<span>+</span>
          </div>
          <p className="eyebrow">SECURE CUSTOMER PORTAL</p>
          <h1>{ended.title}</h1>
          <p className="muted">{ended.text}</p>
          <button
            type="button"
            className="button button-primary full-button"
            onClick={() => {
              // back to this customer's own invitation (its OTP form), else the welcome page
              const invite = getInviteToken();
              router.replace(invite ? `/portal/${encodeURIComponent(invite)}` : "/");
            }}
          >
            Sign in again
          </button>
        </div>
      </main>
    );

  if (gate !== "ok")
    return (
      <main className="ended-page">
        <div className="ended-card" role="status">
          <div className="brand-mark">
            V<span>+</span>
          </div>
          <p className="eyebrow">SECURE CUSTOMER PORTAL</p>
          <p className="notice notice-inline">
            <span className="spinner spinner-dark" aria-hidden="true" />
            {gate === "signed_out" ? "Taking you to sign in…" : "Opening your portal…"}
          </p>
        </div>
      </main>
    );

  const invoiceSection = (limit?: number) => (
    <InvoiceSection
      invoices={invoices}
      onRetry={() => void loadSection("invoices")}
      onAuthError={endSession}
      limit={limit}
      emptyText={copy.invoicesEmpty}
    />
  );

  return (
    <div className="dashboard-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`} aria-label="Portal navigation">
        <a href="/portal/dashboard" className="sidebar-brand">
          <div className="brand-mark small-mark">
            V<span>+</span>
          </div>
          <span>
            <strong>VANTAGE</strong>
            <small>COMPUTERS</small>
          </span>
        </a>
        <div className="sidebar-label">{me.state === "ready" ? ACCOUNT_LABELS[accountType].toUpperCase() : "CUSTOMER SPACE"}</div>
        <nav>
          {nav.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => selectTab(item.id)}
              className={`nav-link ${activeTab === item.id ? "active" : ""}`}
              aria-current={activeTab === item.id ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
              {activeTab === item.id && <span className="nav-active-dot" aria-hidden="true" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-symbol" aria-hidden="true">
              ?
            </span>
            <strong>Need assistance?</strong>
            <p>Contact our team for help with your account.</p>
          </div>
          <button type="button" className="nav-link signout" onClick={logout}>
            <span className="nav-icon" aria-hidden="true">
              ↪
            </span>
            Sign out
          </button>
          <div className="sidebar-foot">
            SECURE CUSTOMER PORTAL <span>v1.0</span>
          </div>
        </div>
      </aside>
      {mobileNav && <button type="button" className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <main className="dashboard-main">
        <header className="topbar">
          <button
            type="button"
            className="mobile-menu"
            onClick={() => setMobileNav(!mobileNav)}
            aria-label="Toggle menu"
            aria-expanded={mobileNav}
          >
            ☰
          </button>
          <div>
            <div className="breadcrumb">
              CUSTOMER SPACE <span>/</span> {activeLabel.toUpperCase()}
            </div>
            <h1>{activeTab === "overview" ? "Your dashboard" : activeLabel}</h1>
          </div>
          <div className="topbar-right">
            <span className="secure-pill">
              <i /> Secure session
            </span>
            <div className="avatar" aria-hidden="true">
              {(party?.name || "C").trim().charAt(0).toUpperCase()}
            </div>
          </div>
        </header>
        <div className="dashboard-content">
          {me.state === "loading" ? (
            <div role="status" aria-label="Loading your account">
              <div className="skeleton skeleton-banner" />
              <div className="stat-grid">
                {[0, 1, 2, 3].map((i) => (
                  <div className="stat-card" key={i}>
                    <span className="skeleton skeleton-icon" />
                    <span className="skeleton skeleton-line" />
                    <span className="skeleton skeleton-stat" />
                  </div>
                ))}
              </div>
            </div>
          ) : me.state === "error" ? (
            <div className="empty-state error-state" role="alert">
              <div className="empty-icon" aria-hidden="true">
                !
              </div>
              <h3>We couldn’t load your account</h3>
              <p>{me.error}</p>
              <button type="button" className="button button-primary" onClick={() => void load()}>
                Try again
              </button>
            </div>
          ) : (
            <>
              <section className="welcome-banner">
                <div className="welcome-banner-copy">
                  <span className="banner-kicker">
                    <span /> YOUR CUSTOMER ACCOUNT
                  </span>
                  <h2>Good to see you, {party?.name?.split(" ")[0] || "there"}.</h2>
                  <p>{copy.intro}</p>
                  <div className={`account-type account-${accountType}`}>
                    <span className="type-icon" aria-hidden="true">
                      {copy.icon}
                    </span>
                    <span>
                      <small>ACCOUNT TYPE</small>
                      <strong>{ACCOUNT_LABELS[accountType]}</strong>
                    </span>
                  </div>
                  {accountType === "rental" && party?.portal_access_ends_at && (
                    <p className="access-until">Portal access until {formatDate(party.portal_access_ends_at)}</p>
                  )}
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="art-ring ring-a" />
                  <div className="art-ring ring-b" />
                  <div className="art-square">
                    V<span>+</span>
                  </div>
                  <div className="art-chip">
                    ACCOUNT
                    <br />
                    OVERVIEW <span>↗</span>
                  </div>
                </div>
              </section>

              {activeTab === "overview" && (
                <>
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">ACCOUNT SNAPSHOT</span>
                      <h2>Your account at a glance</h2>
                    </div>
                    <span className="updated-label">
                      <span /> Connected to CRM
                    </span>
                  </div>
                  <div className="stat-grid">
                    {accountType === "rental" ? (
                      <>
                        <StatCard label="Rental agreements" value={rentalList.length} note="On your account" icon="↻" tone="green" loading={rentals.state === "loading"} />
                        <StatCard
                          label="Next payment"
                          value={nextPayment ? formatDate(nextPayment.next_payment_date) : "—"}
                          note={nextPayment?.next_payment_overdue ? "Overdue" : nextPayment ? "Upcoming rent" : "Nothing scheduled"}
                          icon="◷"
                          tone="amber"
                          loading={rentals.state === "loading"}
                        />
                        <StatCard label="Outstanding invoices" value={outstanding.length} note="Awaiting payment" icon="▤" tone="blue" loading={invoices.state === "loading"} />
                        <StatCard label="Amount outstanding" value={formatMoney(outstandingTotal, currency)} note="Across unpaid invoices" icon="◈" tone="purple" loading={invoices.state === "loading"} />
                      </>
                    ) : accountType === "dealer" ? (
                      <>
                        <StatCard label="Orders" value={invoiceList.length} note="Invoiced orders" icon="▦" tone="blue" loading={invoices.state === "loading"} />
                        <StatCard label="Units purchased" value={unitsPurchased} note="Across all orders" icon="▣" tone="green" loading={invoices.state === "loading"} />
                        <StatCard label="Outstanding invoices" value={outstanding.length} note="Awaiting payment" icon="▤" tone="amber" loading={invoices.state === "loading"} />
                        <StatCard label="Amount outstanding" value={formatMoney(outstandingTotal, currency)} note="Across unpaid invoices" icon="◈" tone="purple" loading={invoices.state === "loading"} />
                      </>
                    ) : (
                      <>
                        <StatCard label={accountType === "retail" ? "Purchases" : "Invoices"} value={invoiceList.length} note="Invoiced purchases" icon="▤" tone="blue" loading={invoices.state === "loading"} />
                        <StatCard label="Outstanding invoices" value={outstanding.length} note="Awaiting payment" icon="◈" tone="amber" loading={invoices.state === "loading"} />
                        <StatCard label="Repair tickets" value={ticketList.length} note="Service history" icon="⚒" tone="purple" loading={repairs.state === "loading"} />
                        <StatCard label="Warranties" value={warrantyList.length} note="Warranty records" icon="◇" tone="green" loading={warranties.state === "loading"} />
                      </>
                    )}
                  </div>

                  {accountType === "rental" && (
                    <section className="content-card overview-rentals">
                      <div className="card-heading">
                        <div>
                          <span className="eyebrow">YOUR RENTALS</span>
                          <h3>Rental agreements</h3>
                        </div>
                        <button type="button" className="text-button" onClick={() => selectTab("rentals")}>
                          View all ↗
                        </button>
                      </div>
                      <RentalList rentals={rentals} limit={2} onRetry={() => void loadSection("rentals")} />
                    </section>
                  )}

                  <div className="content-grid">
                    <section className="content-card">
                      <div className="card-heading">
                        <div>
                          <span className="eyebrow">BILLING</span>
                          <h3>Recent invoices</h3>
                        </div>
                        <button type="button" className="text-button" onClick={() => selectTab("invoices")}>
                          View all ↗
                        </button>
                      </div>
                      {invoiceSection(5)}
                    </section>
                    <section className="content-card profile-card">
                      <div className="card-heading">
                        <div>
                          <span className="eyebrow">YOUR DETAILS</span>
                          <h3>Account profile</h3>
                        </div>
                        <div className="profile-avatar" aria-hidden="true">
                          {(party?.name || "C").trim().charAt(0).toUpperCase()}
                        </div>
                      </div>
                      <ProfileRow label="Full name" value={party?.name} />
                      <ProfileRow label="Account type" value={ACCOUNT_LABELS[accountType]} />
                      <ProfileRow label="Email address" value={party?.email} />
                      <ProfileRow label="Phone number" value={party?.phone} />
                      <ProfileRow label="City" value={party?.city} />
                      {party?.joined && <ProfileRow label="Customer since" value={formatDate(party.joined)} />}
                      <div className="profile-secure">
                        <span aria-hidden="true">✓</span> Verified portal session
                      </div>
                    </section>
                  </div>

                  <section className="content-card service-strip">
                    <div className="service-icon" aria-hidden="true">
                      ⌖
                    </div>
                    <div className="service-copy">
                      <h3>Help us coordinate your service</h3>
                      <p>Optionally share your current location to assist with device pickup or service coordination.</p>
                      {locationMessage && (
                        <p className="inline-message" role="status">
                          {locationMessage}
                        </p>
                      )}
                    </div>
                    <button type="button" className="button button-outline" disabled={locationBusy} onClick={() => void shareLocation()}>
                      {locationBusy ? "Requesting…" : "Share location"}
                    </button>
                  </section>
                </>
              )}

              {activeTab === "rentals" && (
                <section className="content-card">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">RENTAL AGREEMENTS</span>
                      <h3>{accountType === "rental" ? "Your rentals" : "Rental agreements"}</h3>
                    </div>
                    {rentals.state === "ready" && <span className="count-badge">{plural(rentalList.length, "agreement")}</span>}
                  </div>
                  <RentalList rentals={rentals} onRetry={() => void loadSection("rentals")} />
                </section>
              )}

              {activeTab === "purchases" && (
                <section className="content-card">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">{accountType === "dealer" ? "DEALER ORDERS" : "YOUR PURCHASES"}</span>
                      <h3>{accountType === "dealer" ? "Orders & purchased products" : "Products you've purchased"}</h3>
                    </div>
                    {invoices.state === "ready" && <span className="count-badge">{plural(invoiceList.length, "order")}</span>}
                  </div>
                  <PurchaseList invoices={invoices} dealer={accountType === "dealer"} onRetry={() => void loadSection("invoices")} />
                </section>
              )}

              {activeTab === "invoices" && (
                <section className="content-card">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">BILLING & PAYMENTS</span>
                      <h3>Your invoices</h3>
                    </div>
                    {invoices.state === "ready" && <span className="count-badge">{plural(invoiceList.length, "invoice")}</span>}
                  </div>
                  {invoiceSection()}
                </section>
              )}

              {activeTab === "repairs" && (
                <section className="content-card">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">SERVICE & MAINTENANCE</span>
                      <h3>Your repair tickets</h3>
                    </div>
                    {repairs.state === "ready" && <span className="count-badge">{plural(ticketList.length, "ticket")}</span>}
                  </div>
                  {repairs.state === "loading" ? (
                    <SkeletonRows label="Loading repair tickets" />
                  ) : repairs.state === "error" ? (
                    <SectionError message={repairs.error} onRetry={() => void loadSection("repairs")} />
                  ) : ticketList.length ? (
                    <div className="repair-list">
                      {ticketList.map((t) => (
                        <div className="repair-item" key={t.id}>
                          <div className="repair-icon" aria-hidden="true">
                            ⚒
                          </div>
                          <div className="repair-info">
                            <strong>{t.code || `Ticket #${t.id}`}</strong>
                            <p>
                              {[t.brand, t.model_name].filter(Boolean).join(" ") || "Device service"}
                              {t.issue ? ` · ${t.issue}` : ""}
                            </p>
                            {(t.received || t.expected) && (
                              <p>
                                {t.received && `Received ${formatDate(t.received)}`}
                                {t.received && t.expected && " · "}
                                {t.expected && `Expected ${formatDate(t.expected)}`}
                              </p>
                            )}
                          </div>
                          <Status value={t.status || "Open"} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty icon="⚒" title="No repair tickets" text="Any repair requests linked to your account will be listed here." />
                  )}
                  {repairInvoices.length > 0 && (
                    <div className="sub-list">
                      <h4>Service invoices</h4>
                      {repairInvoices.map((inv) => (
                        <div className="simple-row" key={`repair-${inv.id}`}>
                          <span>
                            {inv.code || `INV-${inv.id}`} · {formatDate(inv.date)}
                            {inv.ticket_code ? ` · ${inv.ticket_code}` : ""}
                          </span>
                          <span className="simple-row-end">
                            {inv.status && <Status value={inv.status} />}
                            <strong>{formatMoney(inv.amount)}</strong>
                          </span>
                        </div>
                      ))}
                      <button type="button" className="text-button sub-list-link" onClick={() => selectTab("invoices")}>
                        Download from Invoices ↗
                      </button>
                    </div>
                  )}
                </section>
              )}

              {activeTab === "warranties" && (
                <section className="content-card">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">COVERAGE DETAILS</span>
                      <h3>Warranty records</h3>
                    </div>
                    {warranties.state === "ready" && <span className="count-badge">{plural(warrantyList.length, "record")}</span>}
                  </div>
                  {warranties.state === "loading" ? (
                    <SkeletonRows label="Loading warranties" />
                  ) : warranties.state === "error" ? (
                    <SectionError message={warranties.error} onRetry={() => void loadSection("warranties")} />
                  ) : warrantyList.length ? (
                    <div className="warranty-grid">
                      {warrantyList.map((w) => (
                        <div className="warranty-item" key={w.id}>
                          <div className="warranty-top">
                            <div className="warranty-icon" aria-hidden="true">
                              ◇
                            </div>
                            <Status value={w.status || "On record"} />
                          </div>
                          <h4>{w.item_label || "Covered item"}</h4>
                          <div className="warranty-dates">
                            <span>
                              <small>START DATE</small>
                              <strong>{formatDate(w.start_date)}</strong>
                            </span>
                            <span>
                              <small>END DATE</small>
                              <strong>{formatDate(w.end_date)}</strong>
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty icon="◇" title="No warranty records" text="Warranty details will appear here when linked to your account." />
                  )}
                </section>
              )}

              {activeTab === "feedback" && (
                <section className="content-card feedback-card">
                  <span className="eyebrow">YOUR VOICE MATTERS</span>
                  <h3>How has your experience been?</h3>
                  <p className="muted">Your feedback helps us improve our service.</p>
                  <form onSubmit={sendFeedback}>
                    <span className="form-label" id="rating-label">
                      Your rating
                    </span>
                    <div className="star-picker" role="group" aria-labelledby="rating-label">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          type="button"
                          key={n}
                          onClick={() => setFeedbackRating(n)}
                          aria-label={`${n} star${n > 1 ? "s" : ""}`}
                          aria-pressed={n === feedbackRating}
                          className={n <= feedbackRating ? "star-selected" : ""}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                    <label className="form-label" htmlFor="feedback-comment">
                      Comments <span>(optional)</span>
                    </label>
                    <textarea
                      id="feedback-comment"
                      value={feedbackComment}
                      onChange={(e) => setFeedbackComment(e.target.value)}
                      rows={4}
                      maxLength={1000}
                      placeholder="Tell us what went well or what we could do better…"
                    />
                    <div className="form-bottom">
                      <span>{feedbackComment.length}/1000 characters</span>
                      <button type="submit" className="button button-primary" disabled={feedbackBusy}>
                        {feedbackBusy ? "Sending…" : "Submit feedback →"}
                      </button>
                    </div>
                    {feedbackMessage && (
                      <div className={`notice ${feedbackMessage.ok ? "success-notice" : "error-alert"}`} role={feedbackMessage.ok ? "status" : "alert"}>
                        {feedbackMessage.text}
                      </div>
                    )}
                  </form>
                </section>
              )}

              <footer className="page-footer">
                <span>© {new Date().getFullYear()} Vantage Computers</span>
                <span>
                  <i /> Your information is protected
                </span>
              </footer>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

const RENTAL_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Awaiting your approval",
  approved: "Approved",
  rejected: "Rejected",
  active: "Active",
  closed: "Closed",
  cancelled: "Cancelled",
};

function RentalList({ rentals, limit, onRetry }: { rentals: Section<Rental[]>; limit?: number; onRetry: () => void }) {
  if (rentals.state === "loading") return <SkeletonRows rows={2} label="Loading rentals" />;
  if (rentals.state === "error") return <SectionError message={rentals.error} onRetry={onRetry} />;
  const list = limit ? rentals.data.slice(0, limit) : rentals.data;
  if (!list.length)
    return <Empty icon="↻" title="No rental agreements" text="Rental agreements linked to your account will appear here." />;
  return (
    <div className="rental-grid">
      {list.map((r) => {
        const tenure = Number(r.tenure_months) || 0;
        const paid = Math.min(Number(r.months_paid) || 0, tenure || Infinity);
        const pct = tenure ? Math.round((paid / tenure) * 100) : 0;
        return (
          <article className="rental-card" key={r.id}>
            <div className="rental-top">
              <div>
                {r.agreement_code && <span className="rental-code">{r.agreement_code}</span>}
                <h4>{r.product_label || "Rental equipment"}</h4>
                <span className="rental-fee">
                  {formatMoney(r.total_monthly_fee ?? r.monthly_fee)} <small>/ month</small>
                </span>
              </div>
              {r.status ? (
                <Status value={RENTAL_STATUS_LABELS[r.status] || r.status} />
              ) : r.next_payment_overdue ? (
                <Status value="Payment overdue" />
              ) : null}
            </div>
            <dl className="rental-meta">
              <div>
                <dt>Start date</dt>
                <dd>{formatDate(r.start)}</dd>
              </div>
              <div>
                <dt>Tenure</dt>
                <dd>{tenure ? `${tenure} month${tenure === 1 ? "" : "s"}` : "—"}</dd>
              </div>
              {r.end_date && (
                <div>
                  <dt>Covered until</dt>
                  <dd>{formatDate(r.end_date)}</dd>
                </div>
              )}
              <div>
                <dt>Next payment</dt>
                <dd className={r.next_payment_overdue ? "overdue-text" : undefined}>
                  {r.next_payment_date ? formatDate(r.next_payment_date) : "—"}
                  {r.next_payment_overdue ? " · Overdue" : ""}
                </dd>
              </div>
            </dl>
            {r.devices && r.devices.length > 0 && (
              <ul className="rental-devices" aria-label="Rented devices">
                {r.devices.map((d, i) => (
                  <li key={i}>
                    <span>{d.description || "Device"}</span>
                    {d.serial_number && <small>S/N {d.serial_number}</small>}
                  </li>
                ))}
              </ul>
            )}
            {tenure > 0 && (
              <div className="rental-progress">
                <div className="progress-label">
                  <span>Months paid</span>
                  <strong>
                    {paid} of {tenure}
                  </strong>
                </div>
                <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={tenure} aria-valuenow={paid} aria-label="Months paid">
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function PurchaseList({ invoices, dealer, onRetry }: { invoices: Section<Invoice[]>; dealer: boolean; onRetry: () => void }) {
  if (invoices.state === "loading") return <SkeletonRows label="Loading purchases" />;
  if (invoices.state === "error") return <SectionError message={invoices.error} onRetry={onRetry} />;
  const withItems = invoices.data.filter((inv) => inv.items && inv.items.length);
  if (!withItems.length)
    return (
      <Empty
        icon={dealer ? "▦" : "▣"}
        title={dealer ? "No orders yet" : "No purchases yet"}
        text={dealer ? "Products from your invoiced dealer orders will appear here." : "Products you buy from us will appear here once invoiced."}
      />
    );
  return (
    <div className="purchase-list">
      {withItems.map((inv) => (
        <div className="purchase-group" key={inv.id}>
          <div className="purchase-head">
            <span>
              <strong>{inv.code || `INV-${inv.id}`}</strong> · {formatDate(inv.date)}
              {inv.stock_point_name ? ` · ${inv.stock_point_name}` : ""}
            </span>
            <Status value={inv.status || "Recorded"} />
          </div>
          <ul>
            {(inv.items || []).map((item, i) => (
              <li key={i} className="purchase-item">
                <span>
                  <strong>{item.product || "Item"}</strong>
                  {item.spec && <small>{item.spec}</small>}
                </span>
                <span className="purchase-qty">× {item.qty ?? 1}</span>
                <span className="amount">{formatMoney(item.amount ?? Number(item.price || 0) * Number(item.qty ?? 1), inv.currency || undefined)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
