"use client";
import { useState } from "react";
import {
  api,
  ApiError,
  downloadPdf,
  formatDate,
  formatMoney,
  Invoice,
  InvoiceDetail,
  isAuthError,
  safeFilename,
} from "@/lib/api";
import { Empty, Section, SectionError, SkeletonRows, Status } from "./ui";

type Message = { tone: "success" | "error"; text: string };

const SOURCE_LABELS: Record<string, string> = { sale: "Purchase", repair: "Repair", rental: "Rent" };

export function invoicePdfPath(invoice: Invoice) {
  return `/portal/invoices/${encodeURIComponent(String(invoice.id))}/pdf/`;
}

export function invoiceLabel(invoice: Invoice) {
  return invoice.code || `INV-${invoice.id}`;
}

/** One line describing the invoice: Django's reference (repair / rental period) or the first item. */
function invoiceSummary(invoice: Invoice) {
  if (invoice.reference) return invoice.reference;
  const items = invoice.items || [];
  if (!items.length) return "";
  const first = items[0]?.product || "Item";
  return items.length > 1 ? `${first} + ${items.length - 1} more` : first;
}

function downloadError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "invoice_not_found") return "This invoice is no longer available on your account.";
    if (e.code === "pdf_unavailable" || e.status === 404 || e.status === 405 || e.status === 501)
      return "This invoice PDF is not currently available. Please contact our team for a copy.";
    if (e.status === 429)
      return e.retryAfter != null
        ? `Too many downloads in a short time. Please try again in ${Math.max(1, Math.ceil(e.retryAfter / 60))} minute${Math.ceil(e.retryAfter / 60) > 1 ? "s" : ""}.`
        : "Too many downloads in a short time. Please try again later.";
    if (e.status === 0) return "We couldn't reach the server. Check your connection and try again.";
    if (e.status >= 500) return "The invoice couldn't be generated right now. Please try again shortly.";
  }
  return e instanceof Error && e.message ? e.message : "The invoice could not be downloaded. Please try again.";
}

/**
 * The customer's own invoices (Django scopes `/portal/invoices/` to the
 * session's party). A download button is shown only when the backend marks
 * the invoice `pdf_available`; otherwise the row says it isn't available.
 */
