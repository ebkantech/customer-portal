const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000/api"
).replace(/\/$/, "");
const SESSION_KEY = "laptopbook_portal_token";
const ACCESS_LOG_KEY = "laptopbook_portal_access_log";
// The invitation token the stored session was verified with (see sessionInviteToken()).
const SESSION_INVITE_KEY = "laptopbook_portal_session_invite";

/** `/portal/me/` (Django PortalPartySerializer). `type` is "Retail" | "Dealer" | "Rental" | "Unknown". */
export type Party = {
  id?: number | string;
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  joined?: string;
  type?: string;
  /** Optional: when a Rental customer's portal access ends (backend-calculated). */
  portal_access_ends_at?: string | null;
  [key: string]: unknown;
};
export type InvoiceItem = {
  product?: string;
  spec?: string;
  qty?: number;
  price?: number | string;
  amount?: number | string;
};
/** `/portal/invoices/` (Django PortalInvoiceSerializer). */
export type Invoice = {
  id: number | string;
  code?: string;
  /** "sale" | "repair" | "rental" */
  source?: string;
  /** What the invoice was raised for, e.g. a repair ticket or rental agreement and period. */
  reference?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  date?: string;
  due_date?: string | null;
  paid_on?: string | null;
  status?: string;
  total?: number | string;
  currency?: string;
  stock_point_name?: string;
  items?: InvoiceItem[];
  /** True only when `/portal/invoices/<id>/pdf/` can serve this invoice. */
  pdf_available?: boolean;
};
/** `/portal/invoices/<id>/` (Django PortalInvoiceDetailSerializer). */
export type InvoiceDetail = Invoice & {
  pay_method?: string;
  payment_reference?: string;
  refunded_total?: number | string;
};
export type RepairInvoice = {
  id: number | string;
  code?: string;
  ticket_code?: string;
  amount?: number | string;
  status?: string;
  date?: string;
};
export type Rental = {
  id: number | string;
  product_label?: string;
  monthly_fee?: number | string;
  start?: string;
  tenure_months?: number;
  months_paid?: number;
  next_payment_date?: string | null;
  next_payment_overdue?: boolean;
  agreement_code?: string;
  /** Rental.status: draft | pending_approval | approved | rejected | active | closed | cancelled */
  status?: string;
  /** Last day the agreement covers (inclusive), calculated by Django -- never in the browser. */
  end_date?: string | null;
  total_monthly_fee?: number | string;
  devices?: { description?: string; serial_number?: string; monthly_fee?: number | string }[];
};
export type Warranty = {
  id: number | string;
  section?: string;
  item_label?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
};
export type Repair = {
  id: number | string;
  code?: string;
  brand?: string;
  model_name?: string;
  issue?: string;
  status?: string;
  received?: string;
  expected?: string;
  services?: string[];
};
export type RepairResponse = { tickets?: Repair[]; invoices?: RepairInvoice[] };

export function getSession() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(SESSION_KEY) || "";
}
export function getAccessLogId() {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(ACCESS_LOG_KEY);
  return v ? Number(v) : null;
}
/**
 * Stores a freshly verified session together with the invitation it was
 * verified through, replacing everything from any previous customer.
 */
export function saveSession(token: string, accessLogId?: number | string, inviteToken?: string) {
  localStorage.setItem(SESSION_KEY, token);
  if (accessLogId != null) localStorage.setItem(ACCESS_LOG_KEY, String(accessLogId));
  else localStorage.removeItem(ACCESS_LOG_KEY);
  if (inviteToken) localStorage.setItem(SESSION_INVITE_KEY, inviteToken);
  else localStorage.removeItem(SESSION_INVITE_KEY);
}
export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(ACCESS_LOG_KEY);
  localStorage.removeItem(SESSION_INVITE_KEY);
}
/**
 * The invitation the stored session came from. An invitation link may only
 * reuse a session that was verified through that same link; any other link
 * (possibly another customer's) must go through its own OTP.
 */
export function sessionInviteToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(SESSION_INVITE_KEY) || "";
}

