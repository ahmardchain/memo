"use client";

import { useEffect, useMemo, useState } from "react";
import { ESCROW_CONTRACT, MAINNET_ESCROW_FOR_QUOTES, NETWORK, USDC_CONTRACT, USDC_NEAR_ASSET } from "@/config";
import { ONE_YOCTO, TGAS, useEscrow } from "@/lib/near";
import { formatUsdc } from "@/lib/format";
import {
  chainName,
  getQuote,
  getStatus,
  getTokens,
  isTerminal,
  sortTokens,
  type OneClickToken,
  type QuoteResponse,
  type StatusResponse,
} from "@/lib/oneclick";
import type { Deal } from "@/lib/types";
import { useAction } from "./useAction";

export function FundPanel({ deal, onChange }: { deal: Deal; onChange: () => void }) {
  const [tab, setTab] = useState<"near" | "any">("near");
  const remaining = (BigInt(deal.total) - BigInt(deal.funded)).toString();
  return (
    <section className="card">
      <h2>Fund the escrow</h2>
      <p className="muted small">
        {formatUsdc(remaining)} still needed. Funds sit in the contract, not with memo or the supplier, until milestones are approved.
      </p>
      <div className="tabs" role="tablist">
        <button className={`tab ${tab === "near" ? "on" : ""}`} onClick={() => setTab("near")}>USDC on NEAR</button>
        <button className={`tab ${tab === "any" ? "on" : ""}`} onClick={() => setTab("any")}>Any token, any chain</button>
      </div>
      {tab === "near" ? <DirectFund deal={deal} remaining={remaining} onChange={onChange} /> : <AnyChainFund deal={deal} remaining={remaining} onChange={onChange} />}
    </section>
  );
}

