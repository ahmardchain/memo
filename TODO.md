# memo — progress

Deadline: **2026-11-14 23:59 UTC** (repo must be public by then). Track: `realworld` (primary).

## Done
- [x] Read HACKATHON.md rules, NEAR Intents 1-Click docs + OpenAPI
- [x] Escrow contract (`contract/`): create / accept / decline / cancel / fund (NEP-141 `ft_on_transfer`) / submit proof / reject / approve / claim after review window / reclaim on timeout / extend deadline / dispute / withdraw dispute / arbiter resolve / failed-payout recovery
- [x] 57 unit tests covering every state transition + security invariants (immutable payee, no double release, no over-release, token allow-list, private callback)

- [x] Mock USDC faucet token for testnet (`mock-usdc/`); both contracts build to wasm with cargo-near
- [x] Frontend (Next.js 16 + `@hot-labs/near-connect`): home/your deals, Create deal, Deal page (locked-payout banner, money bar, milestone timeline), supplier accept/proof/claim, buyer fund/approve/reject/reclaim/dispute, arbiter resolve, Telegram/WhatsApp share, document hash verification, rule-based red-flag checker
- [x] 1-Click funding UI: EXACT_OUTPUT quote → escrow via `customRecipientMsg` `{"deal_id":N}` → poll status. Verified with live dry-run quotes (Tron USDT → NEAR USDC)
- [x] Supplier cash-out UI via 1-Click (USDC on NEAR → USDT Tron / USDC Base / …)
- [x] `scripts/deploy-testnet.sh`

## Blocked
- [ ] Testnet deploy — this cloud sandbox can't reach the testnet faucet (`helper.testnet.near.org`). Needs that domain allowed, or a funded testnet account.

## Findings
- 1-Click currently enforces a **$100 minimum swap** → a live mainnet 1-Click test needs ≥ $100 (refundable flow), not "a few dollars". UI warns below the minimum.
- 1-Click quotes fail for recipients that don't exist yet → testnet preview quotes use `intents.near` as recipient until mainnet escrow is deployed.

## Next
- [ ] README (problem, architecture mermaid, run locally, Try it, addresses, limitations)
- [ ] Mainnet deploy — **needs your approval**
- [ ] 1-Click live test with a few dollars — **needs your approval**
- [ ] Stretch: AI proof checker (NEAR AI Cloud), Telegram share link
- [ ] Demo video + X post (you), submission (you)

## Needs from you
- Mainnet NEAR account for the contract + prize payout (you create it)
- Approval before any mainnet deploy / real-funds test
