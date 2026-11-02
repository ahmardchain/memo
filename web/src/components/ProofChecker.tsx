"use client";

import { useMemo } from "react";
import type { Deal } from "@/lib/types";
import { basicChecks } from "@/lib/checks";

/** Advisory red-flag check shown to the buyer before approving. Never moves money. */
export function ProofChecker({ deal, index }: { deal: Deal; index: number }) {
  const flags = useMemo(() => basicChecks(deal, index), [deal, index]);
  if (!flags.length) return null;
  return (
    <div className="callout callout-warn small" style={{ marginTop: 10 }}>
      <b>Before you approve</b>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        {flags.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  );
}
