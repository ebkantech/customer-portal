import { apiUrl } from "@/lib/api";

/*
 * Types for GET/POST /api/public/rental-approvals/<token>/ -- mirrors Django's
 * rentals.serializers.PublicRentalApprovalSerializer, whose items are the
 * immutable approval snapshot built by rentals.services._snapshot /
 * _handover_snapshot. Every field is optional: approvals sent before handover
 * records existed carry no checks/photos/warranty, and nothing is filled in.
 */

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "expired"
  | "revoked";

export type HandoverCheck = { label?: string; ok?: boolean };
export type HandoverPhoto = { id: number; kind?: string; label?: string; caption?: string };
export type Accessory = { name?: string; serial?: string };
export type Warranty = { included?: boolean; months?: number | null; terms?: string };

export type ApprovalItem = {
  asset_tag?: string;
  serial_number?: string;
  brand?: string;
  model_name?: string;
  monthly_fee?: number | string;
  checks?: HandoverCheck[];
  working_confirmed?: boolean;
  condition_notes?: string;
  accessories?: Accessory[];
  warranty?: Warranty;
  photos?: HandoverPhoto[];
  tested_by?: string | null;
  tested_at?: string | null;
};

export type RentalApproval = {
  status: ApprovalStatus | string;
  /** The customer's own change request, echoed back once recorded. */
  change_request?: string | null;
  source?: string;
  decided_at?: string | null;
  expires_at?: string | null;
  version?: number;
  agreement_code?: string;
  customer?: { name?: string; classification?: string | null };
  start?: string;
  tenure_months?: number;
  currency?: string;
  terms?: string;
  rental_type?: string;
  items: ApprovalItem[];
  total_monthly_fee?: number | string;
};

export type Decision = "approve" | "reject" | "request_changes";

/** The status each decision must produce; a 200 with anything else is not treated as success. */
export const DECISION_RESULT: Record<Decision, ApprovalStatus> = {
  approve: "approved",
  reject: "rejected",
  request_changes: "changes_requested",
};

export const CHANGE_REQUEST_MAX = 500;
export const REASON_MAX = 500;

/** secrets.token_urlsafe(32) -- anything else can't be a real link, so it is never sent. */
export function isApprovalToken(token: string) {
  return /^[A-Za-z0-9_-]{20,200}$/.test(token);
}

/** A token-protected snapshot photo. Only ids taken from the snapshot are ever requested. */
export function approvalPhotoUrl(token: string, photoId: number) {
  return apiUrl(
    `/public/rental-approvals/${encodeURIComponent(token)}/photos/${encodeURIComponent(String(photoId))}/`,
  );
}

export function isApprovalPayload(data: unknown): data is RentalApproval {
  return (
    !!data &&
    typeof data === "object" &&
    typeof (data as RentalApproval).status === "string" &&
    Array.isArray((data as RentalApproval).items)
  );
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  individual: "Individual",
  business: "Business / Corporate",
  dealer: "Dealer",
};
export function classificationLabel(value?: string | null) {
  if (!value) return "";
  return CLASSIFICATION_LABELS[value] || value;
}

export function rentalTypeLabel(value: string | undefined, count: number) {
  if (value === "bulk") return `Bulk rental · ${count} devices`;
  if (value === "single") return "Single device";
  return count === 1 ? "1 device" : `${count} devices`;
}

export function tenureLabel(months?: number) {
  if (!months) return "";
  return `${months} month${months === 1 ? "" : "s"}`;
}

export function deviceName(item: ApprovalItem) {
  return [item.brand, item.model_name].filter(Boolean).join(" ") || "Rental device";
}
