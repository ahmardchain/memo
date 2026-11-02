#!/usr/bin/env bash
# Build both contracts and deploy them to NEAR testnet.
# Keys are created by near-cli in ~/.near-credentials (outside the repo) — never commit them.
#
# Usage: scripts/deploy-testnet.sh [escrow-account] [usdc-account]
set -euo pipefail
ESCROW=${1:-memo-escrow.testnet}
USDC=${2:-memo-usdc.testnet}
NET="network-config testnet"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

exists() { near account view-account-summary "$1" $NET now >/dev/null 2>&1; }
create() {
  exists "$1" && { echo "✓ $1 exists"; return; }
  echo "→ creating $1 (testnet faucet)"
  near account create-account sponsor-by-faucet-service "$1" autogenerate-new-keypair save-to-legacy-keychain $NET create
  sleep 3
}

echo "== build"
(cd "$ROOT/contract" && cargo near build non-reproducible-wasm)
(cd "$ROOT/mock-usdc" && cargo near build non-reproducible-wasm)

create "$USDC"
create "$ESCROW"

echo "== deploy mock USDC → $USDC"
near contract deploy "$USDC" use-file "$ROOT/mock-usdc/target/near/mock_usdc.wasm" \
  with-init-call new json-args '{}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  $NET sign-with-legacy-keychain send || echo "(already initialised?)"

echo "== deploy escrow → $ESCROW"
near contract deploy "$ESCROW" use-file "$ROOT/contract/target/near/memo_escrow.wasm" \
  with-init-call new json-args "{\"token\":\"$USDC\"}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  $NET sign-with-legacy-keychain send || echo "(already initialised?)"

echo "== register escrow with the token"
near contract call-function as-transaction "$USDC" storage_deposit \
  json-args "{\"account_id\":\"$ESCROW\",\"registration_only\":true}" prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' \
  sign-as "$ESCROW" $NET sign-with-legacy-keychain send

echo "✓ done: escrow=$ESCROW token=$USDC"
