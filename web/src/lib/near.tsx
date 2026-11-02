"use client";

import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { FailoverRpcProvider, getTransactionLastResult, JsonRpcProvider } from "near-api-js";
import { NearConnector, type EventMap } from "@hot-labs/near-connect";
import { ESCROW_CONTRACT, NETWORK, RPC_URLS, USDC_CONTRACT } from "@/config";
import type { Deal } from "./types";

export const TGAS = BigInt(1_000_000_000_000);
export const ONE_YOCTO = "1";
/** Storage deposit attached to create/proof/dispute calls; the contract refunds the unused part. */
export const STORAGE_DEPOSIT = "50000000000000000000000"; // 0.05 NEAR
/** NEP-145 registration deposit for a USDC account. */
export const FT_STORAGE_DEPOSIT = "1250000000000000000000"; // 0.00125 NEAR

export interface Call {
  receiverId: string;
  method: string;
  args?: Record<string, unknown>;
  gas?: bigint;
  deposit?: string;
}

type Wallet = Awaited<ReturnType<NearConnector["wallet"]>>;

interface NearCtx {
  ready: boolean;
  accountId: string;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  view: <T>(contractId: string, method: string, args?: Record<string, unknown>) => Promise<T>;
  /** Sign & send one or more transactions in a single wallet prompt. Returns the last tx result. */
  send: (calls: Call[]) => Promise<unknown>;
}

const Ctx = createContext<NearCtx | undefined>(undefined);

export function NearProvider({ children }: PropsWithChildren) {
  const connector = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : new NearConnector({ network: NETWORK, providers: { [NETWORK]: RPC_URLS } }),
    [],
  );
  const provider = useMemo(
    () => new FailoverRpcProvider(RPC_URLS.map((url) => new JsonRpcProvider({ url }))),
    [],
  );
  const [wallet, setWallet] = useState<Wallet | undefined>();
  const [accountId, setAccountId] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!connector) return;
    let cancelled = false;
    const onIn = (p: EventMap["wallet:signIn"]) => {
      if (cancelled) return;
      setWallet(p.wallet as Wallet);
      setAccountId(p.accounts[0]?.accountId ?? "");
    };
    const onOut = () => {
      if (cancelled) return;
      setWallet(undefined);
      setAccountId("");
    };
    connector.on("wallet:signIn", onIn);
    connector.on("wallet:signOut", onOut);
    connector
      .getConnectedWallet()
      .then((c) => {
        if (!cancelled && c) {
          setWallet(c.wallet as Wallet);
          setAccountId(c.accounts[0]?.accountId ?? "");
        }
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
      connector.off("wallet:signIn", onIn);
      connector.off("wallet:signOut", onOut);
    };
  }, [connector]);

  const signIn = useCallback(async () => {
    if (!connector) return;
    const w = await connector.connect();
    setWallet(w as Wallet);
    const accounts = await w.getAccounts();
    setAccountId(accounts[0]?.accountId ?? "");
  }, [connector]);

  const signOut = useCallback(async () => {
    if (!connector || !wallet) return;
    await connector.disconnect(wallet);
    setWallet(undefined);
    setAccountId("");
  }, [connector, wallet]);

  const view = useCallback(
    async <T,>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
      (await provider.callFunction({ contractId, method, args })) as T,
    [provider],
  );

  const send = useCallback(
    async (calls: Call[]) => {
      if (!wallet) throw new Error("Connect a wallet first");
      // Group consecutive calls to the same receiver into one transaction.
      const txs: { receiverId: string; actions: unknown[] }[] = [];
      for (const c of calls) {
        const action = {
          type: "FunctionCall",
          params: {
            methodName: c.method,
            args: c.args ?? {},
            gas: (c.gas ?? BigInt(50) * TGAS).toString(),
            deposit: c.deposit ?? "0",
          },
        };
        const last = txs[txs.length - 1];
        if (last && last.receiverId === c.receiverId) last.actions.push(action);
        else txs.push({ receiverId: c.receiverId, actions: [action] });
      }
      if (txs.length === 1) {
        const out = await wallet.signAndSendTransaction(txs[0] as never);
        return getTransactionLastResult(out as never);
      }
      const outs = await wallet.signAndSendTransactions({ transactions: txs as never });
      return getTransactionLastResult(outs[outs.length - 1] as never);
    },
    [wallet],
  );

  const value = useMemo(
    () => ({ ready, accountId, signIn, signOut, view, send }),
    [ready, accountId, signIn, signOut, view, send],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNear() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNear must be used inside NearProvider");
  return c;
}

// ------------------------------------------------------------------ escrow helpers

export function useEscrow() {
  const { view, send, accountId } = useNear();

  const getDeal = useCallback(
    (id: number) => view<Deal | null>(ESCROW_CONTRACT, "get_deal", { deal_id: id }),
    [view],
  );
  const getDealsFor = useCallback(
    (account: string) => view<Deal[]>(ESCROW_CONTRACT, "get_deals_for", { account_id: account }),
    [view],
  );
  const usdcBalance = useCallback(
    async (account: string) => (await view<string>(USDC_CONTRACT, "ft_balance_of", { account_id: account })) ?? "0",
    [view],
  );
  const isRegistered = useCallback(
    async (account: string) =>
      (await view<unknown>(USDC_CONTRACT, "storage_balance_of", { account_id: account })) != null,
    [view],
  );

  /** Prepend a USDC storage registration when `account` is not registered yet. */
  const withRegistration = useCallback(
    async (account: string, calls: Call[]): Promise<Call[]> =>
      (await isRegistered(account))
        ? calls
        : [
            {
              receiverId: USDC_CONTRACT,
              method: "storage_deposit",
              args: { account_id: account, registration_only: true },
              deposit: FT_STORAGE_DEPOSIT,
              gas: BigInt(10) * TGAS,
            },
            ...calls,
          ],
    [isRegistered],
  );

  const call = useCallback(
    (method: string, args: Record<string, unknown>, deposit = "0", gas = BigInt(100) * TGAS) =>
      send([{ receiverId: ESCROW_CONTRACT, method, args, deposit, gas }]),
    [send],
  );

  return { accountId, getDeal, getDealsFor, usdcBalance, isRegistered, withRegistration, call, send };
}
