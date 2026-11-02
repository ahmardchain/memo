"use client";

import { useEffect, useMemo, useState } from "react";
import { NETWORK, USDC_CONTRACT, USDC_NEAR_ASSET } from "@/config";
import { ONE_YOCTO, TGAS, useEscrow } from "@/lib/near";
import { formatUsdc, parseUsdc } from "@/lib/format";
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
import { useAction } from "./useAction";

/**
 * Supplier payout to another chain. The escrow always pays the locked NEAR
 * account (that's the anti-redirect guarantee); from there the supplier can
 * convert to e.g. USDT on Tron in one click through NEAR Intents.
 */
export function CashOut() {
  const live = NETWORK === "mainnet";
  const { accountId, usdcBalance, withRegistration, send } = useEscrow();
  const [balance, setBalance] = useState<string | null>(null);
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [assetId, setAssetId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (accountId) usdcBalance(accountId).then(setBalance).catch(() => setBalance(null));
  }, [accountId, usdcBalance, sent]);

  useEffect(() => {
    getTokens()
      .then((t) => {
        const list = sortTokens(t.filter((x) => x.assetId !== USDC_NEAR_ASSET && x.blockchain !== "near" && ["USDT", "USDC"].includes(x.symbol)));
        setTokens(list);
        setAssetId(list.find((x) => x.symbol === "USDT" && x.blockchain === "tron")?.assetId || list[0]?.assetId || "");
      })
      .catch(() => setTokens([]));
  }, []);

  const token = useMemo(() => tokens.find((t) => t.assetId === assetId), [tokens, assetId]);
  const units = parseUsdc(amount);
  const depositAddress = quote?.quote.depositAddress;

  useEffect(() => {
    if (!live || !sent || !depositAddress) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await getStatus(depositAddress, quote?.quote.depositMemo);
        if (stop) return;
        setStatus(s);
        if (isTerminal(s.status)) return;
      } catch {}
      if (!stop) setTimeout(tick, 5000);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [live, sent, depositAddress, quote?.quote.depositMemo]);

  async function requestQuote(dry: boolean) {
    if (!units) return;
    const q = await run("quote", () =>
      getQuote({
        dry,
        swapType: "EXACT_INPUT",
        slippageTolerance: 100,
        originAsset: USDC_NEAR_ASSET,
        depositType: "ORIGIN_CHAIN",
        destinationAsset: assetId,
        amount: units,
        recipient,
        recipientType: "DESTINATION_CHAIN",
        refundTo: live ? accountId : "memo-escrow.near",
        refundType: "ORIGIN_CHAIN",
        deadline: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        referral: "memo",
      }),
    );
    if (q) {
      setQuote(q);
      setSent(false);
      setStatus(null);
    }
  }

  async function sendDeposit() {
    if (!quote?.quote.depositAddress) return;
    const to = quote.quote.depositAddress;
    await run(
      "send",
      async () =>
        send(
          await withRegistration(to, [
            {
              receiverId: USDC_CONTRACT,
              method: "ft_transfer",
              args: { receiver_id: to, amount: quote.quote.amountIn, memo: quote.quote.depositMemo ?? null },
              deposit: ONE_YOCTO,
              gas: BigInt(30) * TGAS,
            },
          ]),
        ),
      "Sent to NEAR Intents",
    );
    setSent(true);
  }

  return (
    <section className="card">
      <h2>Cash out to another chain</h2>
      <p className="muted small">
        Payouts always land in your locked NEAR account first. From there, NEAR Intents can deliver them as USDT on Tron,
        USDC on Base, and more. Balance: <b>{balance === null ? "…" : formatUsdc(balance)}</b>
      </p>
      {!live && (
        <div className="callout callout-warn small" style={{ marginBottom: 12 }}>
          Mainnet only. On testnet you can preview a real dry-run quote; nothing moves.
        </div>
      )}
      <div className="grid2">
        <div className="field">
          <label htmlFor="dest">Receive as</label>
          <select id="dest" value={assetId} onChange={(e) => { setAssetId(e.target.value); setQuote(null); }}>
            {tokens.map((t) => (
              <option key={t.assetId} value={t.assetId}>{t.symbol} on {chainName(t.blockchain)}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="amt">Amount (USDC)</label>
          <input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="300" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="to">Your address on {token ? chainName(token.blockchain) : "that chain"}</label>
        <input id="to" value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder={token?.blockchain === "tron" ? "T…" : "0x…"} autoCapitalize="none" />
      </div>
      <div className="row">
        <button className="btn" disabled={!!busy || !units || !recipient} onClick={() => requestQuote(true)}>Preview</button>
        {live && (
          <button className="btn btn-primary" disabled={!!busy || !units || !recipient} onClick={() => requestQuote(false)}>Get quote</button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {quote && (
        <div className="callout callout-info small" style={{ marginTop: 12 }}>
          You send <b>{quote.quote.amountInFormatted} USDC</b> → you receive ≈ <b>{quote.quote.amountOutFormatted} {token?.symbol}</b> on {token ? chainName(token.blockchain) : ""}
          {quote.quote.timeEstimate != null && <> in ~{quote.quote.timeEstimate}s</>}.
          {depositAddress && !sent && (
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-primary" onClick={sendDeposit} disabled={!!busy}>
                {busy === "send" ? <span className="spinner" /> : null} Confirm & send from wallet
              </button>
            </div>
          )}
          {sent && <p style={{ margin: "8px 0 0" }}>Status: <b>{status?.status ?? "submitted"}</b></p>}
        </div>
      )}
    </section>
  );
}
