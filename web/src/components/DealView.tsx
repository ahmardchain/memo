"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ESCROW_CONTRACT, EXPLORER, NETWORK } from "@/config";
import { STORAGE_DEPOSIT, useEscrow, useNear } from "@/lib/near";
import { formatDate, formatUsdc } from "@/lib/format";
import type { Deal } from "@/lib/types";
import { DealBadge } from "./StatusBadge";
import { FundPanel, CopyBtn } from "./FundPanel";
import { MilestoneCard } from "./MilestoneCard";
import { CashOut } from "./CashOut";
import { useAction } from "./useAction";
import { useNow } from "@/lib/useNow";

export function DealView() {
  const params = useSearchParams();
  const id = Number(params.get("id"));
  const { accountId, signIn } = useNear();
  const { getDeal } = useEscrow();
  const [deal, setDeal] = useState<Deal | null | undefined>(undefined);
  const [tick, setTick] = useState(0);

  const validId = Number.isInteger(id) && id >= 0 && params.get("id") !== null;
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!validId) return;
    let live = true;
    getDeal(id).then((d) => live && setDeal(d ?? null)).catch(() => live && setDeal(null));
    const t = setTimeout(refresh, 6000);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [id, validId, getDeal, tick, refresh]);

  if (!validId) return <div className="card">No deal id in the link.</div>;
  if (deal === undefined) return <p className="muted">Loading deal…</p>;
  if (deal === null) return <div className="card">Deal not found on <code>{ESCROW_CONTRACT}</code>.</div>;

  const role = { buyer: accountId === deal.buyer, supplier: accountId === deal.supplier, arbiter: accountId === deal.arbiter };
  const isParty = role.buyer || role.supplier || role.arbiter;
  const created = params.get("created") === "1";

  return (
    <div className="stack">
      <div>
        <div className="row between">
          <span className="small muted">Deal #{deal.id} · created {formatDate(deal.created_at_ms)}</span>
          <DealBadge status={deal.status} />
        </div>
        <h1 style={{ fontSize: 30, marginTop: 6 }}>{deal.title}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {deal.buyer} buys from <b>{deal.supplier_name}</b> · {formatUsdc(deal.total)}
        </p>
        {isParty && (
          <p className="small" style={{ marginTop: 6 }}>
            You are the <b>{role.buyer ? "buyer" : role.supplier ? "supplier" : "arbiter"}</b>.
          </p>
        )}
      </div>

      {(created || (role.buyer && deal.status === "Proposed")) && <ShareCard deal={deal} />}

      <PayeeLock deal={deal} />

      <MoneyBar deal={deal} />

      {!accountId && (
        <div className="card row between">
          <span>Connect the wallet named in this deal to take action.</span>
          <button className="btn btn-primary" onClick={signIn}>Connect wallet</button>
        </div>
      )}

      {role.supplier && deal.status === "Proposed" && <AcceptCard deal={deal} onChange={refresh} />}
      {role.buyer && deal.status === "Proposed" && (
        <div className="callout callout-info">Waiting for <b>{deal.supplier}</b> to review and accept. Send them the link above.</div>
      )}
      {role.buyer && deal.status === "Accepted" && <FundPanel deal={deal} onChange={refresh} />}
      {role.supplier && deal.status === "Accepted" && (
        <div className="callout callout-info">You accepted. Waiting for the buyer to fund {formatUsdc(BigInt(deal.total) - BigInt(deal.funded))}. Start production once the deal shows <b>Funded</b>.</div>
      )}

      <section className="card">
        <h2>Milestones</h2>
        <ol className="timeline" style={{ marginTop: 12 }}>
          {deal.milestones.map((_, i) => (
            <MilestoneCard key={i} deal={deal} index={i} role={role} onChange={refresh} />
          ))}
        </ol>
      </section>

      {deal.status === "Active" && role.buyer && <BuyerTools deal={deal} onChange={refresh} />}
      {deal.status === "Active" && (role.buyer || role.supplier) && <DisputeCard deal={deal} onChange={refresh} />}
      {deal.dispute && <DisputeView deal={deal} accountId={accountId} onChange={refresh} />}
      {role.buyer && ["Proposed", "Accepted"].includes(deal.status) && <CancelCard deal={deal} onChange={refresh} />}
      {role.supplier && BigInt(deal.released) > BigInt(0) && <CashOut />}

      <section className="card">
        <h3>Deal record</h3>
        <dl className="kv">
          <dt>Buyer</dt><dd>{deal.buyer}</dd>
          <dt>Supplier</dt><dd>{deal.supplier_name} · {deal.supplier}</dd>
          <dt>Arbiter</dt><dd>{deal.arbiter}</dd>
          <dt>Review window</dt><dd>{Math.round(deal.review_window_ms / 3_600_000)} hours</dd>
          <dt>Escrow contract</dt><dd><a href={`${EXPLORER}/address/${ESCROW_CONTRACT}`} target="_blank" rel="noreferrer">{ESCROW_CONTRACT}</a> ({NETWORK})</dd>
        </dl>
      </section>
      <p className="center"><Link href="/" className="small">← All deals</Link></p>
    </div>
  );
}

