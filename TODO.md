# memo — progress

Deadline: **2026-11-14 23:59 UTC** (repo must be public by then). Track: `realworld` (primary).

## Done
- [x] Read HACKATHON.md rules, NEAR Intents 1-Click docs + OpenAPI
- [x] Escrow contract (`contract/`): create / accept / decline / cancel / fund (NEP-141 `ft_on_transfer`) / submit proof / reject / approve / claim after review window / reclaim on timeout / extend deadline / dispute / withdraw dispute / arbiter resolve / failed-payout recovery
- [x] 57 unit tests covering every state transition + security invariants (immutable payee, no double release, no over-release, token allow-list, private callback)

## In progress
- [ ] Build wasm with cargo-near, deploy to testnet with a test FT standing in for USDC

## Next
- [ ] Frontend (Next.js + wallet selector): Create deal, Deal page timeline, Supplier view, Fund
- [ ] 1-Click funding (any token, any chain → USDC on NEAR → `ft_transfer_call` to escrow with `customRecipientMsg`)
- [ ] Supplier cash-out to another chain via 1-Click (USDC on NEAR → e.g. USDT on Tron)
- [ ] README (problem, architecture mermaid, run locally, Try it, addresses, limitations)
- [ ] Mainnet deploy — **needs your approval**
- [ ] 1-Click live test with a few dollars — **needs your approval**
- [ ] Stretch: AI proof checker (NEAR AI Cloud), Telegram share link
- [ ] Demo video + X post (you), submission (you)

## Needs from you
- Mainnet NEAR account for the contract + prize payout (you create it)
- Approval before any mainnet deploy / real-funds test