export function InvoiceSection({
  invoices,
  onRetry,
  onAuthError,
  limit,
  emptyText,
}: {
  invoices: Section<Invoice[]>;
  onRetry: () => void;
  onAuthError: (e: unknown) => void;
  limit?: number;
  emptyText: string;
}) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Section<InvoiceDetail>>>({});

  async function download(invoice: Invoice) {
    const key = String(invoice.id);
    if (downloading) return;
    setDownloading(key);
    setMessages((m) => {
      const next = { ...m };
      delete next[key];
      return next;
    });
    let message: Message;
    try {
      await downloadPdf(
        invoicePdfPath(invoice),
        safeFilename(`Invoice-${invoiceLabel(invoice)}.pdf`, `Invoice-${key}.pdf`),
      );
      message = { tone: "success", text: "Download started." };
    } catch (e) {
      if (isAuthError(e)) {
        onAuthError(e);
        return;
      }
      message = { tone: "error", text: downloadError(e) };
    } finally {
      setDownloading(null);
    }
    setMessages((m) => ({ ...m, [key]: message }));
  }

  async function loadDetail(key: string) {
    setDetails((d) => ({ ...d, [key]: { state: "loading" } }));
    try {
      const data = await api<InvoiceDetail>(`/portal/invoices/${encodeURIComponent(key)}/`);
      setDetails((d) => ({ ...d, [key]: { state: "ready", data } }));
    } catch (e) {
      if (isAuthError(e)) {
        onAuthError(e);
        return;
      }
      const text =
        e instanceof ApiError && e.status === 404
          ? "This invoice is no longer available on your account."
          : e instanceof Error && e.message
            ? e.message
            : "Couldn't load the invoice details.";
      setDetails((d) => ({ ...d, [key]: { state: "error", error: text } }));
    }
  }

  function toggleDetail(inv: Invoice) {
    const key = String(inv.id);
    if (openId === key) {
      setOpenId(null);
      return;
    }
    setOpenId(key);
    if (!details[key] || details[key].state === "error") void loadDetail(key);
  }

  if (invoices.state === "loading") return <SkeletonRows rows={limit ? 3 : 5} label="Loading invoices" />;
  if (invoices.state === "error") return <SectionError message={invoices.error} onRetry={onRetry} />;
  const list = limit ? invoices.data.slice(0, limit) : invoices.data;
  if (!list.length) return <Empty icon="▤" title="No invoices yet" text={emptyText} />;
  const showDue = list.some((inv) => inv.due_date);

  const action = (inv: Invoice) => {
    const key = String(inv.id);
    const label = invoiceLabel(inv);
    if (inv.pdf_available !== true)
      return <span className="download-unavailable">PDF not available yet</span>;
    const busy = downloading === key;
    return (
      <button
        type="button"
        className="download-button"
        onClick={() => void download(inv)}
        disabled={downloading !== null}
        aria-busy={busy}
        aria-label={`Download invoice ${label} as PDF`}
      >
        {busy ? (
          <span className="spinner spinner-dark" aria-hidden="true" />
        ) : (
          <span className="download-icon" aria-hidden="true">
            ↓
          </span>
        )}
        {busy ? "Downloading…" : "Download invoice"}
      </button>
    );
  };
  const detailsButton = (inv: Invoice, idSuffix: string) => {
    const key = String(inv.id);
    const open = openId === key;
    return (
      <button
        type="button"
        className="details-button"
        onClick={() => toggleDetail(inv)}
        aria-expanded={open}
        aria-controls={`invoice-detail-${key}${idSuffix}`}
      >
        {open ? "Hide details" : "View details"}
      </button>
    );
  };
  const feedback = (inv: Invoice) => {
    const msg = messages[String(inv.id)];
    return msg ? (
      <p className={`download-message ${msg.tone}`} role={msg.tone === "error" ? "alert" : "status"}>
        {msg.text}
      </p>
    ) : null;
  };
  const detailPanel = (inv: Invoice, idSuffix: string) => {
    const key = String(inv.id);
    if (openId !== key) return null;
    const detail = details[key];
    return (
      <div className="invoice-detail" id={`invoice-detail-${key}${idSuffix}`}>
        {!detail || detail.state === "loading" ? (
          <SkeletonRows rows={2} label="Loading invoice details" />
        ) : detail.state === "error" ? (
          <SectionError message={detail.error} onRetry={() => void loadDetail(key)} />
        ) : (
          <InvoiceDetailView detail={detail.data} />
        )}
      </div>
    );
  };

  return (
    <>
      <div className="table-wrap invoice-table">
        <table>
          <caption className="visually-hidden">Your invoices</caption>
          <thead>
            <tr>
              <th scope="col">INVOICE</th>
              <th scope="col">DATE</th>
              {showDue && <th scope="col">DUE DATE</th>}
              <th scope="col">AMOUNT</th>
              <th scope="col">STATUS</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((inv) => (
              <InvoiceRows key={inv.id} colSpan={showDue ? 6 : 5} detail={detailPanel(inv, "")}>
                <td>
                  <strong>{invoiceLabel(inv)}</strong>
                  {inv.source && SOURCE_LABELS[inv.source] && <span className="invoice-source">{SOURCE_LABELS[inv.source]}</span>}
                  {invoiceSummary(inv) && <span className="invoice-sub">{invoiceSummary(inv)}</span>}
                </td>
                <td>{formatDate(inv.date)}</td>
                {showDue && <td>{formatDate(inv.due_date)}</td>}
                <td className="amount">{formatMoney(inv.total, inv.currency || undefined)}</td>
                <td>
                  <Status value={inv.status || "Recorded"} />
                  {inv.paid_on && <span className="invoice-sub">Paid {formatDate(inv.paid_on)}</span>}
                </td>
                <td className="invoice-action">
                  <span className="invoice-action-buttons">
                    {detailsButton(inv, "")}
                    {action(inv)}
                  </span>
                  {feedback(inv)}
                </td>
              </InvoiceRows>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="invoice-cards" aria-label="Your invoices">
        {list.map((inv) => (
          <li className="invoice-card" key={inv.id}>
            <div className="invoice-card-top">
              <div>
                <strong>{invoiceLabel(inv)}</strong>
                {inv.source && SOURCE_LABELS[inv.source] && <span className="invoice-source">{SOURCE_LABELS[inv.source]}</span>}
                {invoiceSummary(inv) && <span className="invoice-sub">{invoiceSummary(inv)}</span>}
              </div>
              <Status value={inv.status || "Recorded"} />
            </div>
            <dl className="invoice-card-meta">
              <div>
                <dt>Date</dt>
                <dd>{formatDate(inv.date)}</dd>
              </div>
              {inv.due_date && (
                <div>
                  <dt>Due</dt>
                  <dd>{formatDate(inv.due_date)}</dd>
                </div>
              )}
              {inv.paid_on && (
                <div>
                  <dt>Paid on</dt>
                  <dd>{formatDate(inv.paid_on)}</dd>
                </div>
              )}
              <div>
                <dt>Amount</dt>
                <dd className="amount">{formatMoney(inv.total, inv.currency || undefined)}</dd>
              </div>
            </dl>
            {action(inv)}
            {feedback(inv)}
            {detailsButton(inv, "-card")}
            {detailPanel(inv, "-card")}
          </li>
        ))}
      </ul>
    </>
  );
}

function InvoiceRows({ children, detail, colSpan }: { children: React.ReactNode; detail: React.ReactNode; colSpan: number }) {
  return (
    <>
      <tr>{children}</tr>
      {detail && (
        <tr className="invoice-detail-row">
          <td colSpan={colSpan}>{detail}</td>
        </tr>
      )}
    </>
  );
}

function InvoiceDetailView({ detail }: { detail: InvoiceDetail }) {
  const currency = detail.currency || undefined;
  const refunded = Number(detail.refunded_total) || 0;
  return (
    <>
      <dl className="invoice-detail-meta">
        {detail.reference && (
          <div>
            <dt>For</dt>
            <dd>{detail.reference}</dd>
          </div>
        )}
        {detail.stock_point_name && (
          <div>
            <dt>Store</dt>
            <dd>{detail.stock_point_name}</dd>
          </div>
        )}
        {detail.pay_method && (
          <div>
            <dt>Payment method</dt>
            <dd>{detail.pay_method}</dd>
          </div>
        )}
        {detail.payment_reference && (
          <div>
            <dt>Payment reference</dt>
            <dd>{detail.payment_reference}</dd>
          </div>
        )}
        {refunded > 0 && (
          <div>
            <dt>Refunded</dt>
            <dd>{formatMoney(refunded, currency)}</dd>
          </div>
        )}
      </dl>
      {detail.items?.length ? (
        <ul className="invoice-detail-items">
          {detail.items.map((item, i) => (
            <li key={i}>
              <span>
                <strong>{item.product || "Item"}</strong>
                {item.spec && <small>{item.spec}</small>}
              </span>
              <span className="purchase-qty">
                {item.qty ?? 1} × {formatMoney(item.price, currency)}
              </span>
              <span className="amount">
                {formatMoney(item.amount ?? Number(item.price || 0) * Number(item.qty ?? 1), currency)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No line items are recorded on this invoice.</p>
      )}
    </>
  );
}
