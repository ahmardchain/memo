import type { DealStatus, MilestoneStatus } from "@/lib/types";

const DEAL: Record<DealStatus, [string, string]> = {
  Proposed: ["Awaiting supplier", "b-amber"],
  Accepted: ["Awaiting funding", "b-amber"],
  Active: ["Funded · in progress", "b-blue"],
  Disputed: ["Disputed · frozen", "b-red"],
  Completed: ["Completed", "b-green"],
  Cancelled: ["Cancelled", ""],
  Resolved: ["Resolved by arbiter", "b-green"],
};

const MS: Record<MilestoneStatus, [string, string]> = {
  Pending: ["Awaiting proof", ""],
  Submitted: ["Proof submitted", "b-blue"],
  Released: ["Paid to supplier", "b-green"],
  Refunded: ["Refunded to buyer", "b-amber"],
  Resolved: ["Settled by arbiter", "b-green"],
};

export function DealBadge({ status }: { status: DealStatus }) {
  const [label, cls] = DEAL[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function MilestoneBadge({ status }: { status: MilestoneStatus }) {
  const [label, cls] = MS[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}
