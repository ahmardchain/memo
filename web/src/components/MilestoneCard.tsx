"use client";

import { useState } from "react";
import { STORAGE_DEPOSIT, useEscrow } from "@/lib/near";
import { formatDate, formatUsdc, relative } from "@/lib/format";
import { sha256File } from "@/lib/hash";
import type { Deal, Milestone } from "@/lib/types";
import { MilestoneBadge } from "./StatusBadge";
import { useAction } from "./useAction";
import { ProofChecker } from "./ProofChecker";
import { useNow } from "@/lib/useNow";

interface Props {
  deal: Deal;
  index: number;
  role: { buyer: boolean; supplier: boolean };
  onChange: () => void;
}

export function MilestoneCard({ deal, index, role, onChange }: Props) {
  const m = deal.milestones[index];
  const now = useNow();
  const active = deal.status === "Active";
  const expired = m.status === "Pending" && now > m.deadline_ms;
  const reviewEndsAt = m.proof ? m.proof.submitted_at_ms + deal.review_window_ms : 0;

  const dotClass = m.status === "Released" || m.status === "Resolved" ? "done" : m.status === "Refunded" || expired ? "bad" : m.status === "Submitted" ? "active" : "";

  return (
    <li className="tl-item">
      <span className={`tl-dot ${dotClass}`}>{m.status === "Released" || m.status === "Resolved" ? "✓" : index + 1}</span>
      <div className="milestone">
        <div className="row between">
          <div>
            <b>{m.title}</b>
            <div className="small muted">
              {m.basis_points / 100}% · {formatUsdc(m.amount)}
            </div>
          </div>
          <MilestoneBadge status={m.status} />
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          {m.status === "Pending" && (
            <>Proof due {formatDate(m.deadline_ms)} ({relative(m.deadline_ms, now)}){expired && <b style={{ color: "var(--warn)" }}> · deadline missed</b>}</>
          )}
          {m.settled_at_ms && <>Settled {formatDate(m.settled_at_ms)}</>}
          {m.status === "Submitted" && <>Buyer review ends {formatDate(reviewEndsAt)} ({relative(reviewEndsAt, now)})</>}
        </div>
        {m.last_rejection && m.status === "Pending" && (
          <div className="callout callout-warn small" style={{ marginTop: 8 }}>Buyer rejected the last proof: “{m.last_rejection}”</div>
        )}
        {m.proof && <ProofView milestone={m} />}
        {m.proof && m.status === "Submitted" && role.buyer && <ProofChecker deal={deal} index={index} />}

        {active && role.supplier && m.status === "Pending" && !expired && <ProofForm deal={deal} index={index} onChange={onChange} />}
        {active && role.buyer && m.status === "Submitted" && <BuyerReview deal={deal} index={index} onChange={onChange} />}
        {active && role.supplier && m.status === "Submitted" && now > reviewEndsAt && (
          <SupplierClaim deal={deal} index={index} onChange={onChange} />
        )}
      </div>
    </li>
  );
}

function ProofView({ milestone }: { milestone: Milestone }) {
  const p = milestone.proof!;
  const [match, setMatch] = useState<boolean | null>(null);
  return (
    <div className="proof">
      <div><b>Proof</b> · submitted {formatDate(p.submitted_at_ms)}</div>
      {p.description && <p style={{ margin: "4px 0" }}>{p.description}</p>}
      {p.uri && (
        <div className="small">
          File: <a href={p.uri} target="_blank" rel="noreferrer noopener">{p.uri}</a>
        </div>
      )}
      <div className="small muted">SHA-256 <code>{p.hash}</code></div>
      <label className="small" style={{ marginTop: 8, fontWeight: 600 }}>
        Verify a document against this hash
        <input
          type="file"
          style={{ marginTop: 4 }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setMatch((await sha256File(f)) === p.hash);
          }}
        />
      </label>
      {match === true && <div className="badge b-green">✓ Matches the on-chain proof</div>}
      {match === false && <div className="badge b-red">✗ Different file — not what the supplier submitted</div>}
    </div>
  );
}

function ProofForm({ deal, index, onChange }: { deal: Deal; index: number; onChange: () => void }) {
  const { call } = useEscrow();
  const { busy, error, run } = useAction();
  const [hash, setHash] = useState("");
  const [fileName, setFileName] = useState("");
  const [description, setDescription] = useState("");
  const [uri, setUri] = useState("");
  return (
    <div style={{ marginTop: 12 }}>
      <div className="field">
        <label>Upload proof (photo, invoice, bill of lading)</label>
        <input
          type="file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFileName(f.name);
            setHash(await sha256File(f));
          }}
        />
        <div className="hint">
          The file stays on your device; only its SHA-256 fingerprint goes on-chain. Share the file with the buyer (or add a link below) so they can verify it.
          {hash && <><br />Fingerprint of {fileName}: <code>{hash.slice(0, 16)}…</code></>}
        </div>
      </div>
      <div className="field">
        <label>Description</label>
        <textarea maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="2,000 units packed, 40 pallets. B/L no. COSU6312459870, vessel departs Nansha 14 Nov." />
      </div>
      <div className="field">
        <label>Link to file (optional)</label>
        <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="https://… or ipfs://…" />
      </div>
      <button
        className="btn btn-primary"
        disabled={!hash || !!busy}
        onClick={async () => {
          await run(
            "proof",
            () => call("submit_proof", { deal_id: deal.id, milestone: index, hash, description, uri: uri.trim() || null }, STORAGE_DEPOSIT),
            "Proof submitted",
          );
          onChange();
        }}
      >
        {busy ? <span className="spinner" /> : null} Submit proof
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function BuyerReview({ deal, index, onChange }: { deal: Deal; index: number; onChange: () => void }) {
  const { call } = useEscrow();
  const { busy, error, run } = useAction();
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const m = deal.milestones[index];
  return (
    <div style={{ marginTop: 12 }}>
      {!rejecting ? (
        <div className="row">
          <button
            className="btn btn-primary"
            disabled={!!busy}
            onClick={async () => {
              await run("approve", () => call("approve_milestone", { deal_id: deal.id, milestone: index }), `Released ${formatUsdc(m.amount)} to ${deal.supplier}`);
              onChange();
            }}
          >
            {busy === "approve" ? <span className="spinner" /> : null} Approve & release {formatUsdc(m.amount)}
          </button>
          <button className="btn" onClick={() => setRejecting(true)}>Reject proof</button>
        </div>
      ) : (
        <div>
          <div className="field">
            <label>Why are you rejecting it?</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Photos show a different model number" maxLength={500} />
          </div>
          <div className="row">
            <button
              className="btn btn-danger"
              disabled={!!busy || !reason.trim()}
              onClick={async () => {
                await run("reject", () => call("reject_proof", { deal_id: deal.id, milestone: index, reason }), "Proof rejected");
                setRejecting(false);
                onChange();
              }}
            >
              Reject
            </button>
            <button className="btn" onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </div>
      )}
      <p className="hint">Approving pays {deal.supplier} — the locked payout account — and nobody else.</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function SupplierClaim({ deal, index, onChange }: { deal: Deal; index: number; onChange: () => void }) {
  const { call } = useEscrow();
  const { busy, error, run } = useAction();
  return (
    <div style={{ marginTop: 12 }}>
      <button
        className="btn btn-primary"
        disabled={!!busy}
        onClick={async () => {
          await run("claim", () => call("claim_unreviewed", { deal_id: deal.id, milestone: index }), "Milestone released");
          onChange();
        }}
      >
        Buyer didn&apos;t respond in time — release this milestone
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
