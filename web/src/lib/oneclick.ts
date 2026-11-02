// NEAR Intents 1-Click API client.
// Docs: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request
// OpenAPI: https://1click.chaindefuser.com/docs/v0/openapi.yaml
import { ONECLICK_API, ONECLICK_JWT } from "@/config";

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  contractAddress?: string | null;
}

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS";
  deadline: string;
  /** Passed as `msg` to `ft_transfer_call` when the output is withdrawn to a NEAR contract. */
  customRecipientMsg?: string;
  referral?: string;
}

export interface QuoteResponse {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: QuoteRequest;
  quote: {
    depositAddress?: string;
    depositMemo?: string;
    amountIn: string;
    amountInFormatted: string;
    amountInUsd?: string;
    minAmountIn?: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd?: string;
    minAmountOut: string;
    deadline?: string;
    timeWhenInactive?: string;
    timeEstimate?: number;
  };
}

export type SwapStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

export interface StatusResponse {
  status: SwapStatus;
  updatedAt: string;
  swapDetails?: {
    amountInFormatted?: string;
    amountOutFormatted?: string;
    destinationChainTxHashes?: { hash: string; explorerUrl: string }[];
    originChainTxHashes?: { hash: string; explorerUrl: string }[];
    nearTxHashes?: string[];
    refundedAmountFormatted?: string;
  };
}

function headers(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (ONECLICK_JWT) h.Authorization = `Bearer ${ONECLICK_JWT}`;
  return h;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { message?: string }).message || `1-Click error ${res.status}`);
  return body as T;
}

let tokenCache: Promise<OneClickToken[]> | null = null;
export function getTokens(): Promise<OneClickToken[]> {
  tokenCache ??= fetch(`${ONECLICK_API}/tokens`).then((r) => json<OneClickToken[]>(r));
  return tokenCache;
}

export async function getQuote(req: QuoteRequest): Promise<QuoteResponse> {
  return json(await fetch(`${ONECLICK_API}/quote`, { method: "POST", headers: headers(), body: JSON.stringify(req) }));
}

export async function getStatus(depositAddress: string, depositMemo?: string): Promise<StatusResponse> {
  const q = new URLSearchParams({ depositAddress });
  if (depositMemo) q.set("depositMemo", depositMemo);
  return json(await fetch(`${ONECLICK_API}/status?${q}`, { headers: headers() }));
}

export async function submitDepositTx(depositAddress: string, txHash: string): Promise<void> {
  await fetch(`${ONECLICK_API}/deposit/submit`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ depositAddress, txHash }),
  });
}

/** Stablecoins + majors that a small business is most likely to pay with. */
export const POPULAR = ["USDT", "USDC", "ETH", "BTC", "SOL", "TRX", "BNB", "wNEAR", "NEAR"];

export function sortTokens(tokens: OneClickToken[]): OneClickToken[] {
  const rank = (t: OneClickToken) => {
    const i = POPULAR.indexOf(t.symbol);
    return i === -1 ? 100 : i;
  };
  return [...tokens].sort((a, b) => rank(a) - rank(b) || a.blockchain.localeCompare(b.blockchain));
}

export const CHAIN_NAMES: Record<string, string> = {
  near: "NEAR",
  eth: "Ethereum",
  tron: "Tron",
  sol: "Solana",
  base: "Base",
  arb: "Arbitrum",
  btc: "Bitcoin",
  bsc: "BNB Chain",
  pol: "Polygon",
  ton: "TON",
  op: "Optimism",
  avax: "Avalanche",
  gnosis: "Gnosis",
  aptos: "Aptos",
  sui: "Sui",
  stellar: "Stellar",
  xrp: "XRP Ledger",
  doge: "Dogecoin",
  zec: "Zcash",
};

export const chainName = (c: string) => CHAIN_NAMES[c] ?? c.toUpperCase();

/** Human amount -> base units string for a token with `decimals`. */
export function toUnits(amount: string, decimals: number): string | null {
  const s = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  if (f.length > decimals) return null;
  return (BigInt(w) * BigInt(10) ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}

export const isTerminal = (s: SwapStatus) => ["SUCCESS", "REFUNDED", "FAILED"].includes(s);
