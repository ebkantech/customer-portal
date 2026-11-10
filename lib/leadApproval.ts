/*
 * Types for GET/POST /api/public/lead-approvals/<token>/ -- mirrors Django's
 * leads.serializers.PublicApprovalSerializer: the on-site service bill
 * (LeadQuote) a technician sent the customer for approval.
 *
 * Decisions (leads.services.customer_decide): "approve" (consent required),
 * "reject" (optional reason; only the visit charge is billed) and
 * "request_changes" (message required; the technician sends a revised bill
 * on a new link).
 */

export type LeadApprovalStatus = "pending" | "approved" | "rejected" | "changes_requested" | "expired" | "revoked";

export type LeadLine = {
  /** visit | labour | part | product */
  kind?: string;
  description?: string;
  qty?: number;
  price?: number | string;
  amount?: number | string;
};

export type LeadApproval = {
  status: LeadApprovalStatus | string;
  lead_code?: string;
  customer_name?: string;
  device?: string;
  issue?: string;
  diagnosis?: string;
  site_address?: string;
  advance_amount?: number | null;
  version?: number;
  /** The technician's note on the bill. */
  note?: string;
  lines: LeadLine[];
  total?: number | string;
  expires_at?: string | null;
  decided_at?: string | null;
  /** The customer's own reason / change request, once recorded. */
  reason?: string;
};

export type LeadDecision = "approve" | "reject" | "request_changes";

export const LEAD_DECISION_RESULT: Record<LeadDecision, LeadApprovalStatus> = {
  approve: "approved",
  reject: "rejected",
  request_changes: "changes_requested",
};

/** PublicDecisionSerializer.reason max_length. */
export const LEAD_MESSAGE_MAX = 500;

/** LeadQuoteLine.KIND_CHOICES, as the customer reads them. */
export const LINE_KIND: Record<string, string> = {
  visit: "Visit",
  labour: "Service",
  part: "Part",
  product: "Product",
};

export function isLeadApprovalPayload(data: unknown): data is LeadApproval {
  return (
    !!data &&
    typeof data === "object" &&
    typeof (data as LeadApproval).status === "string" &&
    Array.isArray((data as LeadApproval).lines)
  );
}
