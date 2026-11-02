export type Network = "testnet" | "mainnet";

export const NETWORK: Network = (process.env.NEXT_PUBLIC_NETWORK as Network) || "testnet";

const DEFAULTS = {
  testnet: {
    escrow: "memo-escrow.testnet",
    usdc: "memo-usdc.testnet",
    rpc: ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
    explorer: "https://testnet.nearblocks.io",
  },
  mainnet: {
    escrow: "memo-escrow.near",
    // Native Circle USDC on NEAR (verified against https://1click.chaindefuser.com/v0/tokens)
    usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    rpc: ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
    explorer: "https://nearblocks.io",
  },
} as const;

export const ESCROW_CONTRACT = process.env.NEXT_PUBLIC_ESCROW_CONTRACT || DEFAULTS[NETWORK].escrow;
export const USDC_CONTRACT = process.env.NEXT_PUBLIC_USDC_CONTRACT || DEFAULTS[NETWORK].usdc;
export const RPC_URLS: string[] = [...DEFAULTS[NETWORK].rpc];
export const EXPLORER = DEFAULTS[NETWORK].explorer;
export const USDC_DECIMALS = 6;
/** Faucet is only available on the testnet mock token. */
export const HAS_FAUCET = NETWORK === "testnet";

// NEAR Intents 1-Click API
export const ONECLICK_API = "https://1click.chaindefuser.com/v0";
export const ONECLICK_JWT = process.env.NEXT_PUBLIC_ONECLICK_JWT || "";
/** 1-Click asset id for native USDC on NEAR (mainnet only — Intents has no testnet). */
export const USDC_NEAR_ASSET =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** Escrow used as the recipient when previewing 1-Click quotes from a testnet build. */
export const MAINNET_ESCROW_FOR_QUOTES =
  process.env.NEXT_PUBLIC_MAINNET_ESCROW_CONTRACT || DEFAULTS.mainnet.escrow;