/*
 * The customer's invitation token, remembered so "/" and "/portal" can return
 * them to their OTP form after logout or session expiry. It is NOT proof of
 * authentication: signing in still needs the emailed code, and Django decides
 * whether the link is still valid. Forgotten once Django reports it closed.
 */
const INVITE_KEY = "laptopbook_portal_invite";
const INVITE_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readStorage(key: string) {
  try {
    return typeof window === "undefined" ? "" : localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

/** Django's invite routes only accept UUID link tokens. */
export function isInviteToken(token: string) {
  return INVITE_TOKEN_RE.test(token);
}

export function getInviteToken() {
  const token = readStorage(INVITE_KEY);
  return INVITE_TOKEN_RE.test(token) ? token : "";
}
export function rememberInviteToken(token: string) {
  if (!INVITE_TOKEN_RE.test(token)) return;
  try {
    localStorage.setItem(INVITE_KEY, token);
  } catch {
    /* storage unavailable: the URL still carries the token for this visit */
  }
}
/** Forgets the stored invitation, but only if it is the one that turned out to be closed. */
export function forgetInviteToken(token: string) {
  try {
    if (localStorage.getItem(INVITE_KEY) === token) localStorage.removeItem(INVITE_KEY);
  } catch {
    /* nothing stored */
  }
}

export type SessionCheck =
  | { state: "none" }
  | { state: "valid" }
  | { state: "ended"; error: unknown }
  | { state: "unavailable"; error: unknown };

/**
 * Asks Django whether the stored portal session is still valid. A token in
 * storage is never trusted on its own: only a successful `/portal/me/` counts.
 * A 401/403 clears the dead session; a network/server failure leaves it alone
 * (it may still be valid) and is reported as "unavailable".
 */
export async function checkSession(): Promise<SessionCheck> {
  if (!getSession()) return { state: "none" };
  try {
    await api<Party>("/portal/me/");
    return { state: "valid" };
  } catch (error) {
    if (isAuthError(error)) {
      clearSession();
      return { state: "ended", error };
    }
    return { state: "unavailable", error };
  }
}

/**
 * Error thrown by `api()` for failed requests. It is still a regular `Error`
 * (same user-facing message as before) but also carries the HTTP status
 * (0 = network failure), the parsed response body, an optional machine-readable
 * `code`, and server-provided retry information (seconds) when available.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  data: Record<string, unknown>;
  retryAfter: number | null;
  constructor(
    message: string,
    status: number,
    data: Record<string, unknown> = {},
    retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.code = typeof data.code === "string" ? data.code : undefined;
    this.retryAfter = retryAfter;
  }
}

export function isAuthError(e: unknown) {
  return e instanceof ApiError && (e.status === 401 || e.status === 403);
}

/**
 * Reads retry information from the `Retry-After` header (seconds or HTTP date),
 * common body fields, or DRF's default throttle message. Cross-origin, the
 * header is only readable if Django exposes it via Access-Control-Expose-Headers.
 */
function parseRetryAfter(
  response: Response,
  data: Record<string, unknown>,
): number | null {
  const header = response.headers.get("Retry-After");
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs);
    const at = Date.parse(header);
    if (!Number.isNaN(at))
      return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  }
  for (const key of ["retry_after", "retry_after_seconds"]) {
    const n = Number(data[key]);
    if (data[key] != null && Number.isFinite(n) && n >= 0) return Math.ceil(n);
  }
  const detail = typeof data.detail === "string" ? data.detail : "";
  const match = detail.match(/available in (\d+) second/i);
  return match ? Number(match[1]) : null;
}

/** Sends a request with the portal session (when `auth`); network failures become ApiError(status 0). */
async function send(path: string, options: RequestInit, auth: boolean) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const token = auth ? getSession() : "";
  if (token) headers.set("Authorization", `Portal ${token}`);
  try {
    return await fetch(
      `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`,
      { ...options, headers, cache: "no-store" },
    );
  } catch {
    throw new ApiError(
      `Could not connect to the CRM API. Check that Django is running and NEXT_PUBLIC_API_BASE_URL is correct (${API_BASE}).`,
      0,
    );
  }
}