function PayeeLock({ deal }: { deal: Deal }) {
  const locked = deal.status !== "Proposed" && deal.status !== "Cancelled";
  return (
    <div className={`callout ${locked ? "callout-lock" : "callout-warn"}`}>
      <h3>{locked ? "🔒 Payout account locked" : "Payout account — locks when the supplier accepts"}</h3>
      <p style={{ margin: "4px 0" }}>
        Money from this deal can only ever go to <code style={{ fontSize: 15, fontWeight: 700 }}>{deal.supplier}</code>
        {locked && deal.accepted_at_ms ? <> — confirmed by the supplier&apos;s own signature on {formatDate(deal.accepted_at_ms)}.</> : "."}
      </p>
      <p className="small" style={{ margin: 0 }}>
        The memo contract has no function to change it — not for the buyer, the supplier, the arbiter or us. If anyone sends
        &ldquo;new bank details&rdquo;, it&apos;s a scam.
      </p>
    </div>
  );
}

function MoneyBar({ deal }: { deal: Deal }) {
  const total = BigInt(deal.total);
  const released = BigInt(deal.released);
  const refunded = BigInt(deal.refunded);
  const locked = BigInt(deal.funded) - released - refunded;
  const pct = (v: bigint) => (total === BigInt(0) ? 0 : Number((v * BigInt(10_000)) / total) / 100);
  return (
    <section className="card">
      <div className="bar" aria-hidden>
        <span className="released" style={{ width: `${pct(released)}%` }} />
        <span className="locked" style={{ width: `${pct(locked)}%` }} />
        <span className="refunded" style={{ width: `${pct(refunded)}%` }} />
      </div>
      <div className="legend">
        <div><div className="k"><span className="dot" style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }} />Total</div><div className="v">{formatUsdc(total)}</div></div>
        <div><div className="k"><span className="dot" style={{ background: "color-mix(in srgb, var(--accent) 35%, var(--surface-2))" }} />In escrow</div><div className="v">{formatUsdc(locked)}</div></div>
        <div><div className="k"><span className="dot" style={{ background: "var(--accent)" }} />Paid to supplier</div><div className="v">{formatUsdc(released)}</div></div>
        <div><div className="k"><span className="dot" style={{ background: "var(--warn)" }} />Refunded</div><div className="v">{formatUsdc(refunded)}</div></div>
      </div>
    </section>
  );
}

function ShareCard({ deal }: { deal: Deal }) {
  // Only rendered client-side (after the deal loads), so `window` is available.
  const url = `${window.location.origin}${window.location.pathname}?id=${deal.id}`;
  const text = `Hi ${deal.supplier_name}, I've set up our order "${deal.title}" (${formatUsdc(deal.total)}) on memo. Please review the milestones and accept with your NEAR account ${deal.supplier}:`;
  return (
    <section className="card">
      <h3>Send this deal to your supplier</h3>
      <div className="row" style={{ marginTop: 8 }}>
        <code style={{ flex: 1, minWidth: 0 }}>{url}</code>
        <CopyBtn text={url} />
        <a className="btn btn-sm" target="_blank" rel="noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`}>Telegram</a>
        <a className="btn btn-sm" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}>WhatsApp</a>
      </div>
    </section>
  );
}

