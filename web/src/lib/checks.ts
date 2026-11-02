import type { Deal } from "./types";

const SHIPPING_RE = /(ship|bill of lading|b\/l|tracking|vessel|freight|container|awb|airway)/i;
// Bill of lading / container / tracking style references: 4 letters + 6-12 digits, or long digit runs.
const REFERENCE_RE = /\b([A-Z]{4}\s?\d{6,12}|\d{10,})\b/;
const URGENCY_RE = /(new (bank|account|wallet|address)|changed? (our|the) (bank|account|details)|pay (to|into) (this|another)|urgent)/i;

/** Deterministic red-flag rules. They advise; they never block or move money. */
export function basicChecks(deal: Deal, index: number): string[] {
  const m = deal.milestones[index];
  const p = m.proof;
  if (!p) return [];
  const flags: string[] = [];
  const text = `${p.description} ${p.uri ?? ""}`;
  if (!p.description.trim()) flags.push("No description was provided with this proof.");
  if (!p.uri) flags.push("No file link attached — ask the supplier to send you the file, then use “Verify a document” to check it matches the on-chain hash.");
  if (SHIPPING_RE.test(m.title) && !REFERENCE_RE.test(text.toUpperCase())) {
    flags.push("This is a shipping milestone but no bill of lading, container or tracking number appears in the proof. Ask for one and check it with the carrier.");
  }
  if (URGENCY_RE.test(text)) {
    flags.push("The proof mentions new or changed payment details. memo will only ever pay the locked account " + deal.supplier + "; treat any request to pay elsewhere as fraud.");
  }
  if (p.submitted_at_ms - (deal.activated_at_ms ?? 0) < 60 * 60 * 1000 && index === 0) {
    flags.push("Production proof arrived within an hour of funding. Make sure the photos are of your order (ask for your PO number written on a box).");
  }
  return flags;
}
