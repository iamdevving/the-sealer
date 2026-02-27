# Handoff to Grok — The Sealer
**From:** Claude (Session 11) | **Date:** Feb 2026

Hey Grok. Here's everything you need. Read this fully before touching any code.

---

## What We've Built

The Sealer (thesealer.xyz) is an x402-gated onchain attestation service for ERC-8004 agents on Base. Agents pay USDC via x402, receive an EAS attestation, and get back permanent SVG assets (cards, badges, sleeves) with permalink URLs.

Repo: github.com/iamdevving/agent-attestation-factory

Working right now on Base Sepolia:
- POST /api/attest — takes {achievement, theme, agentId, chain}, x402 paywall, issues EAS attestation, returns cardUrl + badgeUrl + cardPermalink + badgePermalink + txHash + easExplorer link
- GET /api/card — 9-theme SVG statement cards, supports ?uid= permanent links
- GET /api/badge — 9-theme SVG badges
- GET /api/sealed — trading card sleeve wrapping an imported imageUrl

---

## Your Scope

You own src/lib/x402.ts and anything chain-related. Do not touch SVG routes.

### Priority 1: Self-Hosted Facilitator (Base)

**Why this matters:** We currently depend on Coinbase CDP facilitator. If they change terms or discontinue, our paywall breaks entirely. We need to own verification.

Current x402.ts uses:
```typescript
import { facilitator } from '@coinbase/cdp-sdk';
// verifies payment proof via CDP API
```

You need to replace the facilitator call with direct viem verification:
1. Parse the X-PAYMENT header (it's a signed EIP-3009 transferWithAuthorization payload)
2. Verify the signature is valid
3. Check the USDC transfer TX actually exists onchain (use publicClient.getTransactionReceipt)
4. Confirm: correct amount, correct recipient (SEAL_WALLET_ADDRESS), not already used (nonce check)
5. If valid, proceed — if not, return 402

The withX402Payment wrapper interface MUST stay identical:
```typescript
export function withX402Payment(handler: () => Promise<NextResponse>): Promise<NextResponse>
```

issueSealAttestation(achievement: string) signature also stays stable — returns receipt with transactionHash.

Reference: https://github.com/coinbase/x402 — the verify logic is open source, you're just inlining it without the CDP dependency.

### Priority 2: Self-Hosted Facilitator (Solana)

80% of x402 transactions are on Solana (sub-second finality, $0.00025 fees). We need this.

Use PayAI facilitator as reference or build from scratch:
- npm: @x402/svm, @payai/facilitator
- Verify USDC-SPL transfers on Solana using @solana/web3.js
- Same interface — withX402Payment needs to detect chain from payment header and route to correct verifier

Reference implementation: https://github.com/utkarshiniarora/x402-bot (Chainstack tutorial, Feb 2026)
PayAI facilitator docs: https://x402.payai.network/

When adding Solana: add SOLANA_RPC_URL to .env.local. Do not hardcode.

### Priority 3: Agent Verification Layer

Before issuing an attestation we want to know if the attesting wallet is a registered ERC-8004 agent or a human. This goes in the attest route, not the facilitator.

In src/app/api/attest/route.ts, after payment verification, before issueSealAttestation:

```typescript
const entityType = await checkEntityType(walletAddress);
// returns 'AI_AGENT' | 'HUMAN' | 'UNKNOWN'
```

Add entityType to the attestation response JSON and to the EAS attestation data if schema supports it (coordinate with Claude on schema update — we may add a second field).

For ERC-8004 registry lookup: check the ERC-8004 agent registry contract on Base. If wallet is registered there, it's an AI_AGENT. If not, HUMAN or UNKNOWN.

This is non-blocking for launch — return UNKNOWN if registry check fails, never error out.

---

## Current File Structure (Your Files)

```
src/
  lib/
    x402.ts          ← YOU OWN THIS
    eas.ts           ← READ ONLY (Claude's, for GraphQL queries)
  app/
    api/
      attest/
        route.ts     ← YOU OWN THE x402 SECTION, Claude owns response formatting
      card/route.tsx  ← DO NOT TOUCH
      badge/route.tsx ← DO NOT TOUCH
      sealed/route.ts ← DO NOT TOUCH
```

---

## Environment Variables (in .env.local, never commit)

```
ALCHEMY_RPC_URL=        # Base Sepolia — swap to mainnet URL before launch
TEST_PRIVATE_KEY=       # Rotated wallet. Testnet only. New wallet for mainnet.
SEAL_WALLET_ADDRESS=    # Payment recipient — your verifier checks funds go here
CDP_API_KEY_ID=         # Coinbase CDP — only needed until self-hosted facilitator is live
CDP_API_KEY_SECRET=     # Same
```

Add when building Solana:
```
SOLANA_RPC_URL=         # Mainnet: helius or alchemy solana endpoint
```

---

## EAS Details

- Contract on Base (both testnet and mainnet): 0x4200000000000000000000000000000000000021
- Testnet schema UID: 0xf4b3daae205c3fc3c3b8a7d3fb31bcd497911895677ab1db5f431b68a29bb286
- Schema string (testnet): string achievement
- Mainnet schema: register string statement before launch (coordinate with Claude)
- GraphQL: https://base-sepolia.easscan.org/graphql (mainnet: https://base.easscan.org/graphql)

---

## Important History

- Private key was exposed in early Codespaces session — new wallet already rotated
- Project migrated from Codespaces to local HP Pavilion (Windows 10) in session 9
- CDP keys came from Grok sessions — you should have them
- End-to-end test confirmed working: live attestation 0x34a3545cc0a58b267946aa1533607b18fd2ff69e956a3970b9dc6d06f9271230 on Base Sepolia

---

## What Not To Do

- Do not modify any SVG route files (card, badge, sealed)
- Do not change the issueSealAttestation function signature
- Do not commit .env.local
- Do not register a new EAS schema without coordinating — schema UIDs are hardcoded in multiple places
- Do not add Solana support in a way that breaks Base — both must work simultaneously
