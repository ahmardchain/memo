"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { STORAGE_DEPOSIT, TGAS, useEscrow, useNear } from "@/lib/near";
import { formatUsdc, parseUsdc } from "@/lib/format";
import { useAction } from "@/components/useAction";
import { useNow } from "@/lib/useNow";

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const DEFAULT_ARBITER = process.env.NEXT_PUBLIC_DEFAULT_ARBITER || "";
const DAY = 86_400_000;

interface MsForm {
  title: string;
  percent: string;
  deadline: string; // datetime-local value
}

function toLocalInput(ms: number) {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export default function CreateDeal() {
  const router = useRouter();
  const { accountId, signIn } = useNear();
  const { call } = useEscrow();
  const { busy, error, run, setError } = useAction();

  const [title, setTitle] = useState("2,000 LED panel units");
  const [supplierName, setSupplierName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [arbiter, setArbiter] = useState(DEFAULT_ARBITER);
  const [total, setTotal] = useState("");
  const [reviewDays, setReviewDays] = useState("7");
  const [milestones, setMilestones] = useState<MsForm[]>(() => [
    { title: "Production complete (photos of finished goods)", percent: "30", deadline: toLocalInput(Date.now() + 21 * DAY) },
    { title: "Shipped (bill of lading / tracking number)", percent: "70", deadline: toLocalInput(Date.now() + 45 * DAY) },
  ]);

  const now = useNow(10_000);
  const pctSum = milestones.reduce((s, m) => s + (Number(m.percent) || 0), 0);
  const totalUnits = parseUsdc(total);

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!title.trim()) p.push("Describe what you are buying.");
    if (!supplierName.trim()) p.push("Add the supplier's name.");
    if (!ACCOUNT_RE.test(supplier)) p.push("Supplier NEAR account looks invalid.");
    if (supplier && supplier === accountId) p.push("Supplier can't be you.");
    if (!ACCOUNT_RE.test(arbiter)) p.push("Arbiter NEAR account looks invalid.");
    if (arbiter && (arbiter === accountId || arbiter === supplier)) p.push("Arbiter must be a third party.");
    if (!totalUnits || totalUnits === "0") p.push("Enter the total in USDC.");
    if (Math.abs(pctSum - 100) > 1e-9) p.push(`Milestones add up to ${pctSum}%, not 100%.`);
    milestones.forEach((m, i) => {
      if (!m.title.trim()) p.push(`Milestone ${i + 1} needs a title.`);
      if (!(new Date(m.deadline).getTime() > now)) p.push(`Milestone ${i + 1} deadline must be in the future.`);
    });
    return p;
  }, [title, supplierName, supplier, arbiter, totalUnits, pctSum, milestones, accountId, now]);

  const update = (i: number, patch: Partial<MsForm>) =>
    setMilestones((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  async function submit() {
    if (problems.length) return setError(problems.join("\n"));
    // Convert percentages to basis points; the last milestone absorbs rounding.
    const bps = milestones.map((m) => Math.round(Number(m.percent) * 100));
    bps[bps.length - 1] += 10_000 - bps.reduce((a, b) => a + b, 0);
    const id = await run("create", () =>
      call(
        "create_deal",
        {
          title: title.trim(),
          supplier_name: supplierName.trim(),
          supplier,
          arbiter,
          total: totalUnits,
          milestones: milestones.map((m, i) => ({
            title: m.title.trim(),
            basis_points: bps[i],
            deadline_ms: new Date(m.deadline).getTime(),
          })),
          review_window_ms: Math.max(1, Math.round(Number(reviewDays) * DAY)),
        },
        STORAGE_DEPOSIT,
        BigInt(100) * TGAS,
      ),
    );
    if (typeof id === "number") router.push(`/deal/?id=${id}&created=1`);
  }

  return (
    <div className="narrow stack" style={{ margin: "0 auto" }}>
      <div>
        <h1 style={{ fontSize: 32 }}>New deal</h1>
        <p className="muted">You are the buyer. Your supplier gets a link to review and accept these terms.</p>
      </div>

      <section className="card">
        <h2>What and who</h2>
        <div className="field">
          <label htmlFor="title">Goods / order</label>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="sname">Supplier name</label>
            <input id="sname" placeholder="Guangzhou Bright Lighting Co." value={supplierName} onChange={(e) => setSupplierName(e.target.value)} maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="sacc">Supplier NEAR account</label>
            <input id="sacc" placeholder="bright-lighting.near" value={supplier} onChange={(e) => setSupplier(e.target.value.trim().toLowerCase())} autoCapitalize="none" />
            <div className="hint">🔒 The only account that can ever be paid. Confirm it with the supplier by phone or video, not email.</div>
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="total">Total (USDC)</label>
            <input id="total" inputMode="decimal" placeholder="12500" value={total} onChange={(e) => setTotal(e.target.value)} />
            {totalUnits && <div className="hint">{formatUsdc(totalUnits)}</div>}
          </div>
          <div className="field">
            <label htmlFor="arb">Arbiter NEAR account</label>
            <input id="arb" placeholder="trade-arbiter.near" value={arbiter} onChange={(e) => setArbiter(e.target.value.trim().toLowerCase())} autoCapitalize="none" />
            <div className="hint">A neutral third party who can split frozen funds if you dispute.</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <h2>Milestones</h2>
          <span className={`badge ${Math.abs(pctSum - 100) < 1e-9 ? "b-green" : "b-red"}`}>{pctSum}% of 100%</span>
        </div>
        <p className="muted small">Each milestone pays out only when the supplier submits proof and you approve it.</p>
        {milestones.map((m, i) => (
          <div key={i} className="milestone" style={{ marginBottom: 12 }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <b>Milestone {i + 1}</b>
              {milestones.length > 1 && (
                <button className="btn btn-sm" onClick={() => setMilestones((ms) => ms.filter((_, j) => j !== i))}>Remove</button>
              )}
            </div>
            <div className="field">
              <label>Proof required</label>
              <input value={m.title} onChange={(e) => update(i, { title: e.target.value })} maxLength={120} />
            </div>
            <div className="grid2">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Share (%)</label>
                <input inputMode="decimal" value={m.percent} onChange={(e) => update(i, { percent: e.target.value })} />
                {totalUnits && Number(m.percent) > 0 && (
                  <div className="hint">
                    ≈ {formatUsdc(((BigInt(totalUnits) * BigInt(Math.round(Number(m.percent) * 100))) / BigInt(10_000)).toString())}
                  </div>
                )}
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Proof deadline</label>
                <input type="datetime-local" value={m.deadline} onChange={(e) => update(i, { deadline: e.target.value })} />
              </div>
            </div>
          </div>
        ))}
        {milestones.length < 10 && (
          <button
            className="btn btn-sm"
            onClick={() => setMilestones((ms) => [...ms, { title: "", percent: "0", deadline: toLocalInput(Date.now() + 60 * DAY) }])}
          >
            + Add milestone
          </button>
        )}
        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="rev">Your review window (days)</label>
          <input id="rev" inputMode="decimal" value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} />
          <div className="hint">If you neither approve, reject nor dispute a proof within this window, the supplier may release that milestone. Keeps both sides honest.</div>
        </div>
      </section>

      <section className="card">
        {!accountId ? (
          <button className="btn btn-primary btn-block" onClick={signIn}>Connect wallet to create</button>
        ) : (
          <button className="btn btn-primary btn-block" onClick={submit} disabled={!!busy}>
            {busy ? <span className="spinner" /> : null} Create deal
          </button>
        )}
        <p className="hint center">Attaches 0.05 NEAR for on-chain storage; the unused part is refunded.</p>
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  );
}
