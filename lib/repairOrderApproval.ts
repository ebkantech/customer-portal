/*
 * Types for GET/POST /api/public/repair-order-approvals/<token>/ -- mirrors
 * Django's repairs.serializers.PublicRepairOrderApprovalSerializer, whose
 * devices come from the immutable snapshot built by
 * repairs.services._repair_order_snapshot when the link was issued.
 *
 * One decision covers every device in the order: "approve" (consent
 * required) or "reject" (optional reason). No request-changes step.
 */

export type RepairOrderLine = {
  description?: string;
  quantity?: number;
  unit_price?: number | string;
  line_total?: number | string;
};

export type RepairOrderDevice = {
  ticket_code?: string;
  estimate_version?: number;
  brand?: string;
  model_name?: string;
  serial?: string;
  reported_issue?: string;
  lines?: RepairOrderLine[];
  total_amount?: number | string;
};

export type RepairOrderApproval = {
  status: "pending" | "approved" | "rejected" | "expired" | "revoked" | string;
  source?: string;
  decided_at?: string | null;
  expires_at?: string | null;
  version?: number;
  order_code?: string;
  customer?: { name?: string; classification?: string | null };
  repair_type?: string;
  devices: RepairOrderDevice[];
  currency?: string;
  grand_total?: number | string;
  terms?: string;
};

export type RepairOrderDecision = "approve" | "reject";

export const ORDER_DECISION_RESULT: Record<RepairOrderDecision, string> = {
  approve: "approved",
  reject: "rejected",
};

/** PublicApprovalDecisionSerializer.reason max_length. */
export const ORDER_REASON_MAX = 500;

export function isRepairOrderPayload(data: unknown): data is RepairOrderApproval {
  return (
    !!data &&
    typeof data === "object" &&
    typeof (data as RepairOrderApproval).status === "string" &&
    Array.isArray((data as RepairOrderApproval).devices)
  );
}

export function orderDeviceName(device: RepairOrderDevice) {
  return [device.brand, device.model_name].filter(Boolean).join(" ") || "Device";
}