/** Builds the ApiError for a non-2xx response, preferring the backend's own message. */
function toApiError(response: Response, data: unknown) {
  const body: Record<string, unknown> =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const fail = (message: string) =>
    new ApiError(message, response.status, body, parseRetryAfter(response, body));
  const detail =
    body.detail || body.error || body.message || (typeof data === "string" ? data : "");
  if (response.status === 401 || response.status === 403)
    return fail(
      typeof detail === "string" && detail
        ? detail
        : "Your session is no longer valid. Please sign in again.",
    );
  if (response.status === 404)
    return fail(
      typeof detail === "string" && detail
        ? detail
        : "This portal link or record could not be found.",
    );
  if (typeof detail === "string" && detail) return fail(detail);
  const first = Object.values(body).flat()[0];
  return fail(
    typeof first === "string"
      ? first
      : `Request failed (${response.status}). Please try again.`,
  );
}

/** Absolute backend URL for a resource the browser loads directly (e.g. an <img>). */
export function apiUrl(path: string) {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  auth = true,
): Promise<T> {
  const response = await send(path, options, auth);
  const text = await response.text().catch(() => "");
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }
  if (!response.ok) throw toApiError(response, data ?? {});
  // A 2xx that isn't JSON never came from the API (e.g. Django's single-server
  // SPA catch-all answers unknown /api/ URLs with index.html): never treat it as success.
  if (data === undefined)
    throw new ApiError(
      "The server returned an unexpected response. Please try again.",
      response.status,
      { code: "unexpected_response" },
    );
  return data as T;
}

/** Keeps a filename to safe characters so a server header can't inject paths. */
export function safeFilename(name: string, fallback = "download.pdf") {
  const cleaned = name
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

function filenameFromDisposition(header: string | null) {
  if (!header) return "";
  const star = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through to the plain filename parameter */
    }
  }
  const plain = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plain ? plain[1].trim() : "";
}

/**
 * Downloads an authenticated PDF through the portal session and saves it with
 * `filename`. Resolves only after the browser has been handed a real PDF; a
 * non-PDF or failed response throws ApiError, so callers never report a
 * download that didn't happen.
 */
export async function downloadPdf(path: string, filename: string) {
  const response = await send(path, { headers: { Accept: "application/pdf" } }, true);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw toApiError(response, data);
  }
  const type = (response.headers.get("Content-Type") || "").toLowerCase();
  const blob = await response.blob();
  if (!type.includes("application/pdf") || blob.size === 0)
    throw new ApiError(
      "The server did not return a PDF for this invoice. Please try again later or contact our team.",
      response.status,
    );
  const name = safeFilename(
    filenameFromDisposition(response.headers.get("Content-Disposition")) || filename,
    filename,
  );
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Give the browser a moment to start the download before releasing the blob.
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

export function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(d);
}
export function formatMoney(value?: number | string | null, currency = "INR") {
  const n = Number(value ?? 0);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(n) ? n : 0);
  } catch {
    // Unknown currency code from the API: show the code rather than guessing a symbol.
    return `${currency} ${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
  }
}

export type AccountType = "rental" | "dealer" | "retail" | "unknown";

/**
 * The account type exactly as Django's Party.type reports it. Never inferred
 * from rentals, names, or other records: anything else is "unknown".
 */
export function getAccountType(party?: Party | null): AccountType {
  const raw = String(party?.type ?? "").trim().toLowerCase();
  return raw === "rental" || raw === "dealer" || raw === "retail" ? raw : "unknown";
}

export const ACCOUNT_LABELS: Record<AccountType, string> = {
  rental: "Rental account",
  dealer: "Dealer account",
  retail: "Retail account",
  unknown: "Customer account",
};

/** Mirrors Django's Invoice.OUTSTANDING = (LINK_SENT, OVERDUE). */
export function isInvoiceOutstanding(status?: string) {
  return /^(payment link sent|overdue)$/i.test((status || "").trim());
}
