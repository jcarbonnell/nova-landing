#!/usr/bin/env bash
# test-wallet-routes.sh
#
# Server-side smoke test for wallet SIWN (§5.11-A), no browser required.
# Follows the §10 verify order: health → security invariant → happy-path(partial).
#
# The FULL happy path (a real NEP-413 signature verifying → nova_session) needs a
# browser wallet, so it is Item 2b's live check. What THIS covers server-side:
#   - config guard,
#   - nonce round-trips (frontend proxy → Shade → nonce back),
#   - the security invariants that DON'T need a real signature (missing fields →
#     400; a bogus signature → Shade 401, NOT a minted token).
#
# USAGE:
#   BASE=https://nova-sdk.com ./smoke-wallet-routes.sh
#   (or BASE=http://localhost:3000 against a local `next dev`)
#
# These hit the FRONTEND routes (which proxy to Shade). They do NOT need
# INTERNAL_API_SECRET — that lives server-side; the browser/curl never sends it.

set -u
BASE="${BASE:-http://localhost:3000}"
pass=0; fail=0
ok()   { echo "  ✅ $1"; pass=$((pass+1)); }
bad()  { echo "  ❌ $1"; fail=$((fail+1)); }

echo ""
echo "Wallet SIWN server smoke — $BASE"
echo ""

# ── 1. nonce endpoint issues a 64-hex nonce ──────────────────────────────────
echo "1. nonce round-trip:"
NONCE_RESP=$(curl -s -X POST "$BASE/api/auth/wallet-nonce")
NONCE=$(echo "$NONCE_RESP" | sed -n 's/.*"nonce":"\([0-9a-fA-F]*\)".*/\1/p')
if [ "${#NONCE}" -eq 64 ]; then ok "nonce is 64-hex ($NONCE)"; else bad "nonce not 64-hex: $NONCE_RESP"; fi

# two nonces differ (freshness)
NONCE2=$(curl -s -X POST "$BASE/api/auth/wallet-nonce" | sed -n 's/.*"nonce":"\([0-9a-fA-F]*\)".*/\1/p')
if [ -n "$NONCE2" ] && [ "$NONCE" != "$NONCE2" ]; then ok "two nonces differ"; else bad "nonces identical or empty"; fi

# ── 2. verify rejects malformed bodies (400, before any Shade crypto) ─────────
echo ""
echo "2. verify input validation:"
S=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/wallet-verify" \
  -H 'Content-Type: application/json' -d '{}')
if [ "$S" = "400" ]; then ok "empty body → 400"; else bad "empty body → $S (want 400)"; fi

S=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/wallet-verify" \
  -H 'Content-Type: application/json' \
  -d '{"message":"hi","nonce":"'"$(printf 'a%.0s' {1..64})"'"}')
if [ "$S" = "400" ]; then ok "missing signed_message → 400"; else bad "missing signed_message → $S (want 400)"; fi

# ── 3. SECURITY INVARIANT: a bogus signature must NOT mint a token ────────────
echo ""
echo "3. security invariant — forged signature rejected:"
# Well-formed shape, but a nonce Shade never issued + a garbage signature.
# Shade must reject (401). The critical assertion: NO token in the response.
FORGED=$(curl -s -X POST "$BASE/api/auth/wallet-verify" \
  -H 'Content-Type: application/json' \
  -d '{
    "signed_message": {"accountId":"attacker.near","publicKey":"ed25519:11111111111111111111111111111111","signature":"ed25519:22222222222222222222222222222222"},
    "message": "Login to NOVA",
    "nonce": "'"$(printf 'b%.0s' {1..64})"'"
  }')
S=$(echo "$FORGED" | grep -c '"token"')
if [ "$S" = "0" ]; then ok "forged signature returns NO token"; else bad "forged signature MINTED A TOKEN: $FORGED"; fi
# and it should carry an error code from Shade
if echo "$FORGED" | grep -q 'UNAUTHORIZED'; then ok "forged signature → UNAUTHORIZED* code"; else echo "  ⚠️  no UNAUTHORIZED code (check Shade error propagation): $FORGED"; fi

# ── 4. nonce single-use is Shade-side; can't fully test without a real sig ────
echo ""
echo "4. (deferred to 2b — needs a real wallet signature):"
echo "  ⏭  happy path: real signMessage → nova_session with sub=wallet|<account>"
echo "  ⏭  replay: same nonce twice → second is UNAUTHORIZED_NONCE_REPLAY"

echo ""
echo "────────────────────────────────────────────"
echo "  $pass passed, $fail failed  (+ 2 deferred to 2b)"
[ "$fail" -eq 0 ] || exit 1