function DirectFund({ deal, remaining, onChange }: { deal: Deal; remaining: string; onChange: () => void }) {
  const { accountId, usdcBalance, send } = useEscrow();
  const { busy, error, run } = useAction();
  const [balance, setBalance] = useState<string | null>(null);
  useEffect(() => {
    if (accountId) usdcBalance(accountId).then(setBalance).catch(() => setBalance(null));
  }, [accountId, usdcBalance, busy]);
  const enough = balance !== null && BigInt(balance) >= BigInt(remaining);

  return (
    <div>
      <p className="small">
        One <code>ft_transfer_call</code> moves {formatUsdc(remaining)} from your wallet into the escrow and credits deal #{deal.id}.
      </p>
      <p className="small muted">Your balance: {balance === null ? "…" : formatUsdc(balance)}</p>
      <button
        className="btn btn-primary btn-block"
        disabled={!!busy || !enough}
        onClick={async () => {
          await run(
            "fund",
            () =>
              send([
                {
                  receiverId: USDC_CONTRACT,
                  method: "ft_transfer_call",
                  args: { receiver_id: ESCROW_CONTRACT, amount: remaining, msg: JSON.stringify({ deal_id: deal.id }) },
                  deposit: ONE_YOCTO,
                  gas: BigInt(100) * TGAS,
                },
              ]),
            "Escrow funded",
          );
          onChange();
        }}
      >
        {busy ? <span className="spinner" /> : null} Fund {formatUsdc(remaining)}
      </button>
      {!enough && balance !== null && <p className="hint">Not enough USDC in this wallet. Use “Any token, any chain” or top up first.</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

const STORAGE_KEY = (id: number) => `memo:oneclick:${NETWORK}:${id}`;

function AnyChainFund({ deal, remaining, onChange }: { deal: Deal; remaining: string; onChange: () => void }) {
  const live = NETWORK === "mainnet";
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [assetId, setAssetId] = useState("");
  const [refundTo, setRefundTo] = useState("");
  // Resume a swap the user already started for this deal.
  const [quote, setQuote] = useState<QuoteResponse | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY(deal.id));
      return saved ? (JSON.parse(saved) as QuoteResponse) : null;
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    getTokens()
      .then((t) => {
        const list = sortTokens(t.filter((x) => x.assetId !== USDC_NEAR_ASSET && x.blockchain !== "near"));
        setTokens(list);
        const tronUsdt = list.find((x) => x.symbol === "USDT" && x.blockchain === "tron");
        setAssetId((cur) => cur || tronUsdt?.assetId || list[0]?.assetId || "");
      })
      .catch(() => setTokens([]));
  }, []);

  const token = useMemo(() => tokens.find((t) => t.assetId === assetId), [tokens, assetId]);
  const depositAddress = quote?.quote.depositAddress;

  // Poll swap status every 5s until terminal.
  useEffect(() => {
    if (!live || !depositAddress) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await getStatus(depositAddress, quote?.quote.depositMemo);
        if (stop) return;
        setStatus(s);
        if (s.status === "SUCCESS") onChange();
        if (isTerminal(s.status)) return;
      } catch {}
      if (!stop) setTimeout(tick, 5000);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [live, depositAddress, quote?.quote.depositMemo, onChange]);

  async function requestQuote(dry: boolean) {
    const q = await run("quote", () =>
      getQuote({
        dry,
        // We need an exact USDC amount to land in escrow; 1-Click computes the input.
        swapType: "EXACT_OUTPUT",
        slippageTolerance: 100,
        originAsset: assetId,
        depositType: "ORIGIN_CHAIN",
        destinationAsset: USDC_NEAR_ASSET,
        amount: remaining,
        // Output is withdrawn to the escrow with ft_transfer_call(msg) → ft_on_transfer credits this deal.
        recipient: live ? ESCROW_CONTRACT : MAINNET_ESCROW_FOR_QUOTES,
        recipientType: "DESTINATION_CHAIN",
        customRecipientMsg: JSON.stringify({ deal_id: deal.id }),
        refundTo,
        refundType: "ORIGIN_CHAIN",
        deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        referral: "memo",
      }),
    );
    if (q) {
      setQuote(q);
      setStatus(null);
      if (!dry) {
        try {
          localStorage.setItem(STORAGE_KEY(deal.id), JSON.stringify(q));
        } catch {}
      }
    }
  }

  return (
    <div>
      {!live && (
        <div className="callout callout-warn small" style={{ marginBottom: 12 }}>
          NEAR Intents runs on mainnet only. On this testnet demo you can fetch a real <b>dry-run</b> quote from the
          1-Click API; no deposit address is issued and nothing moves.
        </div>
      )}
      <div className="field">
        <label htmlFor="asset">Pay with</label>
        <select id="asset" value={assetId} onChange={(e) => { setAssetId(e.target.value); setQuote(null); }}>
          {tokens.map((t) => (
            <option key={t.assetId} value={t.assetId}>
              {t.symbol} on {chainName(t.blockchain)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="refund">Your refund address on {token ? chainName(token.blockchain) : "that chain"}</label>
        <input id="refund" placeholder={token?.blockchain === "tron" ? "T…" : token?.blockchain === "sol" ? "Solana address" : "0x…"} value={refundTo} onChange={(e) => setRefundTo(e.target.value.trim())} autoCapitalize="none" />
        <div className="hint">If the swap can&apos;t complete, 1-Click returns your funds here.</div>
      </div>
      <div className="row">
        <button className="btn" disabled={!!busy || !assetId || !refundTo} onClick={() => requestQuote(true)}>
          {busy === "quote" ? <span className="spinner" /> : null} Preview price
        </button>
        {live && (
          <button className="btn btn-primary" disabled={!!busy || !assetId || !refundTo} onClick={() => requestQuote(false)}>
            Get deposit address
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      {quote && (
        <div className="callout callout-info" style={{ marginTop: 16 }}>
          <div className="kv">
            <dt>You send</dt>
            <dd><b>{quote.quote.amountInFormatted} {token?.symbol}</b> on {token ? chainName(token.blockchain) : ""}{quote.quote.amountInUsd ? ` (≈ $${Number(quote.quote.amountInUsd).toFixed(2)})` : ""}</dd>
            <dt>Escrow receives</dt>
            <dd><b>{quote.quote.amountOutFormatted} USDC</b> credited to deal #{deal.id}</dd>
            {quote.quote.timeEstimate != null && (<><dt>Estimated time</dt><dd>~{quote.quote.timeEstimate}s after your deposit confirms</dd></>)}
            {depositAddress && (
              <>
                <dt>Deposit address</dt>
                <dd><code style={{ fontSize: 15 }}>{depositAddress}</code> <CopyBtn text={depositAddress} /></dd>
                {quote.quote.depositMemo && (<><dt>Memo (required)</dt><dd><code>{quote.quote.depositMemo}</code></dd></>)}
                {quote.quote.deadline && (<><dt>Send before</dt><dd>{new Date(quote.quote.deadline).toLocaleString()}</dd></>)}
              </>
            )}
          </div>
          {depositAddress && (
            <p className="small" style={{ marginTop: 10, marginBottom: 0 }}>
              Send exactly <b>{quote.quote.amountInFormatted} {token?.symbol}</b> from any wallet. Status:{" "}
              <b>{status?.status ?? "waiting for deposit"}</b>
              {status?.status === "SUCCESS" && " — USDC delivered to escrow."}
            </p>
          )}
          {!depositAddress && (
            <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>Dry-run quote from the live 1-Click API.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="btn btn-sm"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        });
      }}
    >
      {ok ? "Copied" : "Copy"}
    </button>
  );
}
