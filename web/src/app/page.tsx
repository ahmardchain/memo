"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useEscrow, useNear } from "@/lib/near";
import type { Deal } from "@/lib/types";
import { formatUsdc } from "@/lib/format";
import { DealBadge } from "@/components/StatusBadge";
import { Faucet } from "@/components/Faucet";

export default function Home() {
  const { accountId } = useNear();
  const { getDealsFor } = useEscrow();
  const [deals, setDeals] = useState<Deal[] | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let live = true;
    getDealsFor(accountId)
      .then((d) => live && setDeals([...d].reverse()))
      .catch(() => live && setDeals([]));
    return () => {
      live = false;
    };
  }, [accountId, getDealsFor]);

  return (
    <div className="stack">
      <section className="hero">
        <p className="small muted" style={{ fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          A stablecoin letter of credit
        </p>
        <h1>You shouldn&apos;t have to trust a stranger to trade with one.</h1>
        <p className="tag">
          memo holds a buyer&apos;s USDC in escrow on NEAR and pays the supplier milestone by milestone, on proof. The
          supplier&apos;s payout account is locked when they accept and can never be changed, so a &ldquo;new bank
          details&rdquo; email has nothing to change.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <Link href="/create/" className="btn btn-primary">Create a deal</Link>
          <a href="#how" className="btn">How it works</a>
        </div>
      </section>

      {accountId && (
        <section className="card">
          <div className="row between">
            <h2>Your deals</h2>
            <Link href="/create/" className="btn btn-sm">+ New</Link>
          </div>
          {deals === null ? (
            <p className="muted">Loading…</p>
          ) : deals.length === 0 ? (
            <p className="muted">
              No deals yet. Create one as a buyer, or open the link a buyer sent you.
            </p>
          ) : (
            <div>
              {deals.map((d) => (
                <Link key={d.id} href={`/deal/?id=${d.id}`} className="deal-row">
                  <div>
                    <div className="t" style={{ fontWeight: 600 }}>#{d.id} · {d.title}</div>
                    <div className="small muted">
                      {d.buyer === accountId ? "You buy from" : d.supplier === accountId ? "You supply" : "You arbitrate"}{" "}
                      {d.buyer === accountId ? d.supplier_name : d.supplier === accountId ? `to ${d.buyer}` : `${d.buyer} ↔ ${d.supplier}`}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{formatUsdc(d.total)}</div>
                    <DealBadge status={d.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      <Faucet />

      <section className="card">
        <h2>The problem</h2>
        <div className="grid2" style={{ marginTop: 12 }}>
          <div>
            <div className="stat">~41%</div>
            <p className="muted">of SME trade-finance requests are rejected by banks, so small importers can&apos;t get a letter of credit.</p>
          </div>
          <div>
            <div className="stat">30–100%</div>
            <p className="muted">paid upfront by wire to a supplier they&apos;ve never met, with no protection if the goods never ship, the wrong goods arrive, or the payment is redirected.</p>
          </div>
        </div>
        <p className="muted small">
          Belief: every small business deserves the payment protection that only big corporations get today.
        </p>
      </section>

      <section id="how" className="card">
        <h2>How it works</h2>
        <div className="steps" style={{ marginTop: 12 }}>
          {[
            ["Buyer creates the deal", "Amount, supplier account, milestones (default 30% production / 70% shipping), deadlines, a neutral arbiter."],
            ["Supplier accepts", "Signing with their own NEAR account locks it as the only payout destination. Forever."],
            ["Buyer funds", "USDC on NEAR directly, or any token on any chain through NEAR Intents 1-Click. It all lands as USDC in escrow."],
            ["Proof → release", "Supplier uploads proof (hash on-chain). Buyer approves and that milestone pays out. Missed deadline? Buyer reclaims."],
          ].map(([t, d], i) => (
            <div key={t}>
              <div className="step-n">STEP {i + 1}</div>
              <h3>{t}</h3>
              <p className="muted small">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
