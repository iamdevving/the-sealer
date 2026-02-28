# Handoff to Grok — The Sealer
**From:** Claude (Session 11) | **Updated:** Feb 2026

Hey Grok. Great work on the self-hosted facilitator and registry check — exactly what we needed. Here is what's done and what's next.

---

## What's Done (your work)

- Self-hosted x402 facilitator (Base + Solana Devnet) — CDP dependency gone ✅
- Real Solana tx verification (88-char signature in X-PAYMENT header) ✅
- ERC-8004 registry check in src/lib/agentRegistry.ts ✅
- entityType returned in attest response ✅
- badgeUrl + cardPermalink + badgePermalink restored in attest response ✅
- PAYMENT_CONFIG.amount updated to 0.10 ✅
- TODO mainnet comment on fallback ✅

---

## Your Scope

You own:
- src/lib/x402.ts
- src/lib/agentRegistry.ts
- anything chain-related

Do NOT touch SVG routes (card, badge, sealed) or src/lib/eas.ts.

---

## Priority 1: Per-Route Pricing

Right now everything charges 0.10 USDC regardless of product. We need per-route pricing.

Update withX402Payment to accept a price parameter:

```typescript
export async function withX402Payment(
  req: NextRequest,
  handler: () => Promise<NextResponse>,
  price: string = '0.10'  // default to card price
): Promise<NextResponse>
```

Then use price in the 402 response header and validation. The attest route will pass price based on the format param in the request body:

```typescript
// In attest/route.ts
const format = body.format || 'card'; // 'card' | 'badge' | 'sealed'
const price = format === 'badge' ? '0.05' : format === 'sealed' ? '0.15' : '0.10';
return withX402Payment(req, async () => { ... }, price);
```

Prices:
- Badge: $0.05 USDC
- Card: $0.10 USDC
- SEALed: $0.15 USDC
- Verified Achievement (future): $0.50 USDC
- Declaration (future): $1.00 USDC

---

## Priority 2: Harden the Fallback (before mainnet)

The current fallback in verifyPaymentProof returns { valid: true } for anything unrecognized. The TODO comment is good — now actually harden it:

```typescript
// After Solana check — if we get here, proof format is unrecognized
// TODO: MAINNET — this must be { valid: false } — do not launch with true
console.log('[The Sealer] ❌ Unrecognized proof format — rejecting');
return { valid: false };
```

Also: the current Base verification only checks that a TX exists and succeeded — it does not verify that it is a USDC transfer to our recipient address for the correct amount. Before mainnet, add those checks using viem's getLogs or decoding the TX input. Reference: EIP-3009 transferWithAuthorization.

---

## Current attest/route.ts Response Shape (do not break this)

```typescript
{
  status, message, achievement, theme, agentId, entityType,
  txHash, easExplorer, cardUrl, badgeUrl, cardPermalink, badgePermalink, date
}
```

---

## EAS Details

- Contract on Base (testnet + mainnet): 0x4200000000000000000000000000000000000021
- Testnet schema UID: 0xf4b3daae205c3fc3c3b8a7d3fb31bcd497911895677ab1db5f431b68a29bb286
- Schema string (testnet): string achievement
- Mainnet: register string statement before launch — coordinate with Claude, do not do this alone
- GraphQL testnet: https://base-sepolia.easscan.org/graphql

---

## Environment Variables (.env.local, never commit)

```
ALCHEMY_RPC_URL=       # Base Sepolia
SOLANA_RPC_URL=        # Solana devnet or mainnet
TEST_PRIVATE_KEY=      # Testnet only, rotated
SEAL_WALLET_ADDRESS=   # Payment recipient
```

CDP keys no longer needed — you removed that dependency.

---

## What Not To Do

- Do not touch SVG route files (card, badge, sealed, infoproducts)
- Do not change issueSealAttestation function signature
- Do not commit .env.local
- Do not register a new EAS schema without coordinating with Claude
- Do not make Solana break Base — both chains must work simultaneously