function AcceptCard({ deal, onChange }: { deal: Deal; onChange: () => void }) {
  const { accountId, withRegistration, send } = useEscrow();
  const { busy, error, run } = useAction();
  return (
    <section className="card">
      <h2>Review and accept</h2>
      <p>
        <b>{deal.buyer}</b> wants to buy <b>{deal.title}</b> for <b>{formatUsdc(deal.total)}</b>. Funds are locked in escrow
        before you start, and each milestone pays out when the buyer approves your proof.
      </p>
      <p className="small muted">
        Disputes go to <b>{deal.arbiter}</b>. If the buyer doesn&apos;t review a proof within{" "}
        {Math.round(deal.review_window_ms / 3_600_000)} hours you can release it yourself.
      </p>
      <div className="callout callout-lock small" style={{ margin: "12px 0" }}>
        Accepting locks <b>{accountId}</b> as the only account this deal can pay. Make sure you control it.
      </div>
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={!!busy}
          onClick={async () => {
            await run(
              "accept",
              async () => send(await withRegistration(accountId, [{ receiverId: ESCROW_CONTRACT, method: "accept_deal", args: { deal_id: deal.id } }])),
              "Deal accepted — payout account locked",
            );
            onChange();
          }}
        >
          {busy === "accept" ? <span className="spinner" /> : null} Accept & lock my payout account
        </button>
        <DeclineBtn deal={deal} onChange={onChange} />
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function DeclineBtn({ deal, onChange }: { deal: Deal; onChange: () => void }) {
  const { call } = useEscrow();
  const { busy, run } = useAction();
  return (
    <button className="btn" disabled={!!busy} onClick={async () => { await run("decline", () => call("decline_deal", { deal_id: deal.id }), "Deal declined"); onChange(); }}>
      Decline
    </button>
  );
}

function BuyerTools({ deal, onChange }: { deal: Deal; onChange: () => void }) {
  const { call } = useEscrow();
  const { busy, error, run } = useAction();
  const now = useNow();
  const expired = deal.milestones.filter((m) => m.status === "Pending" && now > m.deadline_ms);
  if (!expired.length) return null;
  const amount = expired.reduce((s, m) => s + BigInt(m.amount), BigInt(0));
  return (
    <section className="card callout-warn">
      <h2>Deadline missed</h2>
      <p>{expired.length} milestone(s) passed their deadline without proof. You can take back {formatUsdc(amount)} now.</p>
      <button className="btn btn-primary" disabled={!!busy} onClick={async () => { await run("reclaim", () => call("reclaim_expired", { deal_id: deal.id }), `Reclaimed ${formatUsdc(amount)}`); onChange(); }}>
        {busy ? <span className="spinner" /> : null} Reclaim {formatUsdc(amount)}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function DisputeCard({ deal, onChange }: { deal: Deal; onChange: () => void }) {
  const { call } = useEscrow();
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <section className="card">
      <div className="row between">
        <div>
          <h3>Something wrong?</h3>
          <p className="small muted" style={{ margin: 0 }}>Opening a dispute freezes all remaining funds until {deal.arbiter} decides.</p>
        </div>
        {!open && <button className="btn btn-danger" onClick={() => setOpen(true)}>Open dispute</button>}
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div className="field">
            <label>What happened?</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="The bill of lading number doesn't exist on the carrier's site." />
          </div>
          <div className="row">
            <button className="btn btn-danger" disabled={!!busy || !reason.trim()} onClick={async () => { await run("dispute", () => call("open_dispute", { deal_id: deal.id, reason }, STORAGE_DEPOSIT), "Dispute opened — funds frozen"); setOpen(false); onChange(); }}>
              Freeze funds & dispute
            </button>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function DisputeView({ deal, accountId, onChange }: { deal: Deal; accountId: string; onChange: () => void }) {
  const { call } = useEscrow();
  const { busy, error, run } = useAction();
  const d = deal.dispute!;
  const locked = BigInt(deal.funded) - BigInt(deal.released) - BigInt(deal.refunded);
  const [pct, setPct] = useState(50);
  const [note, setNote] = useState("");
  const toSupplier = (locked * BigInt(pct)) / BigInt(100);
  return (
    <section className={`card ${d.resolution ? "" : "callout-danger"}`}>
      <h2>{d.resolution ? "Dispute resolved" : "Dispute — funds frozen"}</h2>
      <p className="small">Opened by <b>{d.opened_by}</b> on {formatDate(d.opened_at_ms)}: “{d.reason}”</p>
      {d.resolution && (
        <p>
          Arbiter sent <b>{formatUsdc(d.resolution.to_supplier)}</b> to the supplier and <b>{formatUsdc(d.resolution.to_buyer)}</b> back to the buyer.
          {d.resolution.note && <> Note: “{d.resolution.note}”</>}
        </p>
      )}
      {!d.resolution && accountId === deal.arbiter && (
        <div style={{ marginTop: 12 }}>
          <label>Split the {formatUsdc(locked)} still in escrow</label>
          <input type="range" min={0} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} />
          <p className="small">Supplier ({deal.supplier}): <b>{formatUsdc(toSupplier)}</b> · Buyer ({deal.buyer}): <b>{formatUsdc(locked - toSupplier)}</b></p>
          <div className="field"><label>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
          <button className="btn btn-primary" disabled={!!busy} onClick={async () => { await run("resolve", () => call("resolve_dispute", { deal_id: deal.id, to_supplier: toSupplier.toString(), note }), "Dispute resolved"); onChange(); }}>
            Resolve dispute
          </button>
        </div>
      )}
      {!d.resolution && accountId === d.opened_by && (
        <button className="btn" style={{ marginTop: 8 }} disabled={!!busy} onClick={async () => { await run("withdraw", () => call("withdraw_dispute", { deal_id: deal.id }), "Dispute withdrawn"); onChange(); }}>
          Withdraw dispute
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function CancelCard({ deal, onChange }: { deal: Deal; onChange: () => void }) {
  const { call } = useEscrow();
  const { busy, error, run } = useAction();
  return (
    <section className="card row between">
      <span className="small muted">Changed your mind? You can cancel until the deal is fully funded{BigInt(deal.funded) > BigInt(0) ? `; ${formatUsdc(deal.funded)} comes back to you` : ""}.</span>
      <button className="btn btn-danger btn-sm" disabled={!!busy} onClick={async () => { await run("cancel", () => call("cancel_deal", { deal_id: deal.id }), "Deal cancelled"); onChange(); }}>Cancel deal</button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
