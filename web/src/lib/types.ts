// Mirrors contract/src/types.rs (JSON shape returned by the escrow views).
export type DealStatus =
  | "Proposed"
  | "Accepted"
  | "Active"
  | "Disputed"
  | "Completed"
  | "Cancelled"
  | "Resolved";

export type MilestoneStatus = "Pending" | "Submitted" | "Released" | "Refunded" | "Resolved";

export interface Proof {
  hash: string;
  description: string;
  uri: string | null;
  submitted_at_ms: number;
}

export interface Milestone {
  title: string;
  basis_points: number;
  amount: string;
  deadline_ms: number;
  status: MilestoneStatus;
  proof: Proof | null;
  last_rejection: string | null;
  settled_at_ms: number | null;
}

export interface Dispute {
  opened_by: string;
  reason: string;
  opened_at_ms: number;
  resolution: { to_supplier: string; to_buyer: string; note: string; resolved_at_ms: number } | null;
}

export interface Deal {
  id: number;
  title: string;
  buyer: string;
  supplier_name: string;
  supplier: string;
  arbiter: string;
  total: string;
  funded: string;
  released: string;
  refunded: string;
  review_window_ms: number;
  milestones: Milestone[];
  status: DealStatus;
  created_at_ms: number;
  accepted_at_ms: number | null;
  activated_at_ms: number | null;
  dispute: Dispute | null;
}
