# LaptopBookCRM Customer Portal (Next.js)

A standalone Next.js App Router frontend intended to work with the existing LaptopBookCRM Django REST API. It includes an email-OTP invite flow and responsive Retail / Dealer / Rental customer dashboard shell.

## Included

- Invite link flow at `/portal/<token>`: `/portal/invite-status/<token>/`, `/portal/resend-otp/`, `/portal/verify/`, with server-driven OTP countdown, resend cooldown, and expired / revoked / locked / throttled / unavailable states
- Authenticated customer dashboard using `Authorization: Portal <portal_token>`, separated by account type (Rental / Dealer / Retail, from `Party.type` only; anything else shows "Customer account")
- Uses existing APIs: `/portal/me/`, `/portal/rentals/` (Rental accounts, or accounts whose type the API does not report; never Dealer/Retail), `/portal/invoices/`, `/portal/repairs/`, `/portal/warranties/`, `/portal/feedback/`, `/portal/location/`
- Invoice list with authenticated PDF downloads via `/portal/invoices/<id>/pdf/` (shown only for invoices the backend marks `pdf_available`)
- Per-section loading skeletons, empty states and retry; a clear "session ended" / "rental access ended" screen on 401/403

## Routing and sessions

| Route | Behaviour |
|---|---|
| `/` | Always the public welcome page (paste an invitation link → Continue). Never redirects, whatever is stored in the browser. |
| `/portal/<token>` | That invitation's OTP flow. Skips the OTP only when the stored session was verified through **this same invitation** and Django still accepts it. Opening a different invitation drops the previous local session first. |
| `/portal/dashboard` | Dashboard for a session Django accepts on `/portal/me/`; otherwise back to `/`. |
| `/portal` | Dashboard for a valid session, else the last opened invitation's OTP form, else "Open your invitation link". |

- A stored token is never trusted on its own: the server must accept it first, and a `401`/`403` clears it.
- `laptopbook_portal_session_invite` records which invitation the stored session was verified through, so one customer's session is never reused for another customer's link.
- `laptopbook_portal_invite` (last opened invitation) only remembers where the OTP form is; it is not a credential and is forgotten when Django reports the link expired, revoked or invalid.

## Requirements

- Node.js 20.9+ (Node 22 LTS recommended)
- Your existing Django backend and PostgreSQL database running

## Run locally on Windows

1. Extract the ZIP.
2. Open CMD or PowerShell in the extracted `customer-portal` folder.
3. Create `.env.local` from `.env.example`:

   ```bat
   copy .env.example .env.local
   ```

4. Edit `.env.local` if needed. For a local Django server, use:

   ```env
   NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api
   ```

5. Install and start:

   ```bat
   npm install
   npm run dev
   ```

6. Open `http://localhost:3000`. Use a fresh portal invite link issued by Django to test OTP login.

## Django integration checklist

- Ensure Django is running at the configured API base URL, with `http://localhost:3000` in `DJANGO_CORS_ALLOWED_ORIGINS` and `Retry-After` in `CORS_EXPOSE_HEADERS` (already set in `crmbook_backend/settings.py`). For production, use HTTPS and the real portal domain.
- The invite / OTP endpoints in `backend/portal` already match what this frontend expects (see below).

### Portal data endpoints used (Django `backend/portal`)

| Endpoint | Used for |
|---|---|
| `GET /portal/me/` | Profile; `type` = `Rental` / `Dealer` / `Retail` / `Unknown` decides the dashboard; `portal_access_ends_at` (Rental only) |
| `GET /portal/invoices/` | The customer's own invoices: `code`, `source`, `reference`, `date`, `due_date`, `paid_on`, `status`, `total`, `currency`, `pdf_available`, `items` |
| `GET /portal/invoices/<id>/` | "View details": items, store, `pay_method`, `payment_reference`, `refunded_total` |
| `GET /portal/invoices/<id>/pdf/` | Authenticated PDF download (rendered server-side; `404 pdf_unavailable` / `404 invoice_not_found`; throttled per customer, `429`) |
| `GET /portal/rentals/` | Rental (and Unknown-type) accounts only: `agreement_code`, `status`, `end_date`, `devices`, payments |
| `GET /portal/repairs/`, `/portal/warranties/`, `POST /portal/feedback/`, `POST /portal/location/` | As before |

Every endpoint is scoped to the session's party by Django; the portal never filters other customers' data in the browser. A Rental customer whose tenure has ended gets `403` + `code: rental_access_ended` on every endpoint, including downloads.

Optional backend tweak: add `Content-Disposition` to `CORS_EXPOSE_HEADERS` so the browser can read the server's filename (without it the portal names the file `Invoice-<code>.pdf`, which is the same name Django uses).

The CRM's staff-side "Copy OTP" belongs to the separate CRM frontend (`laptopbookcrm/frontend`), not this portal; the portal never requests or displays an OTP.

## Invite / OTP contract used by the frontend

- `GET /api/portal/invite-status/<uuid>/` → `masked_email`, `invite_expires_at`, `otp_status` (`active` / `expired` / `locked` / `none`), `otp_expires_in`, `otp_expires_at`, `server_time`, `resend_available_in`. Reading it never issues a code. `410` + `code: invite_expired | invite_revoked`; `404` + `invite_invalid`.
- `POST /api/portal/resend-otp/` `{"token"}` → `detail`, `masked_email`, `otp_expires_in`, `otp_expires_at`, `server_time`, `resend_available_in`, `invite_expires_at`. Errors: `410` (closed link — a resend never reopens it), `429 resend_throttled` with `Retry-After`, `409 no_email_on_file`, `503 email_delivery_failed`.
- `POST /api/portal/verify/` `{"token","otp"}` → `portal_token`, `party`, `access_log_id`. Errors: `otp_invalid` (+ `attempts_remaining`), `otp_expired`, `otp_attempts_exceeded`, `429 verify_throttled`, `410`. A successful verify does not close the link.
- Dashboard endpoints return `403` once the portal session is invalid (expired token, revoked access, or rental tenure ended); the portal clears the stored token and shows a session-ended screen.

## Important security notes

- This starter stores the portal token in browser localStorage to match the current frontend-style API flow. For a hardened production deployment, consider moving the session to a Secure, HttpOnly cookie via a same-origin Next.js server proxy.
- Do not expose database credentials or Django secret keys in `NEXT_PUBLIC_*` environment variables. Only the public API base URL belongs there.
- Location sharing is optional and only occurs after the customer clicks the button and grants the browser permission.

## Build check

```bat
npm run build
```

The zip contains source code, not installed `node_modules` or a production build. Run `npm install` after extraction.
