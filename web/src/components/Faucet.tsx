"use client";

import { useEffect, useState } from "react";
import { HAS_FAUCET, USDC_CONTRACT } from "@/config";
import { TGAS, useEscrow, useNear } from "@/lib/near";
import { formatUsdc } from "@/lib/format";
import { useAction } from "./useAction";

/** Testnet only: mint mock USDC so anyone can try the whole flow for free. */
export function Faucet() {
  const { accountId } = useNear();
  const { usdcBalance, send } = useEscrow();
  const { busy, error, run } = useAction();
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!HAS_FAUCET || !accountId) return;
    usdcBalance(accountId).then(setBalance).catch(() => setBalance("0"));
  }, [accountId, usdcBalance, busy]);

  if (!HAS_FAUCET || !accountId) return null;
  return (
    <section className="card row between">
      <div>
        <h3>Test USDC</h3>
        <p className="muted small" style={{ margin: 0 }}>
          Testnet stand-in for USDC (<code>{USDC_CONTRACT}</code>). Balance: <b>{balance === null ? "…" : formatUsdc(balance)}</b>
        </p>
        {error && <p className="error">{error}</p>}
      </div>
      <button
        className="btn"
        disabled={!!busy}
        onClick={() =>
          run(
            "mint",
            () =>
              send([
                {
                  receiverId: USDC_CONTRACT,
                  method: "mint",
                  args: { account_id: accountId, amount: (BigInt(5_000) * BigInt(1_000_000)).toString() },
                  gas: BigInt(30) * TGAS,
                },
              ]),
            "Minted 5,000 test USDC",
          )
        }
      >
        {busy ? <span className="spinner" /> : null} Get 5,000 test USDC
      </button>
    </section>
  );
}
