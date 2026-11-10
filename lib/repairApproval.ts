/*
 * Types for GET/POST /api/public/repair-approvals/<token>/ -- mirrors Django's
 * repairs.serializers.PublicRepairApprovalSerializer: the immutable estimate
 * snapshot (RepairEstimate + its lines) behind one secure approval link.
 *
 * Decisions accepted by repairs.services.customer_decide are "approve"
 * (consent required) and "reject" (optional reason). Repair approvals have
 * no "request changes" step: a changed estimate is issued by staff as a new
 * estimate version on a new link.
 */

export type RepairApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "revoked";

export type RepairEstimateLine = {
  id?: number;
  service_id?: number | null;
  description?: string;
  quantity?: number;
  unit_price?: number | string;
  line_total?: number | string;
};

export type RepairApproval = {
  status: RepairApprovalStatus | string;
  /** customer | admin | superadmin -- who recorded the decision. */
  source?: string;
  decided_at?: string | null;
  expires_at?: string | null;
  ticket_code?: string;
  customer_name?: string;
  device?: { brand?: string; model_name?: string; serial?: string };
  reported_issue?: string;
  estimate_version?: number;
  lines: RepairEstimateLine[];
  total_amount?: number | string;
  advance_paid?: number | string;
  balance_due?: number | string;
  currency?: string;
  terms?: string;
};

export type RepairDecision = "approve" | "reject";

/** The status each decision must produce; a 200 with anything else is not treated as success. */
export const DECISION_RESULT: Record<RepairDecision, RepairApprovalStatus> = {
  approve: "approved",
  reject: "rejected",
};

/** PublicApprovalDecisionSerializer.reason max_length. */
export const REASON_MAX = 500;

export function isRepairApprovalPayload(data: unknown): data is RepairApproval {
  return (
    !!data &&
    typeof data === "object" &&
    typeof (data as RepairApproval).status === "string" &&
    Array.isArray((data as RepairApproval).lines)
  );
}

export function deviceName(device?: RepairApproval["device"]) {
  return [device?.brand, device?.model_name].filter(Boolean).join(" ") || "Your device";
}

export function hasAmount(value?: number | string | null) {
  return value != null && value !== "" && Number.isFinite(Number(value));
